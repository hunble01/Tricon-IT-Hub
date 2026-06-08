import { Global, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { LlmProvider } from "@tricon/shared";
import { AnthropicProvider } from "./anthropic.provider";
import { CompositeLlmProvider } from "./composite.provider";
import { LlmService } from "./llm.service";
import { OpenAiProvider } from "./openai.provider";
import { PiiService } from "./pii.service";
import { StubLlmProvider } from "./stub.provider";
import { COMPLETION_PROVIDERS, LLM_PROVIDER } from "./tokens";

/**
 * Wires the active LlmProvider from env.
 *
 * Completions: LLM_PROVIDER=openai|anthropic, used only if its API key is
 * present; otherwise the StubLlmProvider so dev works without secrets.
 *
 * Embeddings: EMBEDDING_PROVIDER (optional) overrides which provider serves
 * embed(). This exists because Anthropic has no embeddings endpoint — set
 * LLM_PROVIDER=anthropic + EMBEDDING_PROVIDER=openai to get real Claude
 * completions with real OpenAI vectors. If unset, embeddings use the same
 * provider as completions (back-compat). When the two differ the providers are
 * fused behind a CompositeLlmProvider, invisible to every caller.
 *
 * Global so any feature module can inject LlmService / PiiService without
 * re-importing.
 */
/**
 * Build a concrete completion/embedding provider by name from env, or null when
 * its key is missing. Shared by both DI factories below.
 */
function buildProvider(
  name: string,
  config: ConfigService,
  dim: number,
): LlmProvider | null {
  const openaiKey = config.get<string>("OPENAI_API_KEY");
  const anthropicKey = config.get<string>("ANTHROPIC_API_KEY");
  if (name === "anthropic" && anthropicKey) {
    return new AnthropicProvider({ apiKey: anthropicKey, embeddingDim: dim });
  }
  if (name === "openai" && openaiKey) {
    return new OpenAiProvider({ apiKey: openaiKey, embeddingDim: dim });
  }
  return null;
}

function embeddingDim(config: ConfigService): number {
  return Number(config.get<string>("EMBEDDING_DIM") ?? "1536");
}

function primaryChoice(config: ConfigService): string {
  return (config.get<string>("LLM_PROVIDER") ?? "openai").toLowerCase();
}

@Global()
@Module({
  providers: [
    PiiService,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmProvider => {
        const logger = new Logger("LlmModule");
        const dim = embeddingDim(config);
        const choice = primaryChoice(config);
        const completion = buildProvider(choice, config, dim) ?? new StubLlmProvider(dim);

        // Optional embeddings override (e.g. OpenAI vectors under Anthropic).
        let embedding = completion;
        const embedChoice = (config.get<string>("EMBEDDING_PROVIDER") ?? "").toLowerCase();
        if (embedChoice && embedChoice !== choice) {
          const e = buildProvider(embedChoice, config, dim);
          if (e) {
            embedding = e;
          } else {
            logger.warn(
              `EMBEDDING_PROVIDER=${embedChoice} but its API key is missing — ` +
                `embeddings fall back to ${completion.name}.`,
            );
          }
        }

        return completion === embedding
          ? completion
          : new CompositeLlmProvider(completion, embedding);
      },
    },
    {
      // Every completion-capable provider that has a key, primary first.
      // Powers side-by-side multi-model drafting (e.g. Claude + GPT).
      provide: COMPLETION_PROVIDERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmProvider[] => {
        const dim = embeddingDim(config);
        const primary = primaryChoice(config);
        const order = primary === "anthropic" ? ["anthropic", "openai"] : ["openai", "anthropic"];
        const providers = order
          .map((name) => buildProvider(name, config, dim))
          .filter((p): p is LlmProvider => p !== null);
        return providers.length ? providers : [new StubLlmProvider(dim)];
      },
    },
    LlmService,
  ],
  exports: [LlmService, PiiService],
})
export class LlmModule {}
