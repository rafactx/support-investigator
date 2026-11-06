import { describe, expect, it } from 'vitest';
import { type CodeToken, tokenizeCodeSpans } from './code-tokens.ts';

// Independent source of truth for every expectation below: real fixture
// observations (`src/gateway/fixtures`) and the inline-code
// contract: only order/SKU ids, postal codes, ISO timestamps, and
// key=value pairs become code; prose and bare numbers never do.

/** Strips the `start` offset (a rendering concern) for shape assertions. */
function spans(text: string): Array<Pick<CodeToken, 'kind' | 'value'>> {
  return tokenizeCodeSpans(text).map(({ kind, value }) => ({ kind, value }));
}

describe('tokenizeCodeSpans', () => {
  it('marks order ids, key=value pairs, ISO timestamps, and slugs as code', () => {
    expect(
      spans(
        'ORDER-1002 has status=canceled with paymentStatus=denied. Timeline shows payment-denied event on 2026-07-22T08:12:30.000Z followed by cancellation.'
      )
    ).toEqual([
      { kind: 'code', value: 'ORDER-1002' },
      { kind: 'text', value: ' has ' },
      { kind: 'code', value: 'status=canceled' },
      { kind: 'text', value: ' with ' },
      { kind: 'code', value: 'paymentStatus=denied' },
      { kind: 'text', value: '. Timeline shows ' },
      { kind: 'code', value: 'payment-denied' },
      { kind: 'text', value: ' event on ' },
      { kind: 'code', value: '2026-07-22T08:12:30.000Z' },
      { kind: 'text', value: ' followed by cancellation.' },
    ]);
  });

  it('marks SKU ids and postal codes, leaving bare numbers as prose', () => {
    expect(spans('SKU-2001 is available with 12 units in stock at postal code 22240-006. Price is 19990.')).toEqual([
      { kind: 'code', value: 'SKU-2001' },
      { kind: 'text', value: ' is available with 12 units in stock at postal code ' },
      { kind: 'code', value: '22240-006' },
      { kind: 'text', value: '. Price is 19990.' },
    ]);
  });

  it('marks space-separated datetimes, bare times, and enum-like slugs', () => {
    expect(
      spans(
        'Order status: canceled | Payment status: denied | Timeline shows order created at 2026-07-22 08:10:00, payment denied at 08:12:30, and order canceled at 08:12:31 (1 second later). Warnings include payment-denied and order-canceled.'
      )
    ).toEqual([
      { kind: 'text', value: 'Order status: canceled | Payment status: denied | Timeline shows order created at ' },
      { kind: 'code', value: '2026-07-22 08:10:00' },
      { kind: 'text', value: ', payment denied at ' },
      { kind: 'code', value: '08:12:30' },
      { kind: 'text', value: ', and order canceled at ' },
      { kind: 'code', value: '08:12:31' },
      { kind: 'text', value: ' (1 second later). Warnings include ' },
      { kind: 'code', value: 'payment-denied' },
      { kind: 'text', value: ' and ' },
      { kind: 'code', value: 'order-canceled' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('marks a date and a bare clock time as code without the postal pattern nibbling', () => {
    expect(spans('created on 2026-07-22 at 08:10:00')).toEqual([
      { kind: 'text', value: 'created on ' },
      { kind: 'code', value: '2026-07-22' },
      { kind: 'text', value: ' at ' },
      { kind: 'code', value: '08:10:00' },
    ]);
  });

  it('returns a single text segment for prose without technical data', () => {
    expect(spans('Customer cannot locate this week order.')).toEqual([
      { kind: 'text', value: 'Customer cannot locate this week order.' },
    ]);
  });

  it('carries source offsets as stable keys', () => {
    expect(tokenizeCodeSpans('SKU-2001 in stock').map((token) => token.start)).toEqual([0, 8]);
  });
});
