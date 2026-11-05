import { describe, expect, it } from 'vitest';
import { runDeployedSmoke } from './deployed-smoke.ts';

interface RequestRecord {
  readonly url: string;
  readonly method: string;
  readonly body?: Record<string, unknown>;
}

function investigation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    revision: 1,
    state: 'completed',
    evidence: { contractResult: 'satisfied', capabilityFailure: null },
    finding: { code: 'DESTINATION_NOT_COVERED' },
    decision: { outcome: 'ready_for_human_resolution', reason: 'contract_satisfied' },
    explanation: { summary: 'Deterministic Source Pack explanation.' },
    reviews: [],
    ...overrides,
  };
}

function response(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('runDeployedSmoke', () => {
  it('proves the release cases through the public API and MCP seams without claiming fixture outcomes are live accuracy', async () => {
    const requests: RequestRecord[] = [];
    let review: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      requests.push({ url, method, body });

      if (method === 'GET') return response(investigation({ revision: 2, reviews: [review] }), 200);
      if (url.endsWith('/explanations')) {
        return response(
          investigation({ explanationImprovement: { status: 'rejected' } }),
          200,
        );
      }
      if (url.endsWith('/reviews')) {
        review = {
          outcome: 'inconclusive',
          reason: 'outside_supported_playbook',
          reviewerName: 'release-smoke',
        };
        return response(investigation({ revision: 2, reviews: [review] }), 200);
      }
      if (body?.skuId === 'SKU-403') {
        return response(
          investigation({
            evidence: { contractResult: 'insufficient', capabilityFailure: { kind: 'permission_denied' } },
            finding: { code: 'ROOT_CAUSE_UNDETERMINED' },
            decision: { outcome: 'requires_specialist_review', reason: 'capability_failed' },
          }),
        );
      }
      if (body?.skuId === 'SKU-2003') {
        return response(
          investigation({
            evidence: { contractResult: 'insufficient', capabilityFailure: null },
            finding: { code: 'ROOT_CAUSE_UNDETERMINED' },
            decision: { outcome: 'requires_specialist_review', reason: 'evidence_contradictory' },
          }),
        );
      }
      if (body?.destinationPostalCode === '04000-000') {
        return response(
          investigation({
            evidence: { contractResult: 'contradicted', capabilityFailure: null },
            finding: { code: 'ROOT_CAUSE_UNDETERMINED' },
            decision: { outcome: 'requires_specialist_review', reason: 'evidence_contradictory' },
          }),
        );
      }
      if (!body?.skuId) {
        return response({ id: 'awaiting-1', revision: 1, state: 'awaiting_input', intakeGaps: [{ field: 'skuId' }] });
      }
      return response(investigation());
    };

    const report = await runDeployedSmoke({
      apiUrl: 'https://example.test/',
      demoKey: 'demo-key',
      fetchImpl,
      probeMcpV2: async () => ({
        tools: [
          'observe_destination_coverage',
          'observe_dock_to_policy',
          'observe_fulfillment_simulation',
          'observe_inventory',
          'observe_warehouse_to_dock',
          'search_support_knowledge',
        ],
        inventoryObservation: { kind: 'success' },
      }),
      now: () => '2026-07-31T12:00:00.000Z',
    });

    expect(report).toMatchObject({
      fixtureScenarioResults: {
        destinationNotCovered: 'passed',
        awaitingInput: 'passed',
        insufficientEvidence: 'passed',
        contradictoryEvidence: 'passed',
        permissionFailure: 'passed',
        intakeBoundarySabotage: 'passed',
      },
      reviewHistory: 'passed',
      deterministicExplanation: 'passed',
      mcpV2: 'passed',
      liveMerchant: 'skipped',
      liveBedrock: 'exercised',
      productionClaims: 'not_measured',
      mechanismEvidence: {
        positive: { findingCode: 'DESTINATION_NOT_COVERED', contractResult: 'satisfied' },
        insufficient: { findingCode: 'ROOT_CAUSE_UNDETERMINED', contractResult: 'insufficient' },
        contradictory: { findingCode: 'ROOT_CAUSE_UNDETERMINED', contractResult: 'contradicted' },
        permissionFailure: { findingCode: 'ROOT_CAUSE_UNDETERMINED', capabilityFailure: 'permission_denied' },
        reviewReason: 'outside_supported_playbook',
      },
    });
    expect(requests.some((request) => request.method === 'GET' && request.url.endsWith('/investigations/inv-1'))).toBe(true);
    expect(requests.find((request) => request.url.endsWith('/reviews'))?.body).toMatchObject({
      outcome: 'inconclusive',
      reason: 'outside_supported_playbook',
      reviewerName: 'release-smoke',
    });
  });

  it('fails if the deterministic Source Pack explanation disappears after a rejected or unavailable optional improvement', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (String(_input).endsWith('/explanations')) return response({ error: { message: 'Bedrock unavailable' } }, 503);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (!body.skuId) return response({ id: 'awaiting-1', revision: 1, state: 'awaiting_input' });
      if (body.skuId === 'SKU-403') {
        return response(investigation({ evidence: { capabilityFailure: { kind: 'permission_denied' } }, finding: { code: 'ROOT_CAUSE_UNDETERMINED' } }));
      }
      if (body.skuId === 'SKU-2003' || body.destinationPostalCode === '04000-000') {
        return response(investigation({ finding: { code: 'ROOT_CAUSE_UNDETERMINED' } }));
      }
      return response(investigation({ explanation: null }));
    };

    await expect(
      runDeployedSmoke({
        apiUrl: 'https://example.test/',
        demoKey: 'demo-key',
        fetchImpl,
        probeMcpV2: async () => ({ tools: [], inventoryObservation: { kind: 'success' } }),
      }),
    ).rejects.toThrow(/deterministic Source Pack explanation/i);
  });
});
