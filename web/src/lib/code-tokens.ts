/**
 * Splits evidence prose into plain-text and inline-code segments, so
 * technical data reads the way the industry renders it (GitHub/Linear/
 * Slack inline code: mono on a muted chip) instead of blending into the
 * sentence. Conservative by design: only shapes this domain actually
 * produces: order/SKU ids, postal codes, ISO or space-separated
 * dates/datetimes, bare clock times, `key=value` pairs, and enum-like
 * slugs (`payment-denied`, `order-canceled`). Bare numbers and prose
 * never match. (The model's phrasing varies run to run, so `key: value`
 * colon pairs are deliberately NOT code: they read as prose, and chasing
 * every phrasing with regex is whack-a-mole.)
 */

export interface CodeToken {
  kind: 'text' | 'code';
  value: string;
  /** Offset in the source string; doubles as a stable React key. */
  start: number;
}

// Alternation order matters: the full datetime must win before the postal
// code pattern can nibble at its date part, and ids before `key=value`.
// Slug segments require ≥3 lowercase letters so ordinary English
// hyphenations ("re-order", "follow-up") never match.
const CODE_PATTERN =
  /(\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b|\b\d{2}:\d{2}:\d{2}\b|\b(?:ORDER|SKU)-\d+\b|\b\d{5}-\d{3}\b|\b[A-Za-z][\w-]*=[^\s,;()]+\b|\b[a-z]{3,}(?:-[a-z]{3,})+\b)/g;

// Trailing sentence punctuation the `key=value` alternative can swallow
// ("status=denied." at the end of a sentence) belongs to the prose.
const TRAILING_PUNCTUATION = /[.,;:]+$/;

export function tokenizeCodeSpans(text: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(CODE_PATTERN)) {
    const index = match.index ?? 0;
    let code = match[0];
    let trailing = '';
    const punctuation = code.match(TRAILING_PUNCTUATION);
    if (punctuation && code.includes('=')) {
      trailing = punctuation[0];
      code = code.slice(0, code.length - trailing.length);
    }
    if (index > lastIndex) {
      tokens.push({ kind: 'text', value: text.slice(lastIndex, index), start: lastIndex });
    }
    tokens.push({ kind: 'code', value: code, start: index });
    if (trailing) {
      tokens.push({ kind: 'text', value: trailing, start: index + code.length });
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: 'text', value: text.slice(lastIndex), start: lastIndex });
  }
  return tokens;
}
