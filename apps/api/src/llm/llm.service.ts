import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  CompleteRequest,
  CompleteResponse,
  EmbedResponse,
  LlmProvider,
} from "@tricon/shared";
import { COMPLETION_PROVIDERS, LLM_PROVIDER } from "./tokens";

/**
 * Thin façade over the active LlmProvider. Services depend on this, never on a
 * concrete provider — so OpenAI ↔ Anthropic ↔ Azure ↔ self-hosted is a wiring
 * swap in LlmModule. All calls are server-side; keys never reach the browser.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(COMPLETION_PROVIDERS) private readonly completionProviders: LlmProvider[],
  ) {
    this.logger.log(`LLM provider: ${provider.name}`);
    if (completionProviders.length > 1) {
      this.logger.log(
        `Completion models available: ${completionProviders.map((p) => p.name).join(", ")}`,
      );
    }
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** Names of every completion model available for multi-model drafting. */
  get completionProviderNames(): string[] {
    return this.completionProviders.map((p) => p.name);
  }

  /**
   * Run the same prompt through every configured completion provider, in
   * parallel. Returns one response per provider (primary first). A provider that
   * errors is dropped — callers still get the successful ones. With a single
   * provider configured this is just `complete()` wrapped in an array.
   */
  async completeAll(req: CompleteRequest): Promise<CompleteResponse[]> {
    const settled = await Promise.allSettled(
      this.completionProviders.map((p) => p.complete(req)),
    );
    const out: CompleteResponse[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        out.push(r.value);
      } else {
        this.logger.error(
          `completion provider ${this.completionProviders[i]?.name} failed`,
          r.reason as Error,
        );
      }
    });
    return out;
  }

  /** Embed a single string, returning the vector. */
  async embedOne(text: string): Promise<number[]> {
    const res = await this.provider.embed({ input: text });
    return res.vectors[0] ?? [];
  }

  embed(input: string | string[]): Promise<EmbedResponse> {
    return this.provider.embed({ input });
  }

  complete(req: CompleteRequest): Promise<CompleteResponse> {
    return this.provider.complete(req);
  }
}
