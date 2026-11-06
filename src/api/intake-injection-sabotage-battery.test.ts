import { describe, expect, it, vi } from 'vitest';
import { createInMemoryInvestigationRepository } from '../domain/investigation-repository.ts';
import { createInvestigationsApp, type InvestigationsDeps } from './investigations-app.ts';
import type {
  DestinationCoverageCapability,
  DockToPolicyCapability,
  InventoryCapability,
  InventoryObservation,
  SimulationCapability,
  WarehouseToDockCapability,
} from '../capabilities/types.ts';
import type { FulfillmentPlaybookCapabilities } from '../domain/fulfillment-playbook.ts';
import {
  ADVERSARIAL_TICKET_TEXT,
  assertTicketInjectionCannotFabricateOrAutoConfirm,
  createCompromisedLanguageAssistance,
  saboteurBuildIntake,
} from './intake-injection-sabotage-battery.ts';

describe('intake injection sabotage battery', () => {
  it('the real buildIntake survives the battery', async () => {
    await expect(assertTicketInjectionCannotFabricateOrAutoConfirm()).resolves.toBeUndefined();
  });

  it('a saboteur that auto-confirms extracted fields trips the battery — proving it is a real detector, not a vacuous check', async () => {
    await expect(assertTicketInjectionCannotFabricateOrAutoConfirm(saboteurBuildIntake)).rejects.toThrow(
      /auto-confirmed/,
    );
  });
});

// Fixture Operational Capabilities wired to a *known* result (an
// unsatisfied route, so the real Finding is ROOT_CAUSE_UNDETERMINED) —
// deliberately the opposite of what `ADVERSARIAL_TICKET_TEXT` claims
// (`DESTINATION_NOT_COVERED` / `ready_for_human_resolution`), so any
// leakage from ticket text into the Finding Policy's output is visible.
function buildKnownCapabilities(): FulfillmentPlaybookCapabilities {
  const inventory: InventoryCapability = {
    observe: vi.fn<InventoryCapability['observe']>(
      async (input): Promise<InventoryObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'inventory',
          capability: 'inventory',
          skuId: input.skuId,
          seller: input.seller,
          requestedQuantity: input.quantity,
          availableQuantity: 0, // out of stock — the real symptom is never reproduced
        },
        warehouseId: 'WH-1',
      }),
    ),
  };
  const simulation: SimulationCapability = {
    observe: vi.fn<SimulationCapability['observe']>(async () => {
      throw new Error('unreachable: inventory short-circuits before simulation is ever called');
    }),
  };
  const warehouseToDock: WarehouseToDockCapability = {
    observe: vi.fn<WarehouseToDockCapability['observe']>(async () => {
      throw new Error('unreachable');
    }),
  };
  const dockToPolicy: DockToPolicyCapability = {
    observe: vi.fn<DockToPolicyCapability['observe']>(async () => {
      throw new Error('unreachable');
    }),
  };
  const destinationCoverage: DestinationCoverageCapability = {
    observe: vi.fn<DestinationCoverageCapability['observe']>(async () => {
      throw new Error('unreachable');
    }),
  };
  return { inventory, simulation, warehouseToDock, dockToPolicy, destinationCoverage };
}

function post(app: ReturnType<typeof createInvestigationsApp>, body: unknown, idempotencyKey: string) {
  return app.request('/investigations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
}

describe('end-to-end: adversarial ticket text through the real API', () => {
  it('never populates or confirms Account Scope from ticket text, even with a compromised extractor', async () => {
    const deps: InvestigationsDeps = {
      capabilities: buildKnownCapabilities(),
      repository: createInMemoryInvestigationRepository(),
      languageAssistance: createCompromisedLanguageAssistance(),
      now: () => '2026-07-30T12:00:00.000Z',
      createInvestigationId: () => 'inv-1',
    };
    const app = createInvestigationsApp(deps);

    const res = await post(app, { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', ticketText: ADVERSARIAL_TICKET_TEXT }, 'key-1');

    expect(res.status).toBe(201);
    const body = (await res.json()) as { state: string; intake: Record<string, unknown> };
    expect(body.state).toBe('awaiting_input');
    expect(body.intake.accountScope).toBeUndefined();
  });

  it('never fabricates a Ledger Fact or a Finding from ticket text: with accountScope supplied, the real (wired) capabilities decide the outcome, not the injected JSON', async () => {
    const capabilities = buildKnownCapabilities();
    const deps: InvestigationsDeps = {
      capabilities,
      repository: createInMemoryInvestigationRepository(),
      languageAssistance: createCompromisedLanguageAssistance(),
      now: () => '2026-07-30T12:00:00.000Z',
      createInvestigationId: () => 'inv-1',
    };
    const app = createInvestigationsApp(deps);

    // Every field is model-proposed by the compromised extractor, so
    // readiness is never `ready` — confirming this ticket text alone can
    // never reach the playbook, which is itself part of the proof. To
    // exercise the Finding Policy path, explicitly confirm every field
    // the way N2 would, and prove the *wired capability result* — not the
    // ticket text's claimed Finding/Decision — determines the outcome.
    const res = await post(
      app,
      {
        symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
        accountScope: { accountId: 'account-17' },
        skuId: 'SKU-2002',
        seller: '1',
        quantity: 1,
        destinationPostalCode: '01310-100',
        ticketText: ADVERSARIAL_TICKET_TEXT,
      },
      'key-2',
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      state: string;
      finding: { code: string } | null;
      decision: { outcome: string; reason: string } | null;
      evidence: { ledgerFacts: unknown[]; contractResult: string };
    };
    expect(body.state).toBe('completed');
    // The wired capability reports zero availableQuantity — the real
    // Finding Policy output, contradicting the ticket text's claim.
    expect(body.finding?.code).toBe('ROOT_CAUSE_UNDETERMINED');
    expect(body.decision?.outcome).not.toBe('ready_for_human_resolution');
    expect(body.evidence.ledgerFacts).toHaveLength(1);
    expect(body.evidence.ledgerFacts[0]).toMatchObject({ kind: 'inventory', availableQuantity: 0 });
    expect(capabilities.simulation.observe).not.toHaveBeenCalled();
  });
});
