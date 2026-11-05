import type { EmbedProvider } from './embed-provider.ts';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;

// transformers.js pipeline signature we actually use — kept narrow rather
// than depending on the package's full (large, still-0.x) type surface.
type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[] }>;

/**
 * `EMBED_PROVIDER=local` (the fully-free alternative) — runs
 * `Xenova/all-MiniLM-L6-v2` locally via `@xenova/transformers`, no network
 * call per embed (only the one-time model download, cached on disk).
 *
 * `@xenova/transformers` is loaded via dynamic `import()` inside this
 * function, not a static top-level import: it eagerly requires `sharp`
 * (a native, platform-specific image dependency) even for pure
 * text-feature-extraction use, so the `bedrock-titan` and `lexical` provider
 * paths — including every CI run, which never selects `local` — must
 * never pay that load cost or need `sharp`'s native build to succeed.
 */
export function createLocalEmbedProvider(): EmbedProvider {
  let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

  async function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!pipelinePromise) {
      pipelinePromise = import('@xenova/transformers').then(
        ({ pipeline }) =>
          pipeline('feature-extraction', MODEL_ID) as Promise<FeatureExtractionPipeline>
      );
    }
    return pipelinePromise;
  }

  return {
    id: 'local',
    model: MODEL_ID,
    dimensions: DIMENSIONS,
    async embed(texts: string[]): Promise<number[][]> {
      const extractor = await getPipeline();
      const vectors: number[][] = [];
      for (const text of texts) {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        vectors.push(Array.from(output.data));
      }
      return vectors;
    },
  };
}
