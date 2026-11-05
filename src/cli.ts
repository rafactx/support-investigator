import { serve } from '@hono/node-server';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { Hono } from 'hono';
import { createInvestigationsApp } from './api/investigations-app.ts';
import { createFulfillmentCapabilities } from './capabilities/create-fulfillment-capabilities.ts';
import { createInMemoryInvestigationRepository } from './domain/investigation-repository.ts';
import { createLanguageAssistance } from './language-assistance/create-language-assistance.ts';
import { createCommerceGateway } from './gateway/create-commerce-gateway.ts';
import { loadKnowledgeIndex } from './kb/load-index.ts';
import { createQueryEmbedProvider } from './kb/embeddings/query-embed-provider.ts';
import { startSupportMcpHttpServer } from './mcp/node-server.ts';

const DEFAULT_SERVE_PORT = 8787;

const USAGE =
  'Usage:\n' +
  '  pnpm dev inventory <skuId> <seller> <quantity>\n' +
  '  pnpm dev simulate-fulfillment <skuId> <quantity> <seller> <postalCode>\n' +
  '  pnpm dev warehouse-to-dock <warehouseId>\n' +
  '  pnpm dev dock-to-policy <dockId>\n' +
  '  pnpm dev destination-coverage <policyId> <postalCode>\n' +
  '  pnpm dev search-knowledge <query> [limit]                              (try "no delivery option")\n' +
  `  pnpm dev serve [port]                                                  starts POST /investigations locally (default port ${DEFAULT_SERVE_PORT})`;

interface ToolRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Builds the Support MCP tool call each debug command issues — structured
 * args straight through to `callTool`, no natural-language round trip and
 * no model in between (the old `investigate` command's
 * structured-args→sentence→model-parses-it-back-out shape is retired along
 * with the rest of the model-driven contract).
 */
const TOOL_COMMANDS: Record<
  string,
  (args: string[]) => ToolRequest | undefined
> = {
  inventory: ([skuId, seller, quantity]) =>
    skuId && seller && quantity
      ? {
          tool: 'observe_inventory',
          arguments: {
            skuId,
            seller,
            quantity: Number(quantity),
            provenance: cliProvenance('inventory'),
          },
        }
      : undefined,
  'simulate-fulfillment': ([skuId, quantity, seller, postalCode]) =>
    skuId && quantity && seller && postalCode
      ? {
          tool: 'observe_fulfillment_simulation',
          arguments: {
            skuId,
            quantity: Number(quantity),
            seller,
            destinationPostalCode: postalCode,
            provenance: cliProvenance('fulfillment-simulation'),
          },
        }
      : undefined,
  'warehouse-to-dock': ([warehouseId]) =>
    warehouseId
      ? {
          tool: 'observe_warehouse_to_dock',
          arguments: {
            warehouseId,
            provenance: cliProvenance('warehouse-to-dock'),
          },
        }
      : undefined,
  'dock-to-policy': ([dockId]) =>
    dockId
      ? {
          tool: 'observe_dock_to_policy',
          arguments: { dockId, provenance: cliProvenance('dock-to-policy') },
        }
      : undefined,
  'destination-coverage': ([policyId, destinationPostalCode]) =>
    policyId && destinationPostalCode
      ? {
          tool: 'observe_destination_coverage',
          arguments: {
            policyId,
            destinationPostalCode,
            provenance: cliProvenance('destination-coverage'),
          },
        }
      : undefined,
  'search-knowledge': ([query, limit]) =>
    query
      ? {
          tool: 'search_support_knowledge',
          arguments: limit ? { query, limit: Number(limit) } : { query },
        }
      : undefined,
};

function cliProvenance(capabilityCallId: string) {
  return {
    investigationId: 'cli-observation',
    capabilityCallId: `cli-${capabilityCallId}`,
    accountId: 'demo-account',
    observedAt: new Date().toISOString(),
  };
}

/** Runs one Support MCP tool call and prints its result verbatim. */
async function runToolCommand(
  mcpClient: Client,
  request: ToolRequest,
): Promise<void> {
  const result = await mcpClient.callTool({
    name: request.tool,
    arguments: request.arguments,
  });
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Runs `serve`: starts the resource-oriented `/investigations` API locally
 * over plain Node HTTP (`@hono/node-server`). Language Assistance follows
 * `LANGUAGE_MODEL_PROVIDER` (default `fake`: no model, no network).
 *
 * The in-memory `InvestigationRepository` is created once per server
 * process, so investigations survive across requests for the life of
 * `pnpm dev serve` and are lost on restart — exactly ADR-0036's "an
 * in-memory repository implements the same port only for local tests".
 */
async function runServeCommand(args: string[]): Promise<void> {
  const port = args[0] ? Number(args[0]) : DEFAULT_SERVE_PORT;
  const commerceGateway = createCommerceGateway();
  const investigationsApp = createInvestigationsApp({
    capabilities: createFulfillmentCapabilities(commerceGateway),
    repository: createInMemoryInvestigationRepository(),
    languageAssistance: createLanguageAssistance(process.env, 'fake').languageAssistance,
  });
  const app = new Hono();
  app.route('/', investigationsApp);

  const httpServer = serve({ fetch: app.fetch, port }, (info) => {
    console.error(
      `Investigations API listening at http://localhost:${info.port} (POST /investigations, GET /investigations/:id)`,
    );
  });

  const shutdown = async (): Promise<void> => {
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

/**
 * `pnpm dev <command> <args...>` — every non-`serve` command connects to a
 * fresh Support MCP server over Streamable HTTP via the official MCP SDK
 * `Client` and calls the requested tool directly, proving Support MCP works
 * as an external adapter (ADR-0039) without a model in the loop.
 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'serve') {
    await runServeCommand(args);
    return;
  }

  const request = command ? TOOL_COMMANDS[command]?.(args) : undefined;
  if (!request) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const knowledgeIndex = loadKnowledgeIndex();
  const server = await startSupportMcpHttpServer(
    {
      gateway: createCommerceGateway(),
      knowledgeIndex,
      queryEmbedProvider: createQueryEmbedProvider(knowledgeIndex),
    },
    { port: 0 },
  );
  console.error(`Support MCP listening at ${server.url}`);

  const mcpClient = new Client({
    name: 'support-investigator-cli',
    version: '0.1.0',
  });
  await mcpClient.connect(
    new StreamableHTTPClientTransport(new URL(server.url)),
  );

  try {
    await runToolCommand(mcpClient, request);
  } finally {
    await mcpClient.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
