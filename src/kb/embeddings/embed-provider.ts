import type { EmbedProviderId } from '../types.ts';

/**
 * Embeds text into fixed-length vectors. Three implementations (`lexical`
 * default, `bedrock-titan`, `local`) are interchangeable behind
 * this interface, selected by `EMBED_PROVIDER` — the same
 * swappable-behind-an-interface shape as `CommerceGateway` (ADR-0005).
 */
export interface EmbedProvider {
  readonly id: EmbedProviderId;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
