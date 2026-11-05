/**
 * Raw order shape as the commerce platform's order API returns it
 * (provider-shaped per ADR-0005 — this is what the `fixture`
 * CommerceGateway serves and what a future live adapter would receive
 * verbatim). Deliberately carries the PII fields the Support MCP tool
 * layer must strip before this ever reaches an agent (see
 * `toOrderContext` in `order-context.ts`).
 */
export interface RawOrder {
  id: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  customer: {
    email: string;
    givenName: string;
    familyName: string;
    phone: string;
    taxId: string;
  };
  shippingAddress: {
    street: string;
    streetNumber: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
  };
  payments: Array<{
    method: string;
    status: 'approved' | 'denied' | 'canceled' | 'pending';
    cardLast4?: string;
    transactionRef: string;
    authorizationCode: string;
  }>;
  shipments: Array<{
    invoice?: { number: string; amountCents: number };
    delivered: boolean;
  }>;
  events: Array<{ status: string; at: string }>;
}
