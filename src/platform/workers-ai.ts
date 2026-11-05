import { createAI } from 'agents/models/ai-sdk';

/**
 * How to reach Workers AI: the Worker's `AI` binding, or an account id and
 * API token for Node scripts (`pnpm evals:intake:live`, `pnpm kb:refresh`).
 * The binding is typed loosely here so Node code needs no Workers types.
 */
export type WorkersAiAccess =
  | { readonly binding: unknown }
  | { readonly accountId: string; readonly apiToken: string };

/**
 * Every Workers AI call goes through an AI Gateway (the account's `default`
 * gateway unless configured). Ticket text must never be stored, so gateway
 * request logging and response caching are both switched off here, not left
 * to a dashboard setting.
 */
const GATEWAY_PRIVACY = { collectLog: false, skipCache: true } as const;

export function createWorkersAi(access: WorkersAiAccess) {
  return 'binding' in access
    ? createAI({ binding: access.binding as never, ...GATEWAY_PRIVACY })
    : createAI({ accountId: access.accountId, apiToken: access.apiToken, ...GATEWAY_PRIVACY });
}

/** Reads REST access for Node scripts; `undefined` when either variable is missing. */
export function readWorkersAiRestAccess(env: NodeJS.ProcessEnv): WorkersAiAccess | undefined {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  return accountId && apiToken ? { accountId, apiToken } : undefined;
}
