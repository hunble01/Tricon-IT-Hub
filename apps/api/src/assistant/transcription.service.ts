import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface TranscriptionResult {
  text: string;
  provider: string;
}

/**
 * Server-side speech-to-text for the voice command box. Audio is sent from the
 * browser to OUR api and forwarded to a transcription provider — it never goes
 * to a browser-vendor cloud, keeping voice on the same governance footing as the
 * rest of the platform.
 *
 * Provider is config-driven (mirrors the LlmProvider seam): OpenAI Whisper today
 * via OPENAI_API_KEY; an Azure Speech (Canada Central) or self-hosted impl drops
 * in here later as a config swap. With no key configured it fails loudly rather
 * than silently leaking audio anywhere.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly openaiKey?: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.openaiKey = config.get<string>("OPENAI_API_KEY") || undefined;
    this.model = config.get<string>("TRANSCRIPTION_MODEL") || "whisper-1";
  }

  get available(): boolean {
    return !!this.openaiKey;
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string): Promise<TranscriptionResult> {
    if (!this.openaiKey) {
      throw new ServiceUnavailableException(
        "Voice transcription isn't configured. Set OPENAI_API_KEY (or wire an Azure Speech provider) to enable it.",
      );
    }

    const form = new FormData();
    const blob = new Blob([audio], { type: mimeType || "audio/webm" });
    form.append("file", blob, filename || "audio.webm");
    form.append("model", this.model);
    form.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.openaiKey}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(`transcription failed: ${res.status} ${detail}`);
      throw new ServiceUnavailableException("Transcription provider error");
    }

    const data = (await res.json()) as { text?: string };
    return { text: (data.text ?? "").trim(), provider: `openai:${this.model}` };
  }
}
