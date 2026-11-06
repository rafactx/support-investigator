import { createFakeLanguageAssistance } from '../language-assistance/fake-language-assistance.ts';
import type {
  ExtractableIntakeField,
  ExtractedIntakeFields,
  LanguageAssistance,
} from '../language-assistance/types.ts';

/**
 * A labeled synthetic ticket for the intake-extraction eval harness ("at
 * least 30 labeled synthetic Portuguese and English tickets
 * report per-field exact-match precision/recall, confirmation behavior and
 * invented-identifier rate"). `expected` is the ground truth: a field is
 * absent from `expected` when the ticket text genuinely does not state it
 * (missing) or deliberately states it ambiguously (Language Assistance
 * must abstain, not guess). Every ticket requests all four
 * `ExtractableIntakeField`s — Account Scope is never one of them.
 *
 * `scriptedResponse` is what the deterministic gating harness
 * (`run-intake-evals.ts`, credential-free) scripts a fake extractor to
 * return for this ticket. It defaults to `expected` (a perfect
 * extraction) when omitted. A handful of tickets deliberately script a
 * wrong or fabricated value instead — a harness whose scripted "model" is
 * always perfect would make every metric here trivially 1.0/0.0 and prove
 * nothing about the metric computation itself.
 */
export interface IntakeGoldenTicket {
  readonly id: string;
  readonly language: 'en' | 'pt';
  readonly ticketText: string;
  readonly fieldsRequested: readonly ExtractableIntakeField[];
  readonly expected: ExtractedIntakeFields;
  readonly scriptedResponse?: ExtractedIntakeFields;
}

const ALL_FIELDS: readonly ExtractableIntakeField[] = ['skuId', 'seller', 'quantity', 'destinationPostalCode'];

