import { z } from 'zod';

export const LEDGER_FACT_SCHEMA_VERSION = '1';
export const FINDING_POLICY_VERSION = '1';

const AccountScopeSchema = z.strictObject({ accountId: z.string().min(1) });
const FactEnvelopeSchema = z.strictObject({
  investigationId: z.string().min(1),
  capabilityCallId: z.string().min(1),
  accountScope: AccountScopeSchema,
  observedAt: z.string().datetime(),
  schemaVersion: z.literal(LEDGER_FACT_SCHEMA_VERSION),
});

const InventoryFactSchema = FactEnvelopeSchema.extend({
  kind: z.literal('inventory'),
  capability: z.literal('inventory'),
  skuId: z.string().min(1),
  seller: z.string().min(1),
  requestedQuantity: z.number().positive(),
  availableQuantity: z.number().finite(),
});
const SymptomReproductionFactSchema = FactEnvelopeSchema.extend({
  kind: z.literal('symptom-reproduction'),
  capability: z.literal('fulfillment-simulation'),
  symptomCode: z.literal('STOCK_WITHOUT_DELIVERY_OPTIONS'),
  skuId: z.string().min(1),
  seller: z.string().min(1),
  requestedQuantity: z.number().positive(),
  destinationPostalCode: z.string().min(1),
  reproduced: z.boolean(),
});
const WarehouseToDockFactSchema = FactEnvelopeSchema.extend({
  kind: z.literal('warehouse-to-dock'),
  capability: z.literal('warehouse-to-dock'),
  warehouseId: z.string().min(1),
  dockId: z.string().min(1),
  routeAvailable: z.boolean(),
});
const DockToPolicyFactSchema = FactEnvelopeSchema.extend({
  kind: z.literal('dock-to-policy'),
  capability: z.literal('dock-to-policy'),
  dockId: z.string().min(1),
  policyId: z.string().min(1),
  routeAvailable: z.boolean(),
});
const DestinationCoverageFactSchema = FactEnvelopeSchema.extend({
  kind: z.literal('destination-coverage'),
  capability: z.literal('destination-coverage'),
  policyId: z.string().min(1),
  destinationPostalCode: z.string().min(1),
  covered: z.boolean(),
});

export const LedgerFactSchema = z.discriminatedUnion('kind', [
  InventoryFactSchema,
  SymptomReproductionFactSchema,
  WarehouseToDockFactSchema,
  DockToPolicyFactSchema,
  DestinationCoverageFactSchema,
]);

type MutableLedgerFact = z.infer<typeof LedgerFactSchema>;
export type LedgerFact = Readonly<MutableLedgerFact>;

const EvidenceLedgerInputSchema = z.strictObject({ facts: z.array(LedgerFactSchema).min(1) });
const EVIDENCE_LEDGER_BRAND = Symbol('EvidenceLedger');
export interface EvidenceLedger {
  readonly facts: readonly LedgerFact[];
  readonly [EVIDENCE_LEDGER_BRAND]: true;
}

function freezeLedger(ledger: z.infer<typeof EvidenceLedgerInputSchema>): EvidenceLedger {
  for (const fact of ledger.facts) {
    Object.freeze(fact.accountScope);
    Object.freeze(fact);
  }
  const immutableLedger = { facts: Object.freeze([...ledger.facts]) };
  Object.defineProperty(immutableLedger, EVIDENCE_LEDGER_BRAND, { value: true });
  return Object.freeze(immutableLedger) as EvidenceLedger;
}

/**
 * The sole construction boundary for durable evidence. It accepts only strict,
 * versioned results from named operational capabilities; raw payloads,
 * documentary material, and prose do not form Ledger Facts.
 */
export function createEvidenceLedger(input: unknown): EvidenceLedger {
  return freezeLedger(EvidenceLedgerInputSchema.parse(input));
}

/** The complete, active Finding taxonomy (ADR-0026) — the single source other modules enumerate from, rather than each redeclaring the two codes. */
export const FINDING_CODES = ['DESTINATION_NOT_COVERED', 'ROOT_CAUSE_UNDETERMINED'] as const;
export type FindingCode = (typeof FINDING_CODES)[number];
export type EvidenceContractResult = 'satisfied' | 'insufficient' | 'contradicted';
export type InvestigationDecision =
  | 'ready_for_human_resolution'
  | 'needs_input'
  | 'requires_specialist_review';
