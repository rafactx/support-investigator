/**
 * The slice of the Cloudflare D1 client API this project uses, declared
 * structurally so the adapters typecheck under Node without the Workers
 * runtime types. A real `D1Database` binding satisfies it.
 */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  /** Runs the statements as one SQL transaction: any failure rolls back all of them. */
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}
