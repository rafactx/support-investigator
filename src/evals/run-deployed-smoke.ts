import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { runDeployedSmoke } from './deployed-smoke.ts';

const REQUIRED_ENVIRONMENT = ['SUPPORT_INVESTIGATOR_API_URL', 'SUPPORT_INVESTIGATOR_DEMO_KEY'] as const;

function readRequiredEnvironment(env: NodeJS.ProcessEnv = process.env): {
  apiUrl: string;
  demoKey: string;
} {
  const missing = REQUIRED_ENVIRONMENT.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`SKIPPED: deployed fixture smoke needs ${missing.join(', ')}; no deployed claim was made.`);
  }
  return {
    apiUrl: env.SUPPORT_INVESTIGATOR_API_URL ?? '',
    demoKey: env.SUPPORT_INVESTIGATOR_DEMO_KEY ?? '',
  };
}

async function probeMcpV2(apiUrl: string, demoKey: string): Promise<{
  tools: readonly string[];
  inventoryObservation: { kind?: string };
}> {
  const client = new Client({ name: 'support-investigator-release-smoke', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL('mcp', apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`), {
    // MCP v2's transport carries stable caller-provided headers through
    // `requestInit`; `x-demo-key` is deliberately not a reserved MCP header.
    requestInit: { headers: { 'x-demo-key': demoKey } },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const result = await client.callTool({
      name: 'observe_inventory',
      arguments: {
        skuId: 'SKU-2002',
        seller: '1',
        quantity: 1,
        provenance: {
          investigationId: 'release-smoke-mcp',
          capabilityCallId: 'release-smoke-mcp-inventory',
          accountId: 'release-smoke-fixture-account',
          observedAt: '2026-07-31T12:00:00.000Z',
        },
      },
    });
    if (result.isError) throw new Error('MCP inventory invocation returned an error result.');
    const text = result.content.find((content) => content.type === 'text')?.text;
    return {
      tools: tools.map((tool) => tool.name),
      inventoryObservation: JSON.parse(text ?? '') as { kind?: string },
    };
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  let environment: { apiUrl: string; demoKey: string };
  try {
    environment = readRequiredEnvironment();
  } catch (error) {
    // This is intentionally a skip rather than a pass. Credentials and the
    // demo endpoint are optional local prerequisites, unlike the frozen CI
    // gate; an absent deployment cannot establish release evidence.
    console.log(error instanceof Error ? error.message : 'SKIPPED: deployed fixture smoke is unavailable.');
    return;
  }

  const report = await runDeployedSmoke({
    ...environment,
    fetchImpl: fetch,
    probeMcpV2: () => probeMcpV2(environment.apiUrl, environment.demoKey),
  });
  console.log('\nDeployed fixture release smoke\n');
  console.log(JSON.stringify(report, null, 2));
  console.log('\nFixture mechanism evidence passed; live merchant diagnostic accuracy: not measured.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
