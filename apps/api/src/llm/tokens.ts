/** Nest DI token for the active LlmProvider (completions + embeddings). */
export const LLM_PROVIDER = Symbol("LLM_PROVIDER");

/**
 * All distinct completion-capable providers that have a key configured
 * (e.g. Anthropic + OpenAI), primary first. Used for side-by-side multi-model
 * drafting; empty-of-real-keys falls back to a single stub provider.
 */
export const COMPLETION_PROVIDERS = Symbol("COMPLETION_PROVIDERS");
