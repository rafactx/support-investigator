import { KeyRound } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { Field, FieldDescription, Input, Label } from './ui/field.tsx';

/**
 * Demo-key settings as a dialog instead of a form field: the key is
 * configuration (set once per browser, ADR-0022), not ticket content, so it
 * doesn't belong in the intake form's visual hierarchy. Persistence stays
 * exactly where ADR-0022 put it: `localStorage`, written by the parent on
 * every change; this dialog is only the editing surface.
 */
export function DemoKeyModal({
  open,
  onClose,
  demoKey,
  onDemoKeyChange,
  deployed,
}: {
  open: boolean;
  onClose: () => void;
  demoKey: string;
  onDemoKeyChange: (value: string) => void;
  deployed: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={
        <span className="inline-flex items-center gap-2">
          <KeyRound aria-hidden="true" className="size-4 text-fg-subtle" />
          Demo key
        </span>
      }
      description="Stored only in this browser and sent as a request header on every call."
      footer={
        <Button variant="primary" onClick={onClose}>
          Save key
        </Button>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <Field>
          <Label htmlFor="demoKey">Key</Label>
          <Input
            id="demoKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={demoKey}
            onChange={(event) => onDemoKeyChange(event.target.value)}
            placeholder={
              deployed
                ? 'Required by the deployed API'
                : 'Not required in local dev'
            }
            aria-describedby="demoKey-description"
            className="font-mono"
          />
          <FieldDescription id="demoKey-description">
            {deployed
              ? 'The deployed API rejects requests without it (ADR-0022).'
              : "Local dev's proxied /investigations isn't gated, so you can leave this blank (ADR-0022)."}
          </FieldDescription>
        </Field>
      </form>
    </Dialog>
  );
}
