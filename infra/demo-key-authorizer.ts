import { timingSafeEqual } from 'node:crypto';
import { readDemoKey } from '../src/security/read-demo-key.ts';

const DEMO_KEY_HEADER = 'x-demo-key';

/**
 * Constant-time comparison between the header a caller sent and the real
 * demo key. Extracted as its own pure function — no AWS SDK, no I/O — so
 * the part of the authorizer that actually decides authorized/not is
 * testable without credentials or a real SSM parameter.
 * `timingSafeEqual` requires equal-length buffers; a length mismatch
 * (the common case: no key sent, or a guessed key) is checked first and
 * rejected directly.
 */
export function isValidDemoKey(provided: string | undefined, expected: string): boolean {
  if (!provided) {
    return false;
  }
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

interface HttpApiAuthorizerEvent {
  headers?: Record<string, string | undefined>;
}

interface SimpleAuthorizerResult {
  isAuthorized: boolean;
}

/**
 * HTTP API Lambda authorizer (`HttpLambdaResponseType.SIMPLE`) gating
 * `/mcp` behind the `x-demo-key` shared-secret header
 * (`ADR-0002`, `ADR-0019`). `identitySource: ['$request.header.x-demo-key']`
 * on the CDK-side authorizer config means API Gateway itself rejects a
 * request with no `x-demo-key` header at all before this function is even
 * invoked — this handler only runs for requests that *do* carry the
 * header, deciding whether its value is the right one.
 */
export async function handler(event: HttpApiAuthorizerEvent): Promise<SimpleAuthorizerResult> {
  const parameterName = process.env.DEMO_KEY_PARAMETER_NAME;
  if (!parameterName) {
    throw new Error('DEMO_KEY_PARAMETER_NAME is required for the demo-key authorizer');
  }
  const expected = await readDemoKey(parameterName);
  const provided = event.headers?.[DEMO_KEY_HEADER];
  return { isAuthorized: isValidDemoKey(provided, expected) };
}
