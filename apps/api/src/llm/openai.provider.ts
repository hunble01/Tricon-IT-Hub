import { Logger } from "@nestjs/common";
import type {
  CompleteRequest,
  CompleteResponse,
  EmbedRequest,
  EmbedResponse,
  LlmProvider,
} from "@tricon/shared";

export interface OpenAiProviderOptions {
  apiKey: string;
  embeddingDim: number;
  baseUrl?: string;
  embedModel?: string;
  /** Defaults to gpt-4o — a real peer of Claude Sonnet for fair side-by-side drafts. */
  completeModel?: string;
}

/**
 * OpenAI implementation of LlmProvider. Server-side only — the key never leaves
 * the API process. Uses the REST API directly (no SDK dependency).
 *
 * Zero-retention: callers MUST send pseudonymized text. The org-level
 * no-training / zero-retention setting is configured on the OpenAI account.
 * The eventual enterprise target (Azure OpenAI, Canada Central) implements the
 * same interface, so swapping is a config change.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly baseUrl: string;
  private readonly embedModel: string;
  private readonly completeModel: string;

  constructor(private readonly opts: OpenAiProviderOptions) {
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.embedModel = opts.embedModel ?? "text-embedding-3-small";
    this.completeModel = opts.completeModel ?? "gpt-4o";
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const input = Array.isArray(req.input) ? req.input : [req.input];
    const res = await this.call("/embeddings", {
      model: this.embedModel,
      input,
      dimensions: this.opts.embeddingDim,
    });
    const data = (res.data as Array<{ embedding: number[] }>).map((d) => d.embedding);
    return { vectors: data, dim: this.opts.embeddingDim, model: this.embedModel };
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const res = await this.call("/chat/completions", {
      model: this.completeModel,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 700,
    });
    const text = res.choices?.[0]?.message?.content ?? "";
    return { text, model: this.completeModel };
  }

  private async call(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(`OpenAI ${path} failed: ${res.status} ${detail}`);
      throw new Error(`OpenAI request failed (${res.status})`);
    }
    return res.json();
  }
}
