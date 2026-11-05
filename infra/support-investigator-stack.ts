import { fileURLToPath } from 'node:url';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEPS_LOCK_FILE_PATH = `${REPO_ROOT}pnpm-lock.yaml`;

/** Shared across all 3 Lambdas in this stack — only bundling and per-function extras differ. */
const NODE_FUNCTION_DEFAULTS = {
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  depsLockFilePath: DEPS_LOCK_FILE_PATH,
} as const;

/**
 * Name of the SSM SecureString parameter carrying the real `x-demo-key`
 * value. Created out of band before `cdk deploy`
 * (`aws ssm put-parameter --type SecureString`, documented in
 * `docs/runbooks/cdk-destroy.md`'s deploy-prerequisites section) — CDK
 * only ever *references* this name, never creates the parameter as a
 * resource (the stack test asserts `AWS::SSM::Parameter` count is 0).
 */
const DEMO_KEY_PARAMETER_NAME = '/support-investigator/demo-key';

/**
 * The Bedrock Titan Embeddings model `search_support_knowledge` invokes at
 * query time when the frozen index was built with `bedrock-titan`
 * (`src/kb/embeddings/bedrock-titan-embed-provider.ts`, ADR-0009).
 * `registerSearchSupportKnowledgeTool` builds its query embedder from the
 * index's own `provider` field, not from the ambient environment. The
 * committed index is currently built with the deterministic `lexical`
 * provider (no Bedrock call at query time); the grant is kept so a
 * Titan-embedded rebuild (`EMBED_PROVIDER=bedrock-titan pnpm kb:refresh`)
 * deploys without an infra change. See `ADR-0016` for why this is a
 * second, separate IAM grant rather than folding it into the Agent
 * Lambda's own Bedrock policy.
 */
