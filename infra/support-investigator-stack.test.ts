import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it, vi } from 'vitest';
import { SupportInvestigatorStack } from './support-investigator-stack.ts';

// Every test in this file calls `synthTemplate()`, which does a real
// esbuild bundle of 3 Node Lambdas from scratch — expensive enough
// (observed timing out under load, twice, once before ADR-0021 added a
// 4th resource kind to synthesize) that the default 5s test timeout is
// too tight for this file specifically, not a flake worth ignoring.
vi.setConfig({ testTimeout: 20_000 });

// A placeholder, not the real target account — this file's assertions only
// need *some* syntactically valid 12-digit id so the stack's own ARN
// string-building (`this.account`) produces something to match against; the
// real account id doesn't belong hardcoded in a public repo (see
// `infra/main.ts`'s own doc comment).
const TEST_ACCOUNT_ID = '123456789012';

function synthTemplate(): Template {
  const app = new cdk.App();
  const stack = new SupportInvestigatorStack(app, 'TestStack', {
    env: { account: TEST_ACCOUNT_ID, region: 'us-east-2' },
  });
  return Template.fromStack(stack);
}

describe('SupportInvestigatorStack', () => {
  it('synth produces the durable Investigations API alongside the Support MCP and authorizer Lambdas', () => {
    const template = synthTemplate();

    // 4 total AWS::Lambda::Function resources: the Support MCP Lambda,
    // durable Investigations API Lambda and
    // the demo-key authorizer Lambda, plus the `BucketDeployment`
    // construct's own AWS-managed custom-resource Lambda (`ADR-0021`,
    // uploads `web/dist` to S3 and invalidates CloudFront on deploy). That
    // 3rd function runs on Python, not Node — distinguishing by
    // `Runtime: 'nodejs22.x'` below still isolates exactly this stack's
    // own 2. The old `/investigate` route's Agent Lambda was removed.
    template.resourceCountIs('AWS::Lambda::Function', 4);
    const nodeFns = template.findResources('AWS::Lambda::Function', {
      Properties: Match.objectLike({ Runtime: 'nodejs22.x' }),
    });
    expect(Object.keys(nodeFns)).toHaveLength(3);

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 6);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', Match.objectLike({ RouteKey: 'ANY /mcp' }));
    for (const routeKey of [
      'POST /investigations',
      'GET /investigations/{id}',
      'PATCH /investigations/{id}/intake',
      'POST /investigations/{id}/explanations',
      'POST /investigations/{id}/reviews',
    ]) {
      template.hasResourceProperties(
        'AWS::ApiGatewayV2::Route',
        Match.objectLike({ RouteKey: routeKey, AuthorizationType: 'CUSTOM' })
      );
    }
  });

  it('provisions an on-demand Investigation table and gives only the API Lambda its required DynamoDB operations', () => {
    const template = synthTemplate();

    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties(
      'AWS::DynamoDB::Table',
      Match.objectLike({
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        SSESpecification: { SSEEnabled: true },
      })
    );
    const table = Object.values(template.findResources('AWS::DynamoDB::Table'))[0] as {
      DeletionPolicy?: string;
      UpdateReplacePolicy?: string;
    };
    expect(table.DeletionPolicy).toBe('Delete');
    expect(table.UpdateReplacePolicy).toBe('Delete');

    template.hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({ INVESTIGATION_TABLE_NAME: Match.anyValue() }),
        }),
      })
    );
    const investigationsFunction = Object.values(template.findResources('AWS::Lambda::Function')).find((resource) =>
      JSON.stringify(resource).includes('INVESTIGATION_TABLE_NAME')
    ) as { Properties: { Timeout: number } } | undefined;
    expect(investigationsFunction?.Properties.Timeout).toBe(25);
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('dynamodb:Query');
    expect(templateJson).toContain('dynamodb:TransactWriteItems');
    // DynamoDB authorizes each transactional Put against PutItem as well
    // as TransactWriteItems. Restrict the additional grant to the enclosing
    // transaction so the API Lambda still cannot make standalone writes.
    template.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'dynamodb:PutItem',
              Condition: {
                'ForAnyValue:StringEquals': { 'dynamodb:EnclosingOperation': 'TransactWriteItems' },
              },
            }),
          ]),
        }),
      }),
    );
  });

  it('release smoke uses the explicitly fixture-backed deployment, never an ambient live-merchant configuration', () => {
    const template = synthTemplate();
    const nodeFunctions = Object.entries(template.findResources('AWS::Lambda::Function', {
      Properties: Match.objectLike({ Runtime: 'nodejs22.x' }),
    }))
      .filter(([logicalId]) => logicalId.includes('SupportMcpFunction') || logicalId.includes('InvestigationsFunction'))
      .map(([, resource]) => resource) as Array<{ Properties: { Environment?: { Variables?: Record<string, string> } } }>;

    expect(nodeFunctions).toHaveLength(2);
    // The CommerceGateway is fixture-only: no function may carry gateway
    // mode switches or merchant credentials in its environment.
    for (const fn of nodeFunctions) {
      const variableNames = Object.keys(fn.Properties.Environment?.Variables ?? {});
      for (const name of variableNames) {
        expect(name).not.toMatch(/MODE|APP_KEY|APP_TOKEN|ACCOUNT_NAME|SECRET|PASSWORD/);
      }
    }
  });

  it('no AWS::Lambda::Url resource exists, and no AuthType:NONE appears anywhere in the template', () => {
    const template = synthTemplate();

    template.resourceCountIs('AWS::Lambda::Url', 0);
    const raw = JSON.stringify(template.toJSON());
    expect(raw).not.toContain('"AuthType":"NONE"');
  });

  it('ADR-0019: /mcp requires x-demo-key via a CUSTOM Lambda authorizer', () => {
    const template = synthTemplate();

    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 1);
    template.hasResourceProperties(
      'AWS::ApiGatewayV2::Authorizer',
      Match.objectLike({
        AuthorizerType: 'REQUEST',
        AuthorizerPayloadFormatVersion: '2.0',
        IdentitySource: ['$request.header.x-demo-key'],
      })
    );
    // `ADR-0019`: /mcp is gated, not left open — a code-review pass found
    // the original "leave it open" reasoning rested on a mistaken premise,
    // and the route was in practice a real, unauthenticated, billable
    // Bedrock Embeddings trigger reachable by anyone with the URL.
    template.hasResourceProperties(
      'AWS::ApiGatewayV2::Route',
      Match.objectLike({ RouteKey: 'ANY /mcp', AuthorizationType: 'CUSTOM' })
    );
    // Real "requests without it are rejected" behavior is verified live
    // against the deployed API, not re-derived here: HTTP
    // API's own `identitySource` mechanism returns 401 before the
    // authorizer Lambda is even invoked when the header is missing.
  });

  it('ADR-0021: the SPA bucket blocks all public access and is only reachable through CloudFront (OAC)', () => {
    const template = synthTemplate();

    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties(
      'AWS::S3::Bucket',
      Match.objectLike({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      })
    );

    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    // Origin Access Control, not the legacy Origin Access Identity — the
    // only mechanism that can reach a bucket with all public access
    // blocked. `OriginAccessControlOriginType: 's3'` on the OAC resource
    // is the concrete signal; there's no simpler single property on the
    // distribution itself that proves this.
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties(
      'AWS::CloudFront::OriginAccessControl',
      Match.objectLike({
        OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 's3' }),
      })
    );
  });

  it("ADR-0021: the HTTP API accepts cross-origin requests only from the SPA's own CloudFront domain", () => {
    const template = synthTemplate();

    const apis = template.findResources('AWS::ApiGatewayV2::Api');
    const [api] = Object.values(apis) as Array<{
      Properties: { CorsConfiguration: { AllowOrigins: unknown[]; AllowMethods: string[]; AllowHeaders: string[] } };
    }>;
    expect(api).toBeDefined();
    const cors = api.Properties.CorsConfiguration;

    // The one allowed origin is built from this same distribution's own
    // DomainName token (Fn::Join around Fn::GetAtt), not a hardcoded
    // string — proving it's locked to *this* deployment's CloudFront
    // domain, not some other fixed value.
    const originJoin = cors.AllowOrigins[0] as { 'Fn::Join': [string, unknown[]] };
    expect(originJoin['Fn::Join'][0]).toBe('');
    const originParts = JSON.stringify(originJoin['Fn::Join'][1]);
    expect(originParts).toContain('https://');
    expect(originParts).toContain('DomainName');

    expect(cors.AllowMethods.sort()).toEqual(['GET', 'PATCH', 'POST']);
    expect(cors.AllowHeaders.map((h) => h.toLowerCase()).sort()).toEqual(['content-type', 'x-demo-key']);
  });

  it('Bedrock permissions are split between bounded Language Assistance and Support MCP embeddings (ADR-0016)', () => {
    const template = synthTemplate();

    // `search_support_knowledge` always re-embeds its query with
    // `index.provider` (`bedrock-titan`, ADR-0009) regardless of the Support
    // MCP Lambda's own config — so that Lambda's role needs its own
    // bedrock:InvokeModel grant, scoped to only the Titan Embeddings
    // foundation model. The old `/investigate` route's Agent Lambda was
    // removed. The durable Investigation Lambda brings back exactly
    // one bounded Language Assistance grant, while Support MCP keeps its
    // separate Titan Embeddings grant.
    const allPolicies = template.findResources('AWS::IAM::Policy', {
      Properties: Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([Match.objectLike({ Action: 'bedrock:InvokeModel' })]),
        }),
      }),
    });
    expect(Object.values(allPolicies)).toHaveLength(2);

    const mcpPolicy = Object.values(allPolicies).find((policy) => {
      const statements = (
        policy as { Properties: { PolicyDocument: { Statement: Array<{ Resource: unknown }> } } }
      ).Properties.PolicyDocument.Statement;
      const resource = statements.find((s) => 'Resource' in s)?.Resource;
      return typeof resource === 'string' && resource.includes('titan-embed-text-v2');
    }) as
      | { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> } } }
      | undefined;
    expect(mcpPolicy).toBeDefined();

    const statements = mcpPolicy?.Properties.PolicyDocument.Statement ?? [];
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toBe('bedrock:InvokeModel');
    expect(statements[0]?.Resource).toBe(
      `arn:aws:bedrock:us-east-2::foundation-model/amazon.titan-embed-text-v2:0`
    );

    const languageAssistancePolicy = Object.values(allPolicies).find((policy) =>
      JSON.stringify(policy).includes('inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0')
    ) as { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> } } } | undefined;
    expect(languageAssistancePolicy?.Properties.PolicyDocument.Statement).toEqual(
      expect.arrayContaining([expect.objectContaining({ Action: 'bedrock:InvokeModel' })])
    );
  });

  it('no SSM::Parameter resource is created by CDK (the real secret is created out of band), and the authorizer role can read one by name', () => {
    const template = synthTemplate();

    // CDK never creates the actual secret value as a resource — it only
    // references an existing SSM SecureString by name at deploy time.
    template.resourceCountIs('AWS::SSM::Parameter', 0);

    template.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'ssm:GetParameter',
            }),
          ]),
        }),
      })
    );
  });
});
