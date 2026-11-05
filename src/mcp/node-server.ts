import { serve } from '@hono/node-server';
import { createSupportMcpApp, MCP_PATH, type SupportMcpDependencies } from './server.ts';

export interface SupportMcpHttpServer {
  /** The `/mcp` endpoint URL, e.g. `http://127.0.0.1:54213/mcp`. */
  url: URL;
  close(): Promise<void>;
}

export interface StartSupportMcpHttpServerOptions {
  /** Port to listen on. `0` (default) picks a free ephemeral port. */
  port?: number;
}

/**
 * Starts the Web Standard Support MCP app on a local Node HTTP server, for
 * the CLI and tests. Deployments use the same app directly through
 * `hono/aws-lambda` or the Cloudflare Worker; there is no loopback proxy.
 */
export async function startSupportMcpHttpServer(
  deps: SupportMcpDependencies,
  options: StartSupportMcpHttpServerOptions = {},
): Promise<SupportMcpHttpServer> {
  const app = createSupportMcpApp(deps);
  const httpServer = serve({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port: options.port ?? 0,
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('listening', resolve);
    httpServer.once('error', reject);
  });
  const address = httpServer.address();
  const port =
    typeof address === 'object' && address ? address.port : undefined;
  if (!port) throw new Error('Support MCP server failed to bind to a TCP port');
  const url = new URL(`http://127.0.0.1:${port}${MCP_PATH}`);

  return {
    url,
    async close() {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
