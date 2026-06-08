import { Logger } from "@nestjs/common";
import type {
  CompleteRequest,
  CompleteResponse,
  EmbedRequest,
  EmbedResponse,
  LlmProvider,
} from "@tricon/shared";
import { hashEmbed } from "./hash-embed";

export interface AnthropicProviderOptions {
  apiKey: string;
  embeddingDim: number;
  baseUrl?: string;
  completeModel?: string;
  apiVersion?: string;
}

/**
 * Anthropic implementation of LlmProvider. Server-side only.
 *
 * Anthropic exposes no first-party embeddings endpoint, so embed() falls back to
 * the deterministic hash embedding (logged). When a real vector store is needed
 * under Anthropic, pair it with a dedicated embeddings provider (e.g. Voyage) —
 * that becomes another LlmProvider wiring, not a change to callers.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly baseUrl: string;
  private readonly completeModel: string;
  private readonly apiVersion: string;
  private warnedEmbed = false;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1";
    this.completeModel = opts.completeModel ?? "claude-sonnet-4-6";
    this.apiVersion = opts.apiVersion ?? "2023-06-01";
  }

  embed(req: EmbedRequest): Promise<EmbedResponse> {
    if (!this.warnedEmbed) {
      this.logger.warn(
        "Anthropic has no embeddings endpoint — using deterministic hash embeddings.",
      );
      this.warnedEmbed = true;
    }
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const vectors = inputs.map((t) => hashEmbed(t, this.opts.embeddingDim));
    return Promise.resolve({
      vectors,
      dim: this.opts.embeddingDim,
      model: "hash-embed",
    });
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    // Anthropic takes system as a top-level field, not a message role.
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify({
        model: this.completeModel,
        system: system || undefined,
        messages,
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 700,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(`Anthropic messages failed: ${res.status} ${detail}`);
      throw new Error(`Anthropic request failed (${res.status})`);
    }
    const json: any = await res.json();
    const text = (json.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return { text, model: this.completeModel };
  }
}
