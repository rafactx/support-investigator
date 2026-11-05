import { describe, expect, it } from 'vitest';
import { FIXTURE_ORDERS } from '../gateway/fixtures/orders.ts';
import { OrderContextSchema, toOrderContext } from './order-context.ts';

// Independent source of truth: CONTEXT.md's PII boundary —
// "no name/email/phone/address/documents/tokens/payment detail". Not derived
// from this file's own implementation of toOrderContext.
const FORBIDDEN_PII_SUBSTRINGS = [
  'givenname',
  'familyname',
  'email',
  'phone',
  'address',
  'street',
  'postalcode',
  'taxid',
  'card',
  'transaction',
  'authorization',
  'token',
];

function assertNoPii(value: unknown, path = ''): void {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') {
      const lowered = path.toLowerCase();
      for (const forbidden of FORBIDDEN_PII_SUBSTRINGS) {
        expect(lowered, `key path "${path}" looks like a PII field`).not.toContain(forbidden);
      }
    }
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    for (const forbidden of FORBIDDEN_PII_SUBSTRINGS) {
      expect(lowered, `key "${key}" at "${path}" looks like a PII field`).not.toContain(forbidden);
    }
    assertNoPii(nested, `${path}.${key}`);
  }
}

describe('toOrderContext', () => {
  it('strips all PII from the raw platform order (non-vacuous: the raw fixture does carry it)', () => {
    const raw = FIXTURE_ORDERS['ORDER-1001'];
    const payment = raw.payments[0];

    // Every PII *value* the raw fixture carries — derived from the fixture
    // itself, not restated, so this survives new fields being added to
    // OrderContext later without anyone updating this list by hand.
    const piiValues = [
      raw.customer.email,
      raw.customer.givenName,
      raw.customer.familyName,
      raw.customer.phone,
      raw.customer.taxId,
      raw.shippingAddress.street,
      raw.shippingAddress.postalCode,
      payment.transactionRef,
      payment.authorizationCode,
      payment.cardLast4,
    ];
    // Prove the check isn't vacuous: the raw input really does carry PII.
    for (const value of piiValues) {
      expect(value).toBeTruthy();
    }

    const serialized = JSON.stringify(toOrderContext(raw));

    for (const value of piiValues) {
      expect(serialized, `serialized context should not contain PII value "${value}"`).not.toContain(
        value as string
      );
    }
    assertNoPii(toOrderContext(raw));
  });

  it('produces status/paymentStatus/invoiceStatus/timeline/warnings for a normal order', () => {
    const context = toOrderContext(FIXTURE_ORDERS['ORDER-1001']);

    expect(OrderContextSchema.safeParse(context).success).toBe(true);
    expect(context.orderId).toBe('ORDER-1001');
    expect(context.status).toBe('invoiced');
    expect(context.paymentStatus).toBe('approved');
    expect(context.invoiceStatus).toBe('invoiced');
    expect(context.timeline).toHaveLength(4);
    expect(context.warnings).toEqual([]);
  });

  it('surfaces a warning for a denied-payment, canceled order', () => {
    const context = toOrderContext(FIXTURE_ORDERS['ORDER-1002']);

    expect(context.status).toBe('canceled');
    expect(context.paymentStatus).toBe('denied');
    expect(context.invoiceStatus).toBe('pending');
    expect(context.warnings).toContain('payment-denied');
    expect(context.warnings).toContain('order-canceled');
  });
});
