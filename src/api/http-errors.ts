export interface StructuredErrorBody {
  error: { message: string; issues?: string[] };
}

/**
 * The one structured-error shape every route in `investigations-app.ts`
 * returns — `{ error: { message, issues? } }`, never a raw stack trace or
 * a thrown error's own message.
 */
export function errorBody(message: string, issues?: string[]): StructuredErrorBody {
  return issues && issues.length > 0 ? { error: { message, issues } } : { error: { message } };
}
