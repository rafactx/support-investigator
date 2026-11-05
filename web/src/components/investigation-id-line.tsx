import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatTimestamp } from '../lib/format-time.ts';
import { Button } from './ui/button.tsx';

/**
 * The investigation's id (mono, copyable) and creation time, both in
 * tabular figures. Copy feedback swaps the icon and is announced through a
 * polite live region (ANIM-042, A11Y-024).
 */
export function InvestigationIdLine({
  id,
  createdAt,
}: {
  id: string;
  createdAt: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch (error) {
      console.error('Copy to clipboard failed', error);
    }
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex min-w-0 items-center gap-0.5">
        <span
          className="truncate font-mono text-caption text-fg-muted tabular-nums"
          title={id}
        >
          {id}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={copy}
          aria-label="Copy investigation id"
          className="size-7 after:absolute after:-inset-1 [&_svg]:size-3.5"
        >
          {copied ? (
            <Check aria-hidden="true" className="text-success" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </Button>
        <span role="status" className="sr-only">
          {copied ? 'Investigation id copied' : ''}
        </span>
      </span>
      <span aria-hidden="true" className="hidden text-fg-subtle sm:inline">
        ·
      </span>
      <time
        dateTime={createdAt}
        className="text-caption text-fg-subtle tabular-nums"
      >
        {formatTimestamp(createdAt)}
      </time>
    </span>
  );
}
