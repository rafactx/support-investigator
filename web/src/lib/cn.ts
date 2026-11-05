/** Joins class names, skipping falsy entries. Deliberately tiny: components here never need conflict-merging. */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}
