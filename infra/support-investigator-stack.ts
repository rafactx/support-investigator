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

const NODE_FUNCTION_DEFAULTS = {
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  depsLockFilePath: DEPS_LOCK_FILE_PATH,
} as const;

/**
 * SSM SecureString holding the demo key. It is created out of band before
 * `cdk deploy` (see `docs/runbooks/cdk-destroy.md`); the stack only
 * references it.
 */
const DEMO_KEY_PARAMETER_NAME = '/support-investigator/demo-key';

/**
 * Query-time embeddings for `search_support_knowledge` when the index was
 * built with `bedrock-titan` (ADR-0009). The committed index is `lexical`
 * and makes no Bedrock call; the grant lets a Titan rebuild deploy without
 * an infra change.
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

    // --- Support MCP Lambda ---
    const supportMcpFn = new NodejsFunction(this, 'SupportMcpFunction', {
      ...NODE_FUNCTION_DEFAULTS,
      entry: `${REPO_ROOT}src/mcp/lambda-handler.ts`,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      bundling: {
        // The Knowledge Index is read relative to `import.meta.url`, which
        // esbuild only preserves in ESM output.
        format: OutputFormat.ESM,
        // `@xenova/transformers` (and its native `sharp` dependency) is only
        // loaded for `EMBED_PROVIDER=local`, which this stack never selects.
        externalModules: ['@aws-sdk/*', '@xenova/transformers', 'sharp'],
        // esbuild emits one JS file, so the index JSON is copied next to it.
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
    // Only the Titan Embeddings model, not the language-assistance profile.
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
        // The AWS-managed SSM key's id is unknown until deploy, so this is
        // scoped by `kms:ViaService` instead of by resource.
        conditions: {
          StringEquals: { 'kms:ViaService': `ssm.${region}.amazonaws.com` },
        },
      })
    );

    // --- SPA hosting: private S3 bucket behind CloudFront (ADR-0021) ---
    const spaBucket = new s3.Bucket(this, 'SpaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const distribution = new cloudfront.Distribution(this, 'SpaDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(spaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // Uploads `web/dist` and invalidates the cache on every deploy.
    new s3deploy.BucketDeployment(this, 'SpaDeployment', {
      sources: [s3deploy.Source.asset(`${REPO_ROOT}web/dist`)],
      destinationBucket: spaBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // --- HTTP API ---
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'support-investigator',
      // CORS is locked to the SPA's CloudFront domain. Preflights cannot
      // carry the demo key, so API Gateway answers OPTIONS; every resource
      // route still goes through the authorizer.
      corsPreflight: {
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
    // TransactWriteItems also checks PutItem. The condition keeps writes
    // atomic (ADR-0035): this role cannot call PutItem on its own.
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

    // /mcp sits behind the demo-key authorizer too (ADR-0019).
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

    // `httpApi.url` ends with a slash.
    const supportMcpUrl = `${httpApi.url}mcp`;

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url ?? '' });
    new cdk.CfnOutput(this, 'SupportMcpUrl', { value: supportMcpUrl });
    new cdk.CfnOutput(this, 'SpaUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
