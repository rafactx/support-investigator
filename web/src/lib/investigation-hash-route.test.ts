import { describe, expect, it } from 'vitest';
import { hashForInvestigation, investigationIdFromHash } from './investigation-hash-route.ts';

describe('investigationIdFromHash', () => {
  it('extracts the id from a matching hash', () => {
    expect(investigationIdFromHash('#/investigations/inv-1')).toBe('inv-1');
  });

  it('decodes a URI-encoded id', () => {
    expect(investigationIdFromHash('#/investigations/inv%201')).toBe('inv 1');
  });

  it('returns undefined for an empty hash', () => {
    expect(investigationIdFromHash('')).toBeUndefined();
  });

  it('returns undefined for an unrelated hash', () => {
    expect(investigationIdFromHash('#/something-else')).toBeUndefined();
  });

  it('returns undefined for the route prefix with no id', () => {
    expect(investigationIdFromHash('#/investigations/')).toBeUndefined();
  });
});

describe('hashForInvestigation', () => {
  it('builds a hash round-trippable by investigationIdFromHash', () => {
    const hash = hashForInvestigation('inv-1');
    expect(investigationIdFromHash(hash)).toBe('inv-1');
  });

  it('encodes special characters in the id', () => {
    expect(hashForInvestigation('inv 1')).toBe('#/investigations/inv%201');
  });
});
