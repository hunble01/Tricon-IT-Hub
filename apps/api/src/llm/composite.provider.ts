import type {
  CompleteRequest,
  CompleteResponse,
  EmbedRequest,
  EmbedResponse,
  LlmProvider,
} from "@tricon/shared";

/**
 * Routes embed() and complete() to (possibly) different underlying providers.
 *
 * This lets completions run on one vendor (e.g. Anthropic, which has no
 * embeddings endpoint) while embeddings run on another that does (e.g. OpenAI).
 * Each half is still a plain LlmProvider, so callers see one provider and the
 * split is invisible above LlmService. The eventual enterprise target (Azure
 * OpenAI for both, or a self-hosted embedder) stays a wiring change in
 * LlmModule — this class doesn't need to change.
 */
export class CompositeLlmProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly completion: LlmProvider,
    private readonly embedding: LlmProvider,
  ) {
    this.name =
      completion === embedding
        ? completion.name
        : `${completion.name}+${embedding.name}(embed)`;
  }

  embed(req: EmbedRequest): Promise<EmbedResponse> {
    return this.embedding.embed(req);
  }

  complete(req: CompleteRequest): Promise<CompleteResponse> {
    return this.completion.complete(req);
  }
}