export const INTAKE_GOLDEN_TICKETS: readonly IntakeGoldenTicket[] = [
  // --- English: clean, fully-specified tickets ---
  {
    id: 'intake-en-01',
    language: 'en',
    ticketText:
      'Customer reports that SKU-2002, sold by seller 1, shows no delivery option for postal code 01310-100. They tried to buy 2 units.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-2002', seller: '1', quantity: 2, destinationPostalCode: '01310-100' },
  },
  {
    id: 'intake-en-02',
    language: 'en',
    ticketText: 'Item SKU-3110 from seller 4, quantity 1, has nothing shipping near 04538-132.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-3110', seller: '4', quantity: 1, destinationPostalCode: '04538-132' },
  },
  {
    id: 'intake-en-10',
    language: 'en',
    ticketText: 'No delivery for SKU-8801 (seller 6) to 60175-050, order was for 5 units.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-8801', seller: '6', quantity: 5, destinationPostalCode: '60175-050' },
  },
  {
    id: 'intake-en-12',
    language: 'en',
    ticketText: 'SKU-2210, seller 9, 3 units, no shipping option shows up for 88015-201.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-2210', seller: '9', quantity: 3, destinationPostalCode: '88015-201' },
  },
  {
    id: 'intake-en-15',
    language: 'en',
    ticketText: 'Order for 1 unit of SKU-9004 through seller 2 fails at checkout for 01000-000.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-9004', seller: '2', quantity: 1, destinationPostalCode: '01000-000' },
  },
  {
    id: 'intake-en-16',
    language: 'en',
    ticketText: '4 units of SKU-1177, seller 5, no delivery to 30130-000 despite stock being available.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-1177', seller: '5', quantity: 4, destinationPostalCode: '30130-000' },
  },

  // --- English: one required field genuinely missing from the text ---
  {
    id: 'intake-en-03',
    language: 'en',
    ticketText: 'SKU-2002, seller 1, has no delivery to 01310-100 — customer wants to know why.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-2002', seller: '1', destinationPostalCode: '01310-100' }, // quantity never stated
  },
  {
    id: 'intake-en-04',
    language: 'en',
    ticketText: 'SKU-4021, seller 2, tried to order 3 units but checkout shows no shipping option at all.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-4021', seller: '2', quantity: 3 }, // destination never stated
  },
  {
    id: 'intake-en-05',
    language: 'en',
    ticketText: 'Nothing delivers to 20040-020 for SKU-5590, customer wanted 1 unit.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-5590', quantity: 1, destinationPostalCode: '20040-020' }, // seller never stated
  },
  {
    id: 'intake-en-06',
    language: 'en',
    ticketText: 'Seller 1 says nothing ships to 01310-100 for the 2-unit order the customer wants.',
    fieldsRequested: ALL_FIELDS,
    expected: { seller: '1', quantity: 2, destinationPostalCode: '01310-100' }, // SKU never stated
  },
  {
    id: 'intake-en-13',
    language: 'en',
    ticketText: 'SKU-7050 shows no delivery option for 45000-000.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-7050', destinationPostalCode: '45000-000' }, // seller and quantity never stated
  },

  // --- English: ambiguous — Language Assistance must abstain, not guess ---
  {
    id: 'intake-en-07',
    language: 'en',
    ticketText: "Customer isn't sure if it's SKU-2002 or SKU-2003 — either way, nothing delivers to 01310-100.",
    fieldsRequested: ALL_FIELDS,
    expected: { destinationPostalCode: '01310-100' }, // skuId deliberately ambiguous
  },

  // --- English: no identifiers stated at all ---
  {
    id: 'intake-en-08',
    language: 'en',
    ticketText: 'The customer is upset that their order has no delivery option available.',
    fieldsRequested: ALL_FIELDS,
    expected: {},
  },

  // --- English: decoy number present (price), scripted as a wrong-but-grounded false positive ---
  {
    id: 'intake-en-09',
    language: 'en',
    ticketText: 'SKU-6002, seller 3, price $199, customer ordered 4 units, no shipping to 55030-000.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-6002', seller: '3', quantity: 4, destinationPostalCode: '55030-000' },
    scriptedResponse: { skuId: 'SKU-6002', seller: '3', quantity: 199, destinationPostalCode: '55030-000' },
  },

  // --- English: adversarial — scripted response invents an identifier absent from the ticket text ---
  {
    id: 'intake-en-14',
    language: 'en',
    ticketText: 'Customer reports no delivery option to 01310-100, no SKU mentioned in the ticket.',
    fieldsRequested: ALL_FIELDS,
    expected: { destinationPostalCode: '01310-100' },
    scriptedResponse: { skuId: 'SKU-9999-FAKE', destinationPostalCode: '01310-100' },
  },

  // --- Portuguese: clean, fully-specified tickets ---
  {
    id: 'intake-pt-01',
    language: 'pt',
    ticketText:
      'O cliente informa que o SKU-2002, vendido pelo seller 1, não tem opção de entrega para o CEP 01310-100. Ele tentou comprar 2 unidades.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-2002', seller: '1', quantity: 2, destinationPostalCode: '01310-100' },
  },
  {
    id: 'intake-pt-02',
    language: 'pt',
    ticketText: 'O item SKU-3110, do seller 4, quantidade 1, não entrega perto do CEP 04538-132.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-3110', seller: '4', quantity: 1, destinationPostalCode: '04538-132' },
  },
  {
    id: 'intake-pt-10',
    language: 'pt',
    ticketText: 'Sem entrega para o SKU-8801 (seller 6) no CEP 60175-050, o pedido era de 5 unidades.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-8801', seller: '6', quantity: 5, destinationPostalCode: '60175-050' },
  },
  {
    id: 'intake-pt-12',
    language: 'pt',
    ticketText: 'SKU-2210, seller 9, 3 unidades, nenhuma opção de frete aparece para 88015-201.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-2210', seller: '9', quantity: 3, destinationPostalCode: '88015-201' },
  },
  {
    id: 'intake-pt-15',
    language: 'pt',
    ticketText: 'O pedido de 1 unidade do SKU-9004 pelo seller 2 falha no checkout para o CEP 01000-000.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-9004', seller: '2', quantity: 1, destinationPostalCode: '01000-000' },
  },
  {
    id: 'intake-pt-16',
    language: 'pt',
    ticketText: '4 unidades do SKU-1177, seller 5, sem entrega para 30130-000 mesmo com estoque disponível.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-1177', seller: '5', quantity: 4, destinationPostalCode: '30130-000' },
  },

  // --- Portuguese: one required field genuinely missing from the text ---
  {
    id: 'intake-pt-03',
    language: 'pt',
    ticketText: 'SKU-2002, seller 1, está sem entrega para 01310-100, o cliente quer saber o motivo.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-2002', seller: '1', destinationPostalCode: '01310-100' },
  },
  {
    id: 'intake-pt-04',
    language: 'pt',
    ticketText: 'SKU-4021, seller 2, tentou pedir 3 unidades mas o checkout não mostra opção de frete.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-4021', seller: '2', quantity: 3 },
  },
  {
    id: 'intake-pt-05',
    language: 'pt',
    ticketText: 'Nada entrega no CEP 20040-020 para o SKU-5590, o cliente queria 1 unidade.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-5590', quantity: 1, destinationPostalCode: '20040-020' },
  },
  {
    id: 'intake-pt-06',
    language: 'pt',
    ticketText: 'O seller 1 diz que nada entrega para 01310-100 no pedido de 2 unidades que o cliente quer.',
    fieldsRequested: ALL_FIELDS,
    expected: { seller: '1', quantity: 2, destinationPostalCode: '01310-100' },
  },
  {
    id: 'intake-pt-13',
    language: 'pt',
    ticketText: 'O SKU-7050 está sem opção de entrega para 45000-000.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-7050', destinationPostalCode: '45000-000' },
  },

  // --- Portuguese: ambiguous — Language Assistance must abstain, not guess ---
  {
    id: 'intake-pt-07',
    language: 'pt',
    ticketText: 'O cliente não tem certeza se é o SKU-2002 ou o SKU-2003, de todo modo nada entrega para 01310-100.',
    fieldsRequested: ALL_FIELDS,
    expected: { destinationPostalCode: '01310-100' },
  },

  // --- Portuguese: no identifiers stated at all ---
  {
    id: 'intake-pt-08',
    language: 'pt',
    ticketText: 'O cliente está insatisfeito porque o pedido não tem nenhuma opção de entrega disponível.',
    fieldsRequested: ALL_FIELDS,
    expected: {},
  },

  // --- Portuguese: decoy number present (preço), scripted as a wrong-but-grounded false positive ---
  {
    id: 'intake-pt-09',
    language: 'pt',
    ticketText: 'SKU-6002, seller 3, preço R$ 199, o cliente pediu 4 unidades, sem frete para 55030-000.',
    fieldsRequested: ALL_FIELDS,
    expected: { skuId: 'SKU-6002', seller: '3', quantity: 4, destinationPostalCode: '55030-000' },
    scriptedResponse: { skuId: 'SKU-6002', seller: '3', quantity: 199, destinationPostalCode: '55030-000' },
  },

  // --- Portuguese: adversarial — scripted response invents an identifier absent from the ticket text ---
  {
    id: 'intake-pt-14',
    language: 'pt',
    ticketText: 'Cliente relata sem opção de entrega para 01310-100, nenhum SKU foi mencionado no chamado.',
    fieldsRequested: ALL_FIELDS,
    expected: { destinationPostalCode: '01310-100' },
    scriptedResponse: { skuId: 'SKU-9999-FAKE', destinationPostalCode: '01310-100' },
  },
];

/**
 * The credential-free, deterministic `LanguageAssistance` the gating
 * harness (`run-intake-evals.ts`, `pnpm evals:intake`) runs against: each
 * ticket's own `scriptedResponse` (or, when absent, its `expected` ground
 * truth — a perfect extraction) is looked up by exact `ticketText` match
 * and filtered down to the fields actually requested, mirroring how
 * `buildIntake` only ever asks for the fields still missing.
 */
export function createScriptedIntakeLanguageAssistance(
  tickets: readonly IntakeGoldenTicket[] = INTAKE_GOLDEN_TICKETS,
): LanguageAssistance {
  const byTicketText = new Map(tickets.map((ticket) => [ticket.ticketText, ticket]));

  return createFakeLanguageAssistance((request) => {
    const ticket = byTicketText.get(request.ticketText);
    const response = ticket?.scriptedResponse ?? ticket?.expected ?? {};
    const fields: Record<string, string | number> = {};
    for (const field of request.fields) {
      const value = response[field];
      if (value !== undefined) {
        fields[field] = value;
      }
    }
    return { kind: 'extracted', fields: fields as ExtractedIntakeFields };
  });
}
