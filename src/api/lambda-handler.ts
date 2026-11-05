import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { LambdaContext, LambdaEvent } from 'hono/aws-lambda';
import { handle } from 'hono/aws-lambda';
import { createFulfillmentCapabilities } from '../capabilities/create-fulfillment-capabilities.ts';
import { createCommerceGateway } from '../gateway/create-commerce-gateway.ts';
import { createLanguageAssistance } from '../language-assistance/create-language-assistance.ts';
import {
  createDynamoDbInvestigationRepository,
  readInvestigationTableName,
} from '../persistence/dynamodb-investigation-repository.ts';
import {
  createInvestigationsApp,
  type InvestigationsDeps,
} from './investigations-app.ts';

/**
 * Assembles the durable production dependencies. The table name is
 * intentionally required: an in-memory fallback in Lambda would make a
 * stable resource URL appear durable across execution environments when it
 * is not.
 */
export function createLambdaDeps(
  env: NodeJS.ProcessEnv = process.env,
): InvestigationsDeps {
  const tableName = readInvestigationTableName(env);
  if (!tableName) {
    throw new Error(
      'INVESTIGATION_TABLE_NAME is required for the Investigations Lambda',
    );
  }

  const gateway = createCommerceGateway();
  const capabilities = createFulfillmentCapabilities(gateway);

  return {
    capabilities,
    repository: createDynamoDbInvestigationRepository({
      tableName,
      client: new DynamoDBClient({}),
    }),
    languageAssistance: createLanguageAssistance(env, 'bedrock').languageAssistance,
    createCapabilityCallId: () => randomUUID(),
    // JSON only, and the app's `InvestigationLogEntry` type limits this to
    // correlation identifiers plus state/capability names. No raw request,
    // credential or provider-payload object is available to this callback.
    log: (entry) => console.log(JSON.stringify(entry)),
  };
}

let lazyHandler: ReturnType<typeof handle> | undefined;

/** API Gateway HTTP API handler for every `/investigations` resource route. */
export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  lazyHandler ??= handle(createInvestigationsApp(createLambdaDeps()));
  return lazyHandler(event, context);
};
