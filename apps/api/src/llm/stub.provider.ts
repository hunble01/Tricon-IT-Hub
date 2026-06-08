import { Logger } from "@nestjs/common";
import type {
  CompleteRequest,
  CompleteResponse,
  EmbedRequest,
  EmbedResponse,
  LlmProvider,
} from "@tricon/shared";
import { hashEmbed } from "./hash-embed";

/**
 * Offline fallback provider. Used when no API key is configured so the whole
 * ticket-drafting + memory pipeline runs end-to-end in dev without secrets.
 *
 * - embed(): deterministic hashed pseudo-embeddings (stable, normalized) so the
 *   pgvector path is exercised locally. NOT semantically meaningful.
 * - complete(): a templated draft assembled from the prompt, clearly marked as
 *   a stub so it is never mistaken for a real model reply.
 */
export class StubLlmProvider implements LlmProvider {
  readonly name = "stub";
  private readonly logger = new Logger(StubLlmProvider.name);

  constructor(private readonly dim: number) {
    this.logger.warn(
      "No LLM API key configured — using StubLlmProvider. Drafts and embeddings are placeholders.",
    );
  }

  embed(req: EmbedRequest): Promise<EmbedResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const vectors = inputs.map((t) => hashEmbed(t, this.dim));
    return Promise.resolve({ vectors, dim: this.dim, model: "stub-embed" });
  }

  complete(req: CompleteRequest): Promise<CompleteResponse> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const text =
      "[STUB DRAFT — configure an LLM API key for real suggestions]\n\n" +
      "Thanks for reaching out. We've received your request and an IT technician " +
      "is looking into it. We'll follow up shortly with next steps.\n\n" +
      (lastUser ? `(Context length: ${lastUser.content.length} chars)` : "");
    return Promise.resolve({ text, model: "stub-complete" });
  }
}
