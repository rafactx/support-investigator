import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

let cachedDemoKey: Promise<string> | undefined;

/**
 * Reads the real demo key from SSM SecureString (never a
 * committed file), once per warm Lambda execution environment. `SSMClient`
 * picks up credentials from the caller's own execution role automatically.
 * `infra/demo-key-authorizer.ts` (verifying inbound `/mcp` requests) is
 * this function's only caller — the old `/investigate` route's Agent
 * Lambda, now removed, used to call it too for its own outbound
 * `/mcp` requests (`ADR-0019`). The Lambda's role is scoped to
 * `ssm:GetParameter` on exactly this one parameter plus `kms:Decrypt`,
 * nothing broader (`infra/support-investigator-stack.ts`).
 */
export function readDemoKey(parameterName: string): Promise<string> {
  cachedDemoKey ??= (async () => {
    const client = new SSMClient({});
    const result = await client.send(
      new GetParameterCommand({ Name: parameterName, WithDecryption: true })
    );
    const value = result.Parameter?.Value;
    if (!value) {
      throw new Error(`SSM parameter "${parameterName}" resolved to no value`);
    }
    return value;
  })();
  return cachedDemoKey;
}
