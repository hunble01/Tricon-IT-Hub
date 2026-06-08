/**
 * LLM provider contract. All LLM access goes through this interface so providers
 * (OpenAI, Anthropic, Azure OpenAI, self-hosted) are a config swap.
 * Calls are server-side only — keys never reach the browser.
 */

export interface EmbedRequest {
  input: string | string[];
}

export interface EmbedResponse {
  vectors: number[][];
  dim: number;
  model: string;
}

export interface CompleteMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteRequest {
  messages: CompleteMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Pseudonymized text MUST be passed here. Caller rehydrates after return. */
}

export interface CompleteResponse {
  text: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
  complete(req: CompleteRequest): Promise<CompleteResponse>;
}
