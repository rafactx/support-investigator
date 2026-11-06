import { describe, expect, it, vi } from 'vitest';
import { createInMemoryInvestigationRepository } from '../domain/investigation-repository.ts';
import {
  createInvestigationsApp,
  TICKET_TEXT_MAX_LENGTH,
  type InvestigationsDeps,
} from './investigations-app.ts';
import { createFulfillmentCapabilities } from '../capabilities/create-fulfillment-capabilities.ts';
import { createFixtureCommerceGateway } from '../gateway/fixture-commerce-gateway.ts';
import type {
  CapabilityObservation,
  DestinationCoverageCapability,
  DockToPolicyCapability,
  InventoryCapability,
  InventoryObservation,
  SimulationCapability,
  WarehouseToDockCapability,
} from '../capabilities/types.ts';
import type { FulfillmentPlaybookCapabilities } from '../domain/fulfillment-playbook.ts';
import {
  createFakeLanguageAssistance,
  explanationUnavailableScript,
  fabricatedIdentifierImprovementScript,
  fixedFieldsScript,
  groundedImprovementScript,
  unavailableScript,
  type FakeExplanationScript,
} from '../language-assistance/fake-language-assistance.ts';
import type { LanguageAssistance } from '../language-assistance/types.ts';

const VALID_REQUEST = {
  symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
  accountScope: { accountId: 'account-17' },
  skuId: 'SKU-2002',
  seller: '1',
  quantity: 1,
  destinationPostalCode: '01310-100',
};

// Every raw field name a capability parses out of a raw provider payload
// and deliberately discards before building its Ledger Fact. The
// detector fails loudly if a future change spreads a raw payload into a
// fact or an error body instead of normalizing it.
const RAW_PROVIDER_FIELD_NAMES = [
  'stockLevels',
  'onHand',
  'unlimited',
  'dockIds',
  'shippingPolicyIds',
  'externalRateProviders',
  'postalCodeFrom',
  'postalCodeTo',
  'geofenceId',
  'deliveryOptions',
  'unitPriceCents',
  'compareAtPriceCents',
  'transitBusinessDays',
];

function expectNoRawProviderFields(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const field of RAW_PROVIDER_FIELD_NAMES) {
    expect(serialized).not.toContain(field);
  }
}

function buildCapabilities(
  overrides: Partial<FulfillmentPlaybookCapabilities> = {},
): FulfillmentPlaybookCapabilities {
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
          availableQuantity: 8,
        },
        warehouseId: 'WH-1',
      }),
    ),
  };
  const simulation: SimulationCapability = {
    observe: vi.fn<SimulationCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'symptom-reproduction',
          capability: 'fulfillment-simulation',
          symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
          skuId: input.skuId,
          seller: input.seller,
          requestedQuantity: input.quantity,
          destinationPostalCode: input.destinationPostalCode,
          reproduced: true,
        },
      }),
    ),
  };
  const warehouseToDock: WarehouseToDockCapability = {
    observe: vi.fn<WarehouseToDockCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'warehouse-to-dock',
          capability: 'warehouse-to-dock',
          warehouseId: input.warehouseId,
          dockId: 'DOCK-1',
          routeAvailable: true,
        },
      }),
    ),
  };
  const dockToPolicy: DockToPolicyCapability = {
    observe: vi.fn<DockToPolicyCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'dock-to-policy',
          capability: 'dock-to-policy',
          dockId: input.dockId,
          policyId: 'POLICY-1',
          routeAvailable: true,
        },
      }),
    ),
  };
  const destinationCoverage: DestinationCoverageCapability = {
    observe: vi.fn<DestinationCoverageCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'destination-coverage',
          capability: 'destination-coverage',
          policyId: input.policyId,
          destinationPostalCode: input.destinationPostalCode,
          covered: false,
        },
      }),
    ),
  };

  return { inventory, simulation, warehouseToDock, dockToPolicy, destinationCoverage, ...overrides };
}

function buildApp(
  capabilitiesOverrides: Partial<FulfillmentPlaybookCapabilities> = {},
  languageAssistance?: LanguageAssistance,
) {
  const capabilities = buildCapabilities(capabilitiesOverrides);
  const deps: InvestigationsDeps = {
    capabilities,
    repository: createInMemoryInvestigationRepository(),
    languageAssistance,
    now: () => '2026-07-30T12:00:00.000Z',
    createInvestigationId: (() => {
      let n = 0;
      return () => `inv-${++n}`;
    })(),
  };
  return { app: createInvestigationsApp(deps), capabilities, deps };
}

function post(app: ReturnType<typeof createInvestigationsApp>, body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return app.request('/investigations', { method: 'POST', headers, body: JSON.stringify(body) });
}

