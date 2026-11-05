import { buildKnowledgeIndex } from '../build-index.ts';
import { createLexicalEmbedProvider } from '../embeddings/lexical-embed-provider.ts';
import type { KnowledgeIndex } from '../types.ts';

// A small, hand-picked, frozen fixture corpus — deliberately not derived
// from the committed support runbooks, the same "fixture-first" shape
// as `gateway/fixtures/` (ADR-0005). Each doc's topic is distinct on
// purpose so a retrieval-relevance test has an unambiguous expected
// winner (the knowledge-base requirement: "unit tests cover retrieval relevance
// for at least 2-3 representative queries against the frozen fixture
// index").

const FIXTURE_DOCS = [
  {
    title: 'Delivery options and SLAs',
    url: 'https://docs.example.com/runbooks/delivery-options-and-slas',
    content:
      'A SKU can have stock but zero delivery options if the seller has no shipping method ' +
      'configured for the destination postal code. This is a logistics and shipping policy ' +
      'issue, not an inventory problem: the SLA list comes back empty even though the item is ' +
      'available. Check the seller shipping policy coverage area for that postal code.',
  },
  {
    title: 'Payment status and denial reasons',
    url: 'https://docs.example.com/runbooks/payment-status',
    content:
      'An order payment can be denied by the card issuer for insufficient funds, a fraud ' +
      'check, or an expired card. A denied payment blocks invoicing until the customer retries ' +
      'with a different payment method or the issuer approves a retry.',
  },
  {
    title: 'Order cancellation flow',
    url: 'https://docs.example.com/runbooks/order-cancellation-flow',
    content:
      'Orders can be canceled by the seller, the marketplace, or the customer before ' +
      'invoicing. Once an order is invoiced, cancellation requires a separate reverse-logistics ' +
      'flow rather than a simple order status change.',
  },
];

let cached: Promise<KnowledgeIndex> | undefined;

/** Builds (and memoizes) the fixture `KnowledgeIndex` used by relevance tests. */
export function fixtureKnowledgeIndex(): Promise<KnowledgeIndex> {
  if (!cached) {
    cached = buildKnowledgeIndex(FIXTURE_DOCS, createLexicalEmbedProvider());
  }
  return cached;
}
