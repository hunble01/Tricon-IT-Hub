/**
 * Deterministic, normalized pseudo-embedding. Stable (same text → same vector)
 * so the pgvector path is exercised without a real embedding model. NOT
 * semantically meaningful — used by the stub provider and as the embedding
 * fallback for providers (e.g. Anthropic) that expose no embeddings endpoint.
 */
export function hashEmbed(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    v[(code + i) % dim] += ((code % 17) - 8) / 8;
  }
  let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) norm = 1;
  return v.map((x) => x / norm);
}
