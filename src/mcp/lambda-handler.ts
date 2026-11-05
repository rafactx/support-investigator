import type { LambdaContext, LambdaEvent } from 'hono/aws-lambda';
import { handle } from 'hono/aws-lambda';
import { createCommerceGateway } from '../gateway/create-commerce-gateway.ts';
import { createQueryEmbedProvider } from '../kb/embeddings/query-embed-provider.ts';
import { loadKnowledgeIndex } from '../kb/load-index.ts';
import { createSupportMcpApp } from './server.ts';

/**
 * Builds the Support MCP Lambda handler directly from the v2 Hono/Web
 * Standard app. API Gateway requests reach `createMcpHandler` without an
 * in-process Node HTTP loopback proxy.
 */
let lazyHandler: ReturnType<typeof handle> | undefined;

/** The Lambda entrypoint the reference CDK stack points the Support MCP function at. */
export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (!lazyHandler) {
    const knowledgeIndex = loadKnowledgeIndex();
    lazyHandler = handle(
      createSupportMcpApp({
        gateway: createCommerceGateway(),
        knowledgeIndex,
        queryEmbedProvider: createQueryEmbedProvider(knowledgeIndex),
      }),
    );
  }
  return lazyHandler(event, context);
};
