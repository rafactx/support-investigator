import { describe, expect, it } from 'vitest';
import { isValidDemoKey } from './demo-key-authorizer.ts';

// `isValidDemoKey` is the one piece of the authorizer worth a unit test:
// pure, no I/O, no AWS credentials needed. The rest of the authorizer
// (reading the real secret from SSM, wiring API Gateway's SIMPLE response
// format) is proven by the real `cdk deploy` + live curl check,
// matching this repo's existing convention of not mocking AWS
// SDK clients.

describe('isValidDemoKey', () => {
  it('accepts the exact expected key', () => {
    expect(isValidDemoKey('correct-secret', 'correct-secret')).toBe(true);
  });

  it('rejects a wrong key of the same length', () => {
    expect(isValidDemoKey('wrong-secret!!', 'correct-secret')).toBe(false);
  });

  it('rejects a wrong key of a different length', () => {
    expect(isValidDemoKey('short', 'correct-secret')).toBe(false);
  });

  it('rejects a missing header value', () => {
    expect(isValidDemoKey(undefined, 'correct-secret')).toBe(false);
  });

  it('rejects an empty header value', () => {
    expect(isValidDemoKey('', 'correct-secret')).toBe(false);
  });
});