function patchIntake(
  app: ReturnType<typeof createInvestigationsApp>,
  id: string,
  body: unknown,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return app.request(`/investigations/${id}/intake`, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

/**
 * Builds an app whose Language Assistance always uses `script` for
 * `improveExplanation`, wrapped in a `vi.fn` spy so tests can assert call
 * counts directly ("at most one bounded model call per
 * accepted command" is only provable by counting calls, not by reading a
 * response body).
 */
function buildAppWithExplanationScript(script: FakeExplanationScript) {
  const explanationScript = vi.fn(script);
  const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({}), explanationScript);
  const { app, capabilities } = buildApp({}, languageAssistance);
  return { app, capabilities, explanationScript };
}

async function seedCompleted(app: ReturnType<typeof createInvestigationsApp>, idempotencyKey = 'create-key') {
  const res = await post(app, VALID_REQUEST, idempotencyKey);
  return (await res.json()) as { id: string; revision: number };
}

function postExplanation(
  app: ReturnType<typeof createInvestigationsApp>,
  id: string,
  body: unknown,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return app.request(`/investigations/${id}/explanations`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function postReview(
  app: ReturnType<typeof createInvestigationsApp>,
  id: string,
  body: unknown,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return app.request(`/investigations/${id}/reviews`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /investigations', () => {
  it('creates a completed investigation with DESTINATION_NOT_COVERED when the full route is satisfied', async () => {
    const { app } = buildApp();

    const res = await post(app, VALID_REQUEST, 'key-1');

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe('inv-1');
    expect(body.state).toBe('completed');
    expect(body.revision).toBe(1);
    expect((body.intake as Record<string, unknown>).symptomCode).toBe('STOCK_WITHOUT_DELIVERY_OPTIONS');
    const intake = body.intake as { skuId: { source: string; confirmed: boolean } };
    expect(intake.skuId).toEqual({ value: 'SKU-2002', source: 'user', confirmed: true });
    const evidence = body.evidence as { ledgerFacts: unknown[]; contractResult: string; capabilityFailure: unknown };
    expect(evidence.ledgerFacts).toHaveLength(5);
    expect(evidence.contractResult).toBe('satisfied');
    expect(evidence.capabilityFailure).toBeNull();
    expect((body.finding as Record<string, unknown>).code).toBe('DESTINATION_NOT_COVERED');
    expect((body.decision as Record<string, unknown>).outcome).toBe('ready_for_human_resolution');
    expect((body.decision as Record<string, unknown>).reason).toBe('contract_satisfied');
    expect((body.explanation as Record<string, unknown>).summary).toBeTruthy();
  });

  it('runs Operational Capabilities directly, never through this app’s own MCP endpoint (no mcpClient in deps)', async () => {
    const { app, capabilities } = buildApp();
    await post(app, VALID_REQUEST, 'key-1');
    expect(capabilities.inventory.observe).toHaveBeenCalledTimes(1);
  });

  it('emits allowlisted structured log entries correlated to the Investigation and capability calls, never ticket text', async () => {
    const { deps } = buildApp();
    const log = vi.fn();
    const app = createInvestigationsApp({ ...deps, log });

    const res = await post(
      app,
      { ...VALID_REQUEST, ticketText: 'Customer provided an internal order note that must never be logged.' },
      'key-1',
    );

    expect(res.status).toBe(201);
    const entries = log.mock.calls.map(([entry]) => entry as Record<string, unknown>);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'investigation_created', investigationId: 'inv-1' }),
        expect.objectContaining({
          event: 'capability_called',
          investigationId: 'inv-1',
          capability: 'inventory',
          capabilityCallId: expect.any(String),
        }),
        expect.objectContaining({ event: 'capability_observed', investigationId: 'inv-1', capability: 'inventory' }),
      ])
    );
    expect(entries.some((entry) => typeof entry.capabilityCallId === 'string')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('internal order note');
  });

  it('surfaces a capability failure as its own field with an empty ledger, not a technical failed state (ADR-0037)', async () => {
    const { app } = buildApp({
      inventory: {
        observe: vi.fn(async () => ({
          kind: 'unavailable' as const,
          failure: { kind: 'permission_denied' as const, capability: 'inventory' as const, message: 'Inventory access was denied.' },
        })),
      },
    });

    const res = await post(app, VALID_REQUEST, 'key-1');

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.state).toBe('completed');
    const evidence = body.evidence as { ledgerFacts: unknown[]; capabilityFailure: Record<string, unknown> };
    expect(evidence.ledgerFacts).toHaveLength(0);
    expect(evidence.capabilityFailure).toEqual({
      kind: 'permission_denied',
      capability: 'inventory',
      message: 'Inventory access was denied.',
    });
    expect((body.decision as Record<string, unknown>).outcome).toBe('requires_specialist_review');
    expect((body.decision as Record<string, unknown>).reason).toBe('capability_failed');
  });

  it('returns a structured 400 for a non-JSON body', async () => {
    const { app } = buildApp();
    const res = await app.request('/investigations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-1' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns a structured 400 with issues for a body that fails schema validation', async () => {
    const { app } = buildApp();
    const res = await post(app, { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS' }, 'key-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues?: string[] } };
    expect(body.error.issues?.length).toBeGreaterThan(0);
  });

  it('returns a structured 400 when Idempotency-Key is missing', async () => {
    const { app } = buildApp();
    const res = await post(app, VALID_REQUEST);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Idempotency-Key/);
  });

  it('logs only a classified error kind when persistence fails, never the provider message', async () => {
    const { deps } = buildApp();
    const log = vi.fn();
    const app = createInvestigationsApp({
      ...deps,
      repository: {
        ...deps.repository,
        async findByIdempotencyKey() {
          throw Object.assign(new Error('Access denied to table containing merchant data'), { name: 'AccessDeniedException' });
        },
      },
      log,
    });

    const res = await post(app, VALID_REQUEST, 'key-1');

    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledWith({ event: 'unhandled_error', errorKind: 'access_denied' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('merchant data');
  });

  describe('idempotency', () => {
    it('an exact retry (same key, same payload) returns the original investigation without re-running capabilities', async () => {
      const { app, capabilities } = buildApp();
      const first = await post(app, VALID_REQUEST, 'key-1');
      const firstBody = (await first.json()) as { id: string };

      const second = await post(app, VALID_REQUEST, 'key-1');
      const secondBody = (await second.json()) as { id: string };

      expect(secondBody.id).toBe(firstBody.id);
      expect(capabilities.inventory.observe).toHaveBeenCalledTimes(1);
      expect(capabilities.destinationCoverage.observe).toHaveBeenCalledTimes(1);
    });

    it('reusing a key with a different payload returns a structured 409 conflict', async () => {
      const { app } = buildApp();
      await post(app, VALID_REQUEST, 'key-1');

      const res = await post(app, { ...VALID_REQUEST, skuId: 'SKU-9999' }, 'key-1');

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toBeTruthy();
    });

    it('a different key with the same payload creates a distinct investigation', async () => {
      const { app } = buildApp();
      const first = await post(app, VALID_REQUEST, 'key-1');
      const second = await post(app, VALID_REQUEST, 'key-2');

      const firstBody = (await first.json()) as { id: string };
      const secondBody = (await second.json()) as { id: string };
      expect(firstBody.id).not.toBe(secondBody.id);
    });
  });

  describe('no raw provider payload or ticket text anywhere in the response', () => {
    it('the satisfied-contract response carries only normalized fields', async () => {
      const { app } = buildApp();
      const res = await post(app, VALID_REQUEST, 'key-1');
      expectNoRawProviderFields(await res.json());
    });

    it('the capability-failure response carries only normalized fields', async () => {
      const { app } = buildApp({
        inventory: {
          observe: vi.fn(async () => ({
            kind: 'unavailable' as const,
            failure: {
              kind: 'schema_failure' as const,
              capability: 'inventory' as const,
              message: 'Inventory returned an unsupported response.',
            },
          })),
        },
      });
      const res = await post(app, VALID_REQUEST, 'key-1');
      expectNoRawProviderFields(await res.json());
    });

    it('every 4xx error body carries only the structured error shape', async () => {
      const { app } = buildApp();
      const invalidBody = await post(app, { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS' }, 'key-1');
      expectNoRawProviderFields(await invalidBody.json());

      await post(app, VALID_REQUEST, 'key-1');
      const conflict = await post(app, { ...VALID_REQUEST, skuId: 'SKU-9999' }, 'key-1');
      expectNoRawProviderFields(await conflict.json());
    });
  });
});

describe('GET /investigations/:id', () => {
  it('returns the Current Investigation for a known id', async () => {
    const { app } = buildApp();
    const created = await post(app, VALID_REQUEST, 'key-1');
    const { id } = (await created.json()) as { id: string };

    const res = await app.request(`/investigations/${id}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(id);
  });

  it('returns a structured 404 for an unknown id', async () => {
    const { app } = buildApp();
    const res = await app.request('/investigations/does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBeTruthy();
  });
});

describe('POST /investigations: ticket text and partial intake', () => {
  it('rejects a request with neither ticketText nor any structured field', async () => {
    const { app } = buildApp();
    const res = await post(app, { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS' }, 'key-1');
    expect(res.status).toBe(400);
  });

  it('creates awaiting_input when ticketText is given without accountScope, and never invokes capabilities', async () => {
    const languageAssistance = createFakeLanguageAssistance(
      fixedFieldsScript({ skuId: 'SKU-2002', seller: '1', quantity: 1, destinationPostalCode: '01310-100' }),
    );
    const { app, capabilities } = buildApp({}, languageAssistance);

    const res = await post(app, { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', ticketText: 'SKU-2002 out of route' }, 'key-1');

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      state: string;
      intake: Record<string, { source: string; confirmed: boolean } | undefined>;
      intakeGaps: Array<{ field: string; reason: string }>;
    };
    expect(body.state).toBe('awaiting_input');
    expect(body.intake.accountScope).toBeUndefined();
    expect(body.intake.skuId).toEqual({ value: 'SKU-2002', source: 'model', confirmed: false });
    expect(body.intakeGaps).toEqual(
      expect.arrayContaining([{ field: 'accountScope', reason: 'missing' }]),
    );
    expect(body.intakeGaps.some((gap) => gap.field === 'skuId' && gap.reason === 'unconfirmed')).toBe(true);
    expect(capabilities.inventory.observe).not.toHaveBeenCalled();
  });

  it('stays awaiting_input even when Language Assistance proposes every remaining field — a proposal alone never resumes the playbook', async () => {
    const languageAssistance = createFakeLanguageAssistance(
      fixedFieldsScript({ skuId: 'SKU-2002', seller: '1', quantity: 1, destinationPostalCode: '01310-100' }),
    );
    const { app, capabilities } = buildApp({}, languageAssistance);

    const res = await post(
      app,
      {
        symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
        accountScope: { accountId: 'account-17' },
        ticketText: 'SKU-2002, seller 1, qty 1, no delivery to 01310-100',
      },
      'key-1',
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      state: string;
      intake: { skuId: { value: string; source: string; confirmed: boolean } };
      intakeGaps: Array<{ field: string; reason: string }>;
    };
    expect(body.state).toBe('awaiting_input');
    expect(body.intake.skuId).toEqual({ value: 'SKU-2002', source: 'model', confirmed: false });
    expect(body.intakeGaps).toHaveLength(4);
    expect(body.intakeGaps.every((gap) => gap.reason === 'unconfirmed')).toBe(true);
    expect(capabilities.inventory.observe).not.toHaveBeenCalled();
  });

  it('explicit structured values always take precedence over a Language Assistance proposal for the same field', async () => {
    const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({ skuId: 'SKU-WRONG' }));
    const { app } = buildApp({}, languageAssistance);

    const res = await post(
      app,
      {
        symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
        skuId: 'SKU-2002',
        ticketText: 'mentions a different SKU entirely',
      },
      'key-1',
    );

    const body = (await res.json()) as { intake: { skuId: { value: string; source: string; confirmed: boolean } } };
    expect(body.intake.skuId).toEqual({ value: 'SKU-2002', source: 'user', confirmed: true });
  });

  it('falls back to awaiting_input, not an error, when Language Assistance is unavailable', async () => {
    const { app, capabilities } = buildApp({}, createFakeLanguageAssistance(unavailableScript('Bedrock outage')));

    const res = await post(
      app,
      { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', accountScope: { accountId: 'account-17' }, ticketText: 'SKU-2002 stuck' },
      'key-1',
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe('awaiting_input');
    expect(capabilities.inventory.observe).not.toHaveBeenCalled();
  });

  it('a fully explicit structured request with no ticketText behaves exactly as before (backward compatible)', async () => {
    const { app } = buildApp();
    const res = await post(app, VALID_REQUEST, 'key-1');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe('completed');
  });

  it('a partial structured request without ticketText is awaiting_input with the right gaps', async () => {
    const { app } = buildApp();
    const { seller: _seller, ...withoutSeller } = VALID_REQUEST;
    const res = await post(app, withoutSeller, 'key-1');

    expect(res.status).toBe(201);
    const body = (await res.json()) as { state: string; intakeGaps: Array<{ field: string; reason: string }> };
    expect(body.state).toBe('awaiting_input');
    expect(body.intakeGaps).toEqual([{ field: 'seller', reason: 'missing' }]);
  });
});

describe('PATCH /investigations/:id/intake', () => {
  async function seedAwaitingInvestigation() {
    const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({ skuId: 'SKU-2002' }));
    const { app, capabilities } = buildApp({}, languageAssistance);
    const created = await post(
      app,
      { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', accountScope: { accountId: 'account-17' }, ticketText: 'SKU-2002 problem' },
      'create-key',
    );
    const body = (await created.json()) as { id: string; revision: number; state: string };
    expect(body.state).toBe('awaiting_input');
    return { app, capabilities, id: body.id, revision: body.revision };
  }

  it('returns 404 for an unknown investigation', async () => {
    const { app } = buildApp();
    const res = await patchIntake(app, 'does-not-exist', { expectedRevision: 0, seller: '1' }, 'patch-key');
    expect(res.status).toBe(404);
  });

  it('returns 400 when Idempotency-Key is missing', async () => {
    const { app, id } = await seedAwaitingInvestigation();
    const res = await patchIntake(app, id, { expectedRevision: 1, seller: '1' });
    expect(res.status).toBe(400);
  });

  it('completing every remaining field resumes the investigation synchronously to completed', async () => {
    const { app, capabilities, id, revision } = await seedAwaitingInvestigation();

    const res = await patchIntake(
      app,
      id,
      {
        expectedRevision: revision,
        seller: '1',
        quantity: 1,
        destinationPostalCode: '01310-100',
        confirm: ['skuId'],
      },
      'patch-key',
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: string;
      revision: number;
      finding: { code: string };
      intake: { skuId: { source: string; confirmed: boolean } };
    };
    expect(body.state).toBe('completed');
    expect(body.revision).toBe(2);
    expect(body.finding.code).toBe('DESTINATION_NOT_COVERED');
    // Confirming preserves provenance: the field stays model-sourced, only confirmed flips.
    expect(body.intake.skuId).toEqual({ value: 'SKU-2002', source: 'model', confirmed: true });
    expect(capabilities.inventory.observe).toHaveBeenCalledTimes(1);
  });

  it('a correction overrides a model-proposed value and becomes source: user', async () => {
    const { app, id, revision } = await seedAwaitingInvestigation();

    const res = await patchIntake(
      app,
      id,
      { expectedRevision: revision, skuId: 'SKU-CORRECTED', seller: '1', quantity: 1, destinationPostalCode: '01310-100' },
      'patch-key',
    );

    const body = (await res.json()) as { intake: { skuId: { value: string; source: string; confirmed: boolean } } };
    expect(body.intake.skuId).toEqual({ value: 'SKU-CORRECTED', source: 'user', confirmed: true });
  });

  it('completing only some fields stays awaiting_input with the remaining gaps, without invoking capabilities', async () => {
    const { app, capabilities, id, revision } = await seedAwaitingInvestigation();

    const res = await patchIntake(app, id, { expectedRevision: revision, seller: '1' }, 'patch-key');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; intakeGaps: Array<{ field: string; reason: string }> };
    expect(body.state).toBe('awaiting_input');
    expect(body.intakeGaps.some((gap) => gap.field === 'skuId' && gap.reason === 'unconfirmed')).toBe(true);
    expect(capabilities.inventory.observe).not.toHaveBeenCalled();
  });

  it('a stale expectedRevision returns a structured 409, not a silent overwrite', async () => {
    const { app, id, revision } = await seedAwaitingInvestigation();
    await patchIntake(app, id, { expectedRevision: revision, seller: '1' }, 'patch-key-1');

    const stale = await patchIntake(app, id, { expectedRevision: revision, quantity: 1 }, 'patch-key-2');
    expect(stale.status).toBe(409);
  });

  it('an exact retry (same key, same payload) returns the applied representation without a second playbook run', async () => {
    const { app, capabilities, id, revision } = await seedAwaitingInvestigation();
    const body = {
      expectedRevision: revision,
      seller: '1',
      quantity: 1,
      destinationPostalCode: '01310-100',
      confirm: ['skuId'] as const,
    };

    const first = await patchIntake(app, id, body, 'patch-key');
    expect(first.status).toBe(200);
    const second = await patchIntake(app, id, body, 'patch-key');
    expect(second.status).toBe(200);

    expect(capabilities.inventory.observe).toHaveBeenCalledTimes(1);
  });

  it('reusing a key with a different payload returns a structured 409 conflict', async () => {
    const { app, id, revision } = await seedAwaitingInvestigation();
    await patchIntake(app, id, { expectedRevision: revision, seller: '1' }, 'patch-key');

    const conflicting = await patchIntake(app, id, { expectedRevision: revision, seller: '2' }, 'patch-key');
    expect(conflicting.status).toBe(409);
  });

  it('reusing the same Idempotency-Key across two different investigations is a structured 409, not the wrong investigation silently returned', async () => {
    const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({ skuId: 'SKU-2002' }));
    const { app } = buildApp({}, languageAssistance);

    const firstCreated = await post(
      app,
      { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', accountScope: { accountId: 'account-17' }, ticketText: 'first ticket' },
      'create-key-1',
    );
    const firstId = ((await firstCreated.json()) as { id: string }).id;
    const secondCreated = await post(
      app,
      { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', accountScope: { accountId: 'account-99' }, ticketText: 'second ticket' },
      'create-key-2',
    );
    const secondId = ((await secondCreated.json()) as { id: string }).id;
    expect(firstId).not.toBe(secondId);

    // Byte-identical PATCH body against two different investigations, same key.
    const sharedBody = { expectedRevision: 1, seller: '1' };
    const first = await patchIntake(app, firstId, sharedBody, 'shared-patch-key');
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string };
    expect(firstBody.id).toBe(firstId);

    const second = await patchIntake(app, secondId, sharedBody, 'shared-patch-key');
    expect(second.status).toBe(409);

    // The second investigation was never touched by the reused key.
    const secondStillUnchanged = await app.request(`/investigations/${secondId}`);
    const secondStillUnchangedBody = (await secondStillUnchanged.json()) as { revision: number };
    expect(secondStillUnchangedBody.revision).toBe(1);
  });
});

describe('POST /investigations/:id/explanations', () => {
  it('accepts a grounded improvement and keeps it alongside — not instead of — the deterministic explanation', async () => {
    const { app, explanationScript } = buildAppWithExplanationScript(groundedImprovementScript());
    const seeded = await seedCompleted(app);

    const res = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      revision: number;
      explanation: { summary: string };
      explanationImprovement: { status: string; improvedExplanation: { summary: string; sources: unknown[] } };
    };
    expect(body.revision).toBe(seeded.revision + 1);
    expect(body.explanationImprovement.status).toBe('accepted');
    expect(body.explanationImprovement.improvedExplanation.summary).toBeTruthy();
    expect(body.explanationImprovement.improvedExplanation.sources.length).toBeGreaterThan(0);
    expect(body.explanation.summary).toBeTruthy();
    expect(explanationScript).toHaveBeenCalledTimes(1);
  });

  it('rejects a fabricated identifier/off-pack citation while preserving the deterministic explanation, Evidence Ledger, Finding and Decision unchanged', async () => {
    const { app, explanationScript } = buildAppWithExplanationScript(fabricatedIdentifierImprovementScript());
    const seeded = await seedCompleted(app);
    const before = await app.request(`/investigations/${seeded.id}`);
    const beforeBody = (await before.json()) as Record<string, unknown>;

    const res = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      explanationImprovement: { status: string; reason: string };
      explanation: unknown;
      evidence: unknown;
      finding: unknown;
      decision: unknown;
    };
    expect(body.explanationImprovement.status).toBe('rejected');
    expect(body.explanationImprovement.reason).toBeTruthy();
    // Nothing about the deterministic outcome moved — only `explanationImprovement` itself was added.
    expect(body.explanation).toEqual(beforeBody.explanation);
    expect(body.evidence).toEqual(beforeBody.evidence);
    expect(body.finding).toEqual(beforeBody.finding);
    expect(body.decision).toEqual(beforeBody.decision);
    expect(explanationScript).toHaveBeenCalledTimes(1);
    // The fabricated "SKU 999999" text the model proposed must never reach
    // a durable field — only the deterministic rejection reason does.
    expectNoRawProviderFields(body);
  });

  it('returns 503 and commits nothing when Language Assistance is unavailable, so a fresh attempt at the same revision calls the model again', async () => {
    const { app, explanationScript } = buildAppWithExplanationScript(explanationUnavailableScript('Bedrock outage'));
    const seeded = await seedCompleted(app);

    const first = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-1');
    expect(first.status).toBe(503);

    const stillUnchanged = await app.request(`/investigations/${seeded.id}`);
    const stillUnchangedBody = (await stillUnchanged.json()) as { revision: number; explanationImprovement: unknown };
    expect(stillUnchangedBody.revision).toBe(seeded.revision);
    expect(stillUnchangedBody.explanationImprovement).toBeNull();

    // A fresh click (fresh Idempotency-Key, same revision — nothing changed
    // to bump it) attempts the model again rather than being blocked by an
    // idempotent replay of the earlier failure.
    const retry = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-2');
    expect(retry.status).toBe(503);
    expect(explanationScript).toHaveBeenCalledTimes(2);
  });

  it('is available only for a completed Investigation and never calls the model for one still awaiting input', async () => {
    const { app, explanationScript } = buildAppWithExplanationScript(groundedImprovementScript());
    const created = await post(
      app,
      { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', accountScope: { accountId: 'account-17' } },
      'create-key',
    );
    const createdBody = (await created.json()) as { id: string; state: string; revision: number };
    expect(createdBody.state).toBe('awaiting_input');

    const res = await postExplanation(app, createdBody.id, { expectedRevision: createdBody.revision }, 'expl-key-1');

    expect(res.status).toBe(409);
    expect(explanationScript).not.toHaveBeenCalled();
  });

  it('rejects a stale revision before ever calling the model', async () => {
    const { app, explanationScript } = buildAppWithExplanationScript(groundedImprovementScript());
    const seeded = await seedCompleted(app);

    const res = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision + 5 }, 'expl-key-1');

    expect(res.status).toBe(409);
    expect(explanationScript).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown investigation without calling the model', async () => {
    const { app, explanationScript } = buildAppWithExplanationScript(groundedImprovementScript());

    const res = await postExplanation(app, 'does-not-exist', { expectedRevision: 1 }, 'expl-key-1');

    expect(res.status).toBe(404);
    expect(explanationScript).not.toHaveBeenCalled();
  });

  it('returns a structured 400 when Idempotency-Key is missing', async () => {
    const { app } = buildAppWithExplanationScript(groundedImprovementScript());
    const seeded = await seedCompleted(app);

    const res = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision });

    expect(res.status).toBe(400);
  });

  it('returns a structured 400 with issues for a body that fails schema validation', async () => {
    const { app } = buildAppWithExplanationScript(groundedImprovementScript());
    const seeded = await seedCompleted(app);

    const res = await postExplanation(app, seeded.id, {}, 'expl-key-1');

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues?: string[] } };
    expect(body.error.issues?.length).toBeGreaterThan(0);
  });

  describe('idempotency', () => {
    it('an exact retry (same key, same body) replays the original response without a second model call', async () => {
      const { app, explanationScript } = buildAppWithExplanationScript(groundedImprovementScript());
      const seeded = await seedCompleted(app);

      const first = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-1');
      const firstBody = await first.json();
      const second = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-1');
      const secondBody = await second.json();

      expect(second.status).toBe(200);
      expect(secondBody).toEqual(firstBody);
      expect(explanationScript).toHaveBeenCalledTimes(1);
    });

    it('reusing a key with a different expectedRevision returns a structured 409 conflict', async () => {
      const { app } = buildAppWithExplanationScript(groundedImprovementScript());
      const seeded = await seedCompleted(app);
      await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-1');

      const res = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision + 1 }, 'expl-key-1');

      expect(res.status).toBe(409);
    });

    it('reusing the same Idempotency-Key across two different investigations is a structured 409, not the wrong investigation returned', async () => {
      const { app } = buildAppWithExplanationScript(groundedImprovementScript());
      const first = await seedCompleted(app, 'create-key-1');
      const second = await seedCompleted(app, 'create-key-2');
      expect(first.id).not.toBe(second.id);

      const sharedBody = { expectedRevision: first.revision };
      const firstRes = await postExplanation(app, first.id, sharedBody, 'shared-explanation-key');
      expect(firstRes.status).toBe(200);

      const secondRes = await postExplanation(app, second.id, sharedBody, 'shared-explanation-key');
      expect(secondRes.status).toBe(409);
    });
  });

  it('GET /investigations/:id never calls the model and never generates or mutates an explanation improvement', async () => {
    const { app, explanationScript } = buildAppWithExplanationScript(groundedImprovementScript());
    const seeded = await seedCompleted(app);

    const firstGet = await app.request(`/investigations/${seeded.id}`);
    const firstGetBody = (await firstGet.json()) as { explanationImprovement: unknown };
    expect(firstGetBody.explanationImprovement).toBeNull();

    const secondGet = await app.request(`/investigations/${seeded.id}`);
    const secondGetBody = (await secondGet.json()) as { explanationImprovement: unknown };
    expect(secondGetBody.explanationImprovement).toBeNull();

    expect(explanationScript).not.toHaveBeenCalled();
  });

  it('a later PATCH intake correction that recomputes the outcome drops a previously accepted explanationImprovement', async () => {
    const { app } = buildAppWithExplanationScript(groundedImprovementScript());
    const seeded = await seedCompleted(app);

    const accepted = await postExplanation(app, seeded.id, { expectedRevision: seeded.revision }, 'expl-key-1');
    const acceptedBody = (await accepted.json()) as { revision: number; explanationImprovement: { status: string } };
    expect(acceptedBody.explanationImprovement.status).toBe('accepted');

    const patched = await patchIntake(
      app,
      seeded.id,
      { expectedRevision: acceptedBody.revision, seller: '2' },
      'patch-key-1',
    );
    const patchedBody = (await patched.json()) as { explanationImprovement: unknown; state: string };

    expect(patched.status).toBe(200);
    expect(patchedBody.state).toBe('completed');
    expect(patchedBody.explanationImprovement).toBeNull();
  });
});

describe('POST /investigations/:id/reviews', () => {
  type ReviewBody = {
    revision: number;
    reviews: Array<{
      outcome: string;
      reviewerName: string;
      automatedFindingCode: string;
      correctedFindingCode?: string;
      reason?: string;
      note?: string;
    }>;
    reviewedFinding: { code: string; outcome: string; reviewerName: string } | null;
    finding: { code: string } | null;
  };

  it('confirmed: appends a review, exposes it verbatim, and leaves the automated finding untouched', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      { outcome: 'confirmed', expectedRevision: seeded.revision, reviewerName: 'ana' },
      'review-key-1',
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewBody;
    expect(body.revision).toBe(seeded.revision + 1);
    expect(body.reviews).toEqual([
      {
        outcome: 'confirmed',
        reviewerName: 'ana',
        automatedFindingCode: 'DESTINATION_NOT_COVERED',
        occurredAt: '2026-07-30T12:00:00.000Z',
      },
    ]);
    expect(body.reviewedFinding).toEqual({
      code: 'DESTINATION_NOT_COVERED',
      outcome: 'confirmed',
      reviewerName: 'ana',
    });
    expect(body.finding?.code).toBe('DESTINATION_NOT_COVERED');
  });

  it('corrected: records the corrected code as the Reviewed Finding while finding.code stays the automated code', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      {
        outcome: 'corrected',
        expectedRevision: seeded.revision,
        reviewerName: 'bruno',
        correctedFindingCode: 'ROOT_CAUSE_UNDETERMINED',
        reason: 'conflicting_evidence',
      },
      'review-key-1',
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewBody;
    expect(body.reviews[0]).toMatchObject({
      outcome: 'corrected',
      reviewerName: 'bruno',
      automatedFindingCode: 'DESTINATION_NOT_COVERED',
      correctedFindingCode: 'ROOT_CAUSE_UNDETERMINED',
      reason: 'conflicting_evidence',
    });
    // The automated Finding is never rewritten by a correction.
    expect(body.finding?.code).toBe('DESTINATION_NOT_COVERED');
    // Only the corrected code is eligible for the future CX Intelligence Loop.
    expect(body.reviewedFinding).toEqual({
      code: 'ROOT_CAUSE_UNDETERMINED',
      outcome: 'corrected',
      reviewerName: 'bruno',
    });
  });

  it('inconclusive: records the canonical reason and optional note, and is not eligible for the CX Intelligence Loop', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      {
        outcome: 'inconclusive',
        expectedRevision: seeded.revision,
        reviewerName: 'carla',
        reason: 'blocked_access',
        note: 'Merchant portal access pending.',
      },
      'review-key-1',
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewBody;
    expect(body.reviews[0]).toMatchObject({
      outcome: 'inconclusive',
      reviewerName: 'carla',
      reason: 'blocked_access',
      note: 'Merchant portal access pending.',
    });
    expect(body.reviewedFinding).toBeNull();
    expect(body.finding?.code).toBe('DESTINATION_NOT_COVERED');
  });

  it('a cause outside the playbook has no corrected shape to hold it — only inconclusive with outside_supported_playbook', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      {
        outcome: 'inconclusive',
        expectedRevision: seeded.revision,
        reviewerName: 'diego',
        reason: 'outside_supported_playbook',
        note: 'Actual cause was a payment hold, outside this playbook.',
      },
      'review-key-1',
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewBody;
    expect(body.reviews[0]).toMatchObject({ outcome: 'inconclusive', reason: 'outside_supported_playbook' });
    expect(body.reviewedFinding).toBeNull();
  });

  it('rejects a correctedFindingCode outside the supported taxonomy with a structured 400', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      {
        outcome: 'corrected',
        expectedRevision: seeded.revision,
        reviewerName: 'ana',
        correctedFindingCode: 'PAYMENT_DECLINED',
        reason: 'conflicting_evidence',
      },
      'review-key-1',
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues?: string[] } };
    expect(body.error.issues?.length).toBeGreaterThan(0);
  });

  it('rejects a corrected review missing its required reason with a structured 400', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      {
        outcome: 'corrected',
        expectedRevision: seeded.revision,
        reviewerName: 'ana',
        correctedFindingCode: 'ROOT_CAUSE_UNDETERMINED',
      },
      'review-key-1',
    );

    expect(res.status).toBe(400);
  });

  it('rejects a reviewerName over 80 characters with a structured 400', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      { outcome: 'confirmed', expectedRevision: seeded.revision, reviewerName: 'a'.repeat(81) },
      'review-key-1',
    );

    expect(res.status).toBe(400);
  });

  it('is available only for a completed Investigation', async () => {
    const { app } = buildApp();
    const created = await post(
      app,
      { symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS', accountScope: { accountId: 'account-17' } },
      'create-key',
    );
    const createdBody = (await created.json()) as { id: string; state: string; revision: number };
    expect(createdBody.state).toBe('awaiting_input');

    const res = await postReview(
      app,
      createdBody.id,
      { outcome: 'confirmed', expectedRevision: createdBody.revision, reviewerName: 'ana' },
      'review-key-1',
    );

    expect(res.status).toBe(409);
  });

  it('rejects a stale revision without appending a review', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      { outcome: 'confirmed', expectedRevision: seeded.revision + 5, reviewerName: 'ana' },
      'review-key-1',
    );

    expect(res.status).toBe(409);
    const after = await app.request(`/investigations/${seeded.id}`);
    const afterBody = (await after.json()) as ReviewBody;
    expect(afterBody.reviews).toEqual([]);
  });

  it('returns 404 for an unknown investigation', async () => {
    const { app } = buildApp();

    const res = await postReview(
      app,
      'does-not-exist',
      { outcome: 'confirmed', expectedRevision: 1, reviewerName: 'ana' },
      'review-key-1',
    );

    expect(res.status).toBe(404);
  });

  it('returns a structured 400 when Idempotency-Key is missing', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(app, seeded.id, { outcome: 'confirmed', expectedRevision: seeded.revision, reviewerName: 'ana' });

    expect(res.status).toBe(400);
  });

  it('a second review appends rather than replaces the first — history is preserved', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    await postReview(
      app,
      seeded.id,
      { outcome: 'inconclusive', expectedRevision: seeded.revision, reviewerName: 'ana', reason: 'missing_evidence' },
      'review-key-1',
    );
    const first = await app.request(`/investigations/${seeded.id}`);
    const firstBody = (await first.json()) as ReviewBody;

    const res = await postReview(
      app,
      seeded.id,
      {
        outcome: 'corrected',
        expectedRevision: firstBody.revision,
        reviewerName: 'bruno',
        correctedFindingCode: 'ROOT_CAUSE_UNDETERMINED',
        reason: 'conflicting_evidence',
      },
      'review-key-2',
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewBody;
    expect(body.reviews).toHaveLength(2);
    expect(body.reviews[0]).toMatchObject({ outcome: 'inconclusive', reviewerName: 'ana' });
    expect(body.reviews[1]).toMatchObject({ outcome: 'corrected', reviewerName: 'bruno' });
    // The latest review determines current CX-loop eligibility.
    expect(body.reviewedFinding).toEqual({
      code: 'ROOT_CAUSE_UNDETERMINED',
      outcome: 'corrected',
      reviewerName: 'bruno',
    });
  });

  describe('idempotency', () => {
    it('an exact retry (same key, same body) replays the applied review without appending a second one', async () => {
      const { app } = buildApp();
      const seeded = await seedCompleted(app);
      const requestBody = { outcome: 'confirmed', expectedRevision: seeded.revision, reviewerName: 'ana' };

      const first = await postReview(app, seeded.id, requestBody, 'review-key-1');
      const firstBody = await first.json();
      const second = await postReview(app, seeded.id, requestBody, 'review-key-1');
      const secondBody = await second.json();

      expect(second.status).toBe(200);
      expect(secondBody).toEqual(firstBody);
      expect((secondBody as ReviewBody).reviews).toHaveLength(1);
    });

    it('reusing a key with a different reviewerName is a structured 409 conflict, not an exact-retry replay', async () => {
      const { app } = buildApp();
      const seeded = await seedCompleted(app);
      await postReview(
        app,
        seeded.id,
        { outcome: 'confirmed', expectedRevision: seeded.revision, reviewerName: 'ana' },
        'review-key-1',
      );

      const res = await postReview(
        app,
        seeded.id,
        { outcome: 'confirmed', expectedRevision: seeded.revision, reviewerName: 'someone-else' },
        'review-key-1',
      );

      expect(res.status).toBe(409);
    });

    it('reusing a key with a different expectedRevision is a structured 409 conflict', async () => {
      const { app } = buildApp();
      const seeded = await seedCompleted(app);
      await postReview(
        app,
        seeded.id,
        { outcome: 'confirmed', expectedRevision: seeded.revision, reviewerName: 'ana' },
        'review-key-1',
      );

      const res = await postReview(
        app,
        seeded.id,
        { outcome: 'confirmed', expectedRevision: seeded.revision + 1, reviewerName: 'ana' },
        'review-key-1',
      );

      expect(res.status).toBe(409);
    });

    it('reusing the same Idempotency-Key across two different investigations is a structured 409, not the wrong investigation returned', async () => {
      const { app } = buildApp();
      const first = await seedCompleted(app, 'create-key-1');
      const second = await seedCompleted(app, 'create-key-2');
      expect(first.id).not.toBe(second.id);

      const sharedBody = { outcome: 'confirmed', expectedRevision: first.revision, reviewerName: 'ana' };
      const firstRes = await postReview(app, first.id, sharedBody, 'shared-review-key');
      expect(firstRes.status).toBe(200);

      const secondRes = await postReview(app, second.id, sharedBody, 'shared-review-key');
      expect(secondRes.status).toBe(409);
    });
  });

  it('no raw provider payload or ticket text anywhere in the review response (defense in depth)', async () => {
    const { app } = buildApp();
    const seeded = await seedCompleted(app);

    const res = await postReview(
      app,
      seeded.id,
      {
        outcome: 'inconclusive',
        expectedRevision: seeded.revision,
        reviewerName: 'ana',
        reason: 'missing_evidence',
        note: 'Needs another look.',
      },
      'review-key-1',
    );

    const body = await res.json();
    expectNoRawProviderFields(body);
  });
});

describe('input size caps', () => {
  it('rejects ticket text over TICKET_TEXT_MAX_LENGTH with a 400 before any model call', async () => {
    let modelCalls = 0;
    const app = createInvestigationsApp({
      capabilities: createFulfillmentCapabilities(createFixtureCommerceGateway()),
      repository: createInMemoryInvestigationRepository(),
      languageAssistance: {
        async extractIntake() {
          modelCalls += 1;
          return { kind: 'extracted', fields: {} };
        },
        async improveExplanation() {
          modelCalls += 1;
          return { kind: 'unavailable', reason: 'not used' };
        },
      },
    });

    const response = await app.request('/investigations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'oversized-ticket' },
      body: JSON.stringify({
        symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
        ticketText: 'x'.repeat(TICKET_TEXT_MAX_LENGTH + 1),
      }),
    });

    expect(response.status).toBe(400);
    expect(modelCalls).toBe(0);
  });
});
