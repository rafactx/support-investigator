import type { RawOrder } from '../../domain/order-record.ts';

/**
 * Fixture platform orders, provider-shaped per ADR-0005. Two scenarios:
 *
 * - `ORDER-1001`: a normal, successfully paid and invoiced order.
 * - `ORDER-1002`: payment denied, order canceled — exercises the
 *   normalizer's warning derivation.
 *
 * Every record here deliberately carries the PII the tool layer must strip
 * (name, email, phone, address, tax id, payment references) — see
 * `fixture-commerce-gateway.test.ts` and `order-context.test.ts`, which assert
 * against these raw values directly to prove the stripping isn't vacuous.
 */
/**
 * Order IDs the fixture `CommerceGateway` treats as permission-denied (a 403,
 * not a 404) — `docs/adr/0011`. Checked before `FIXTURE_ORDERS` by
 * `createFixtureCommerceGateway.getOrder`, so these IDs never resolve to
 * `OrderNotFoundError` even though they also don't appear below.
 */
export const FORBIDDEN_ORDER_IDS: ReadonlySet<string> = new Set([
  'ORDER-4031',
  'ORDER-4032',
  'ORDER-4033',
]);

export const FIXTURE_ORDERS: Record<string, RawOrder> = {
  'ORDER-1001': {
    id: 'ORDER-1001',
    status: 'invoiced',
    statusLabel: 'Invoiced',
    createdAt: '2026-07-20T13:45:00.000Z',
    customer: {
      email: 'maria.silva@example.com',
      givenName: 'Maria',
      familyName: 'Silva',
      phone: '+55 11 98888-7777',
      taxId: '123.456.789-00',
    },
    shippingAddress: {
      street: 'Avenida Paulista',
      streetNumber: '1000',
      city: 'São Paulo',
      region: 'SP',
      postalCode: '01310-100',
      countryCode: 'BR',
    },
    payments: [
      {
        method: 'card',
        status: 'approved',
        cardLast4: '4242',
        transactionRef: 'txn-9f3c1a',
        authorizationCode: 'auth-77aa21',
      },
    ],
    shipments: [
      {
        invoice: { number: 'INV-000123', amountCents: 25990 },
        delivered: true,
      },
    ],
    events: [
      { status: 'created', at: '2026-07-20T13:45:00.000Z' },
      { status: 'payment-approved', at: '2026-07-20T13:47:12.000Z' },
      { status: 'picking', at: '2026-07-20T13:50:00.000Z' },
      { status: 'invoiced', at: '2026-07-21T09:15:00.000Z' },
    ],
  },
  'ORDER-1002': {
    id: 'ORDER-1002',
    status: 'canceled',
    statusLabel: 'Canceled',
    createdAt: '2026-07-22T08:10:00.000Z',
    customer: {
      email: 'joao.pereira@example.com',
      givenName: 'João',
      familyName: 'Pereira',
      phone: '+55 21 97777-6666',
      taxId: '987.654.321-00',
    },
    shippingAddress: {
      street: 'Rua das Laranjeiras',
      streetNumber: '55',
      city: 'Rio de Janeiro',
      region: 'RJ',
      postalCode: '22240-006',
      countryCode: 'BR',
    },
    payments: [
      {
        method: 'card',
        status: 'denied',
        cardLast4: '1881',
        transactionRef: 'txn-2b7e40',
        authorizationCode: 'auth-00c9f4',
      },
    ],
    shipments: [],
    events: [
      { status: 'created', at: '2026-07-22T08:10:00.000Z' },
      { status: 'payment-denied', at: '2026-07-22T08:12:30.000Z' },
      { status: 'canceled', at: '2026-07-22T08:12:31.000Z' },
    ],
  },
};