const BEDROCK_TITAN_EMBED_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const BEDROCK_LANGUAGE_ASSISTANCE_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export class SupportInvestigatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const region = this.region;
    const account = this.account;

    // ADR-0035's durable Audit Trail and Current Investigation projection.
    // Streams and consumers remain deferred until the CX Intelligence Loop
    // has a real consumer.
    const investigationTable = new dynamodb.Table(this, 'InvestigationTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      // This is a demo stack (ADR-0002), so teardown must remove
      // durable Investigation data as well as compute and edge resources.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- Support MCP Lambda (Agent API Lambda -> McpClient -> Support MCP Lambda) ---
    const supportMcpFn = new NodejsFunction(this, 'SupportMcpFunction', {
      ...NODE_FUNCTION_DEFAULTS,
      entry: `${REPO_ROOT}src/mcp/lambda-handler.ts`,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      // The portfolio deployment proves named Public Reference Scenarios
      // through the fixture-only CommerceGateway. Merchant credentials are
      // never ambient deployment configuration.
      bundling: {
        // ESM, not the default CJS: `loadKnowledgeIndex`'s
        // `DEFAULT_INDEX_PATH` resolves `src/kb/data/index.json` relative
        // to the bundled file's own `import.meta.url` — esbuild only
        // polyfills `import.meta.url` for ESM output; under CJS it
        // silently evaluates to `undefined` (esbuild's own
        // `empty-import-meta` warning), which would make every cold start
        // fail to find the frozen index.
        format: OutputFormat.ESM,
        // `local-embed-provider.ts` dynamically imports `@xenova/transformers`
        // (which eagerly requires the native `sharp` package) behind an
        // `EMBED_PROVIDER=local` branch the deployed stack never selects
        // (ADR-0009). Externalizing keeps that
        // native dependency out of this Lambda's bundle entirely rather
        // than needing it to build for `linux/arm64` at synth time.
        externalModules: ['@aws-sdk/*', '@xenova/transformers', 'sharp'],
        // The frozen Knowledge Index (`src/kb/data/index.json`,
        // `loadKnowledgeIndex`'s `DEFAULT_INDEX_PATH`) is read from disk
        // relative to the bundled file's own `import.meta.url` at runtime
        // — esbuild only emits the one JS file, so the JSON has to be
        // copied alongside it by hand.
        commandHooks: {
          beforeBundling: () => [],
          afterBundling: (_inputDir: string, outputDir: string) => [
            `mkdir -p "${outputDir}/data"`,
            `cp "${REPO_ROOT}src/kb/data/index.json" "${outputDir}/data/index.json"`,
          ],
          beforeInstall: () => [],
        },
      },
    });
    // Least-privilege: only the Titan Embeddings model, never the chat
    // inference profile the Agent Lambda uses.
    supportMcpFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${region}::foundation-model/${BEDROCK_TITAN_EMBED_MODEL_ID}`],
      })
    );

    // --- Demo-key Lambda authorizer ---
    const authorizerFn = new NodejsFunction(this, 'DemoKeyAuthorizerFunction', {
      ...NODE_FUNCTION_DEFAULTS,
      entry: `${REPO_ROOT}infra/demo-key-authorizer.ts`,
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      bundling: {
        format: OutputFormat.CJS,
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        DEMO_KEY_PARAMETER_NAME,
      },
    });
    const demoKeyParameterArn = `arn:aws:ssm:${region}:${account}:parameter${DEMO_KEY_PARAMETER_NAME}`;
    // Two separate statements (not one combined `ssm:GetParameter` +
    // `kms:Decrypt` statement): the stack test asserts a scalar
    // `Action: 'ssm:GetParameter'`, which a multi-action statement would
    // render as an array instead and fail to match.
    authorizerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [demoKeyParameterArn],
      })
    );
    authorizerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        // Scoped via condition, not resource: the parameter uses SSM's
        // AWS-managed key (`alias/aws/ssm`), whose key id isn't known
        // until deploy time. `kms:ViaService` restricts this to
        // decrypt-on-behalf-of-SSM calls only, in this region.
        conditions: {
          StringEquals: { 'kms:ViaService': `ssm.${region}.amazonaws.com` },
        },
      })
    );

    // --- SPA hosting: S3 (private) + CloudFront (deferred at ADR-0016's
    // own forward pointer since nothing had scoped it yet) ---
    const spaBucket = new s3.Bucket(this, 'SpaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const distribution = new cloudfront.Distribution(this, 'SpaDistribution', {
      // `withOriginAccessControl` — CloudFront's current OAC mechanism,
      // not the older Origin Access Identity — is the only way CloudFront
      // reaches an S3 origin that blocks all public access; the bucket
      // policy it attaches grants read access to this specific
      // distribution only, never the public internet directly.
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(spaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      // Single-page app: any path CloudFront can't find in the bucket
      // (a hard refresh isn't relevant here — this SPA has no client-side
      // routes today — but this is the standard SPA error response and
      // costs nothing to include) is served index.html with a 200, not a
      // CloudFront-branded 403/404 page.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // `web/dist` (built via `pnpm --filter web build`, `VITE_API_URL` set
    // to this stack's own `httpApi.url` at build time — see
    // `docs/runbooks/cdk-destroy.md`'s deploy steps) uploaded on every
    // `cdk deploy`, with a cache invalidation so the distribution never
    // serves a stale build after one.
    new s3deploy.BucketDeployment(this, 'SpaDeployment', {
      sources: [s3deploy.Source.asset(`${REPO_ROOT}web/dist`)],
      destinationBucket: spaBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // --- HTTP API ---
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'support-investigator',
      // No public Lambda Function URL anywhere in this stack — every
      // route is reached only through this API Gateway HTTP API.
      // CORS locked to the deployed SPA's own CloudFront domain (the demo
      // endpoint's security requirement) — ADR-0016 deferred this exact configuration to
      // whichever ticket first deployed the SPA, since there was no
      // CloudFront domain yet to lock it to.
      corsPreflight: {
        // Browser preflights cannot carry the demo-key's secret value, so
        // API Gateway handles OPTIONS here. Every actual resource route
        // below is still protected by the DemoKeyAuthorizer.
        allowOrigins: [`https://${distribution.distributionDomainName}`],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.PATCH, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ['content-type', 'x-demo-key'],
      },
    });

    const authorizer = new HttpLambdaAuthorizer('DemoKeyAuthorizer', authorizerFn, {
      authorizerName: 'demo-key-authorizer',
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      identitySource: ['$request.header.x-demo-key'],
    });

    // A 25-second Lambda budget leaves four seconds of headroom below the
    // HTTP API's 29-second integration ceiling.
    const investigationsFn = new NodejsFunction(this, 'InvestigationsFunction', {
      ...NODE_FUNCTION_DEFAULTS,
      entry: `${REPO_ROOT}src/api/lambda-handler.ts`,
      handler: 'handler',
      timeout: cdk.Duration.seconds(25),
      memorySize: 1024,
      bundling: {
        format: OutputFormat.CJS,
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        INVESTIGATION_TABLE_NAME: investigationTable.tableName,
      },
    });
    investigationsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:TransactWriteItems'],
        resources: [investigationTable.tableArn],
      })
    );
    // DynamoDB evaluates every Put inside TransactWriteItems against the
    // underlying PutItem permission too. The enclosing-operation condition
    // preserves ADR-0035's atomic-write boundary: this role still cannot
    // write an Audit Trail event or Current Investigation projection by a
    // standalone PutItem call.
    investigationsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [investigationTable.tableArn],
        conditions: {
          'ForAnyValue:StringEquals': {
            'dynamodb:EnclosingOperation': 'TransactWriteItems',
          },
        },
      })
    );
    investigationsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${region}:${account}:inference-profile/${BEDROCK_LANGUAGE_ASSISTANCE_MODEL_ID}`,
        ],
      })
    );

    // `ADR-0019`: /mcp is gated behind the demo-key authorizer, not left
    // open — it's a real, billable Bedrock Embeddings trigger (the demo
    // endpoint must not be "scannable or abusable") reachable by anyone
    // with the URL otherwise. The requirement that "a third-party MCP
    // client... connects directly to the Support MCP server" is still
    // satisfiable — a third party runs their
    // own Support MCP Lambda from this same open-source stack, or is
    // handed this deployment's demo key out of band; it never required
    // *this* demo instance to sit open.
    //
    // The old `/investigate` route and its Agent Lambda are gone
    // entirely (no compatibility layer), along with the self-call that used
    // to justify a second demo-key grant here. The durable `/investigations`
    // routes below use DynamoDB directly behind this same authorizer.
    httpApi.addRoutes({
      path: '/mcp',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('SupportMcpIntegration', supportMcpFn),
      authorizer,
    });

    const investigationsIntegration = new HttpLambdaIntegration('InvestigationsIntegration', investigationsFn);
    for (const route of [
      { path: '/investigations', methods: [apigwv2.HttpMethod.POST] },
      { path: '/investigations/{id}', methods: [apigwv2.HttpMethod.GET] },
      { path: '/investigations/{id}/intake', methods: [apigwv2.HttpMethod.PATCH] },
      { path: '/investigations/{id}/explanations', methods: [apigwv2.HttpMethod.POST] },
      { path: '/investigations/{id}/reviews', methods: [apigwv2.HttpMethod.POST] },
    ]) {
      httpApi.addRoutes({ ...route, integration: investigationsIntegration, authorizer });
    }

    // `httpApi.url` already carries a trailing slash (e.g.
    // `https://abc123.execute-api.us-east-2.amazonaws.com/`).
    const supportMcpUrl = `${httpApi.url}mcp`;

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url ?? '' });
    new cdk.CfnOutput(this, 'SupportMcpUrl', { value: supportMcpUrl });
    new cdk.CfnOutput(this, 'SpaUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