export type DecisionReason =
  | 'contract_satisfied'
  | 'required_input_missing'
  | 'capability_failed'
  | 'evidence_insufficient'
  | 'evidence_contradictory'
  | 'unsupported_case';

export interface FindingPolicyResult {
  readonly findingCode: FindingCode;
  readonly policyVersion: typeof FINDING_POLICY_VERSION;
  readonly contractResult: EvidenceContractResult;
  readonly decision: InvestigationDecision;
  readonly decisionReason: DecisionReason;
}

const REQUIRED_KINDS = [
  'inventory',
  'symptom-reproduction',
  'warehouse-to-dock',
  'dock-to-policy',
  'destination-coverage',
] as const;

function undetermined(contractResult: Exclude<EvidenceContractResult, 'satisfied'>, decisionReason: DecisionReason): FindingPolicyResult {
  return {
    findingCode: 'ROOT_CAUSE_UNDETERMINED',
    policyVersion: FINDING_POLICY_VERSION,
    contractResult,
    decision: 'requires_specialist_review',
    decisionReason,
  };
}

function isEvidenceLedger(input: unknown): input is EvidenceLedger {
  return input !== null && typeof input === 'object' && EVIDENCE_LEDGER_BRAND in input;
}

function hasConnectedProvenanceAndRoute(facts: readonly LedgerFact[]): boolean {
  const firstFact = facts[0];
  if (!firstFact) {
    return false;
  }
  if (
    !facts.every(
      (fact) =>
        fact.investigationId === firstFact.investigationId &&
        fact.accountScope.accountId === firstFact.accountScope.accountId
    )
  ) {
    return false;
  }

  const inventories = facts.filter((fact) => fact.kind === 'inventory');
  const symptoms = facts.filter((fact) => fact.kind === 'symptom-reproduction');
  const warehouseToDock = facts.filter((fact) => fact.kind === 'warehouse-to-dock');
  const dockToPolicy = facts.filter((fact) => fact.kind === 'dock-to-policy');
  const destinationCoverage = facts.filter((fact) => fact.kind === 'destination-coverage');

  return (
    inventories.every(
      (inventory) =>
        symptoms.every(
          (symptom) =>
            inventory.skuId === symptom.skuId &&
            inventory.seller === symptom.seller &&
            inventory.requestedQuantity === symptom.requestedQuantity
        )
    ) &&
    warehouseToDock.every((route) => dockToPolicy.every((policy) => route.dockId === policy.dockId)) &&
    dockToPolicy.every((policy) =>
      destinationCoverage.every((coverage) => policy.policyId === coverage.policyId)
    ) &&
    symptoms.every((symptom) =>
      destinationCoverage.every((coverage) => symptom.destinationPostalCode === coverage.destinationPostalCode)
    )
  );
}

/** Evaluates the complete operational Evidence Contract for the first supported finding. */
export function evaluateFindingPolicy(input: unknown): FindingPolicyResult {
  if (!isEvidenceLedger(input)) {
    return undetermined('insufficient', 'unsupported_case');
  }

  const facts = input.facts;
  if (REQUIRED_KINDS.some((kind) => !facts.some((fact) => fact.kind === kind))) {
    return undetermined('insufficient', 'evidence_insufficient');
  }

  if (!hasConnectedProvenanceAndRoute(facts)) {
    return undetermined('contradicted', 'evidence_contradictory');
  }

  const contradiction = facts.some((fact) => {
    switch (fact.kind) {
      case 'inventory':
        return fact.availableQuantity <= 0;
      case 'symptom-reproduction':
        return !fact.reproduced;
      case 'warehouse-to-dock':
      case 'dock-to-policy':
        return !fact.routeAvailable;
      case 'destination-coverage':
        return fact.covered;
      default:
        return false;
    }
  });
  if (contradiction) {
    return undetermined('contradicted', 'evidence_contradictory');
  }

  return {
    findingCode: 'DESTINATION_NOT_COVERED',
    policyVersion: FINDING_POLICY_VERSION,
    contractResult: 'satisfied',
    decision: 'ready_for_human_resolution',
    decisionReason: 'contract_satisfied',
  };
}
