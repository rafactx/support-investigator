import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

let cachedDemoKey: Promise<string> | undefined;

/**
 * Reads the demo key from an SSM SecureString once per warm Lambda. Its only
 * caller is `infra/demo-key-authorizer.ts`.
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
