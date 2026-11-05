import { type FormEvent, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { FulfillmentIntakeInput } from '../lib/investigations-api-client.ts';
import { Button } from './ui/button.tsx';
import {
  Field,
  FieldDescription,
  Input,
  Label,
  Optional,
  Textarea,
} from './ui/field.tsx';
import { Panel, PanelBody, PanelHeader } from './ui/panel.tsx';

/** Mirrors the API's `TICKET_TEXT_MAX_LENGTH` (src/api/investigations-app.ts). */
const TICKET_TEXT_MAX_LENGTH = 4000;

/**
 * The structured intake card, extended to accept ticket text,
 * structured intake, or both. Account Scope stays required and explicit —
 * it is never derived from ticket text. The other four fields are
 * optional here: leaving one blank lets Language Assistance propose it
 * from ticket text, which then requires operator confirmation via `PATCH
 * /investigations/:id/intake` before the Fulfillment Playbook runs
 * (`InvestigationIntakeConfirmation`), rather than every value here always
 * arriving pre-confirmed the way the earlier form worked.
 */
export function InvestigationIntakeForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (input: FulfillmentIntakeInput) => void;
}) {
  const [accountId, setAccountId] = useState('account-17');
  const [ticketText, setTicketText] = useState('');
  const [skuId, setSkuId] = useState('SKU-2002');
  const [seller, setSeller] = useState('1');
  const [quantity, setQuantity] = useState('1');
  const [destinationPostalCode, setDestinationPostalCode] =
    useState('01310-100');

  const parsedQuantity = quantity.trim() === '' ? undefined : Number(quantity);
  const quantityIsValid =
    parsedQuantity === undefined ||
    (Number.isInteger(parsedQuantity) && parsedQuantity > 0);
  const hasAnyContent =
    ticketText.trim() !== '' ||
    skuId.trim() !== '' ||
    seller.trim() !== '' ||
    parsedQuantity !== undefined ||
    destinationPostalCode.trim() !== '';
  const canSubmit = accountId.trim() !== '' && quantityIsValid && hasAnyContent;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      accountId,
      ticketText: ticketText.trim() || undefined,
      skuId: skuId.trim() || undefined,
      seller: seller.trim() || undefined,
      quantity: parsedQuantity,
      destinationPostalCode: destinationPostalCode.trim() || undefined,
    });
  }

  return (
    <Panel aria-labelledby="intake-title" className="lg:sticky lg:top-20">
      <PanelHeader
        titleId="intake-title"
        title="New investigation"
        description="Paste a ticket, fill in what you already know, or both."
      />
      <PanelBody>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field>
            <Label htmlFor="fi-account">Merchant account</Label>
            <Input
              id="fi-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              aria-describedby="fi-account-description"
              className="font-mono"
            />
            <FieldDescription id="fi-account-description">
              Account Scope is always explicit, never inferred from ticket text.
            </FieldDescription>
          </Field>

          <Field>
            <Label htmlFor="fi-ticket-text">
              Ticket text
              <Optional />
            </Label>
            <Textarea
              id="fi-ticket-text"
              value={ticketText}
              onChange={(event) => setTicketText(event.target.value)}
              rows={4}
              maxLength={TICKET_TEXT_MAX_LENGTH}
              placeholder="Customers in 01310-100 see the product in stock but get no delivery option at checkout…"
              aria-describedby="fi-ticket-text-description"
            />
            <FieldDescription id="fi-ticket-text-description">
              Used once to propose the fields below, never stored or logged.
              Every proposal still needs your confirmation.
            </FieldDescription>
          </Field>

          <fieldset className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
            <legend className="sr-only">Order details</legend>
            <Field>
              <Label htmlFor="fi-sku">
                SKU
                <Optional />
              </Label>
              <Input
                id="fi-sku"
                value={skuId}
                onChange={(event) => setSkuId(event.target.value)}
                placeholder="SKU-2002"
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field>
              <Label htmlFor="fi-seller">
                Seller
                <Optional />
              </Label>
              <Input
                id="fi-seller"
                value={seller}
                onChange={(event) => setSeller(event.target.value)}
                placeholder="1"
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field>
              <Label htmlFor="fi-quantity">
                Quantity
                <Optional />
              </Label>
              <Input
                id="fi-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                aria-invalid={!quantityIsValid || undefined}
                aria-describedby={
                  quantityIsValid ? undefined : 'fi-quantity-error'
                }
                className="font-mono tabular-nums"
              />
              {!quantityIsValid && (
                <FieldDescription
                  id="fi-quantity-error"
                  className="text-danger"
                >
                  Use a whole number above zero.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <Label htmlFor="fi-postal">
                Postal code
                <Optional />
              </Label>
              <Input
                id="fi-postal"
                value={destinationPostalCode}
                onChange={(event) =>
                  setDestinationPostalCode(event.target.value)
                }
                placeholder="01310-100"
                autoComplete="off"
                spellCheck={false}
                className="font-mono tabular-nums"
              />
            </Field>
          </fieldset>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            disabled={!canSubmit}
            className="w-full"
          >
            {loading ? 'Running playbook…' : 'Start investigation'}
            {!loading && <ArrowRight aria-hidden="true" />}
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}
