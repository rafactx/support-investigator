import { type FormEvent, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import type {
  InvestigationResponse,
  PatchIntakeInput,
} from '../lib/investigations-api-client.ts';
import { InvestigationIdLine } from './investigation-id-line.tsx';
import { ProvenanceBadge } from './provenance-badge.tsx';
import { Alert } from './ui/alert.tsx';
import { Button } from './ui/button.tsx';
import { Code } from './ui/code.tsx';
import { Field, FieldDescription, Input, Label } from './ui/field.tsx';
import { Panel, PanelBody, PanelHeader } from './ui/panel.tsx';

type ConfirmableField =
  | 'skuId'
  | 'seller'
  | 'quantity'
  | 'destinationPostalCode';

const FIELD_LABELS: Record<ConfirmableField, string> = {
  skuId: 'SKU',
  seller: 'Seller',
  quantity: 'Quantity',
  destinationPostalCode: 'Destination postal code',
};

const CONFIRMABLE_FIELDS: readonly ConfirmableField[] = [
  'skuId',
  'seller',
  'quantity',
  'destinationPostalCode',
];

/**
 * The `awaiting_input` confirmation card: exposes
 * every intake field's Language Assistance provenance (`source` and
 * `confirmed`) and requires the operator to either confirm an existing
 * model proposal as-is or correct/complete it before the Fulfillment
 * Playbook can run — nothing here submits itself. `intakeGaps` names
 * exactly which fields are still missing or unconfirmed, so the operator
 * isn't left inferring it from the raw intake alone.
 */
export function InvestigationIntakeConfirmation({
  investigation,
  loading,
  onSubmit,
}: {
  investigation: InvestigationResponse;
  loading: boolean;
  onSubmit: (patch: PatchIntakeInput) => void;
}) {
  const { intake, intakeGaps } = investigation;

  const [accountId, setAccountId] = useState(
    intake.accountScope?.value.accountId ?? '',
  );
  const [skuId, setSkuId] = useState(intake.skuId?.value ?? '');
  const [seller, setSeller] = useState(intake.seller?.value ?? '');
  const [quantity, setQuantity] = useState(
    intake.quantity ? String(intake.quantity.value) : '',
  );
  const [destinationPostalCode, setDestinationPostalCode] = useState(
    intake.destinationPostalCode?.value ?? '',
  );
  const [confirmedFields, setConfirmedFields] = useState<
    ReadonlySet<ConfirmableField>
  >(new Set());

  const currentValues: Record<ConfirmableField, string> = {
    skuId,
    seller,
    quantity,
    destinationPostalCode,
  };
  const setters: Record<ConfirmableField, (value: string) => void> = {
    skuId: setSkuId,
    seller: setSeller,
    quantity: setQuantity,
    destinationPostalCode: setDestinationPostalCode,
  };

  function toggleConfirm(field: ConfirmableField) {
    setConfirmedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  }

  /**
   * A field the user typed a new value into (differing from what intake
   * already held, or filling a gap) is an explicit correction/completion;
   * an untouched, already-proposed field the user checked "confirm" for
   * is submitted only in `confirm`, so its `source` stays `'model'`
   * server-side (AC4) — only its `confirmed` flag flips.
   */
  function explicitValue(field: ConfirmableField): string | undefined {
    if (confirmedFields.has(field)) return undefined;
    const typed = currentValues[field].trim();
    if (typed === '') return undefined;
    const original = intake[field]?.value;
    return String(original ?? '') === typed ? undefined : typed;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedAccountId = accountId.trim();
    const explicitSkuId = explicitValue('skuId');
    const explicitSeller = explicitValue('seller');
    const explicitQuantity = explicitValue('quantity');
    const explicitDestination = explicitValue('destinationPostalCode');

    onSubmit({
      expectedRevision: investigation.revision,
      accountScope: trimmedAccountId
        ? { accountId: trimmedAccountId }
        : undefined,
      skuId: explicitSkuId,
      seller: explicitSeller,
      quantity:
        explicitQuantity === undefined ? undefined : Number(explicitQuantity),
      destinationPostalCode: explicitDestination,
      confirm: [...confirmedFields],
    });
  }

  return (
    <Panel aria-labelledby="confirm-title">
      <PanelHeader
        titleId="confirm-title"
        title="Confirm intake"
        description={
          <InvestigationIdLine
            id={investigation.id}
            createdAt={investigation.createdAt}
          />
        }
      />
      <PanelBody className="space-y-5">
        <Alert tone="info" title="Nothing has run yet">
          A model may have proposed some values from the ticket text. Confirm
          each one as proposed, or correct it, before the Fulfillment Playbook
          can start.
        </Alert>

        {intakeGaps && intakeGaps.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-fg-subtle uppercase">
              Still needed
            </h3>
            <ul className="flex flex-wrap gap-2">
              {intakeGaps.map((gap) => (
                <li
                  key={gap.field}
                  className="inline-flex items-center gap-1.5 text-caption text-fg-muted"
                >
                  <Code>{gap.field}</Code>
                  {gap.reason === 'missing' ? 'missing' : 'unconfirmed'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field>
            <Label htmlFor="ci-account">Merchant account</Label>
            <Input
              id="ci-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="account-17"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="ci-account-description"
              className="font-mono"
            />
            <FieldDescription id="ci-account-description">
              Always explicit trusted context, never a model proposal.
            </FieldDescription>
          </Field>

          {CONFIRMABLE_FIELDS.map((field) => {
            const current = intake[field];
            const isConfirming = confirmedFields.has(field);
            const canConfirm =
              current?.source === 'model' && !current.confirmed;
            return (
              <Field key={field}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor={`ci-${field}`}>{FIELD_LABELS[field]}</Label>
                  {current && (
                    <ProvenanceBadge
                      source={current.source}
                      confirmed={current.confirmed || isConfirming}
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id={`ci-${field}`}
                    value={currentValues[field]}
                    onChange={(event) => setters[field](event.target.value)}
                    disabled={isConfirming}
                    type={field === 'quantity' ? 'number' : 'text'}
                    inputMode={field === 'quantity' ? 'numeric' : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono tabular-nums"
                  />
                  {canConfirm && (
                    <Button
                      variant={isConfirming ? 'ghost' : 'secondary'}
                      onClick={() => toggleConfirm(field)}
                      aria-pressed={isConfirming}
                      aria-label={
                        isConfirming
                          ? `Edit ${FIELD_LABELS[field]} instead of confirming it`
                          : `Confirm ${FIELD_LABELS[field]} “${current.value}” as proposed`
                      }
                      className="h-9"
                    >
                      {isConfirming ? (
                        <Pencil aria-hidden="true" />
                      ) : (
                        <Check aria-hidden="true" />
                      )}
                      {isConfirming ? 'Edit' : 'Confirm'}
                    </Button>
                  )}
                </div>
              </Field>
            );
          })}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            className="w-full sm:w-auto sm:self-end"
          >
            {loading ? 'Resuming investigation…' : 'Save intake and resume'}
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}
