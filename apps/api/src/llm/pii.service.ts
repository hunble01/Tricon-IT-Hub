import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface Pseudonymized {
  text: string;
  /** token → original name. Kept local; never sent to the LLM. */
  map: Record<string, string>;
}

/**
 * Replaces known staff names (PII) with opaque tokens before any text leaves the
 * VPS for completion, and rehydrates the model's reply on return. The token↔name
 * map stays in-process and is persisted only inside our own audit/draft records,
 * never sent to the provider.
 *
 * Governed by PII_PSEUDONYMIZE (default on). When disabled (e.g. fully
 * self-hosted model), it is a transparent pass-through.
 */
@Injectable()
export class PiiService {
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>("PII_PSEUDONYMIZE") !== "false";
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Replace each provided name with a stable [[PERSON_n]] token.
   * Longer names are replaced first so full names win over bare first names.
   */
  pseudonymize(text: string, names: string[]): Pseudonymized {
    if (!this.enabled || !text) return { text, map: {} };

    const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort(
      (a, b) => b.length - a.length,
    );

    const map: Record<string, string> = {};
    let out = text;
    let i = 0;
    for (const name of unique) {
      const token = `[[PERSON_${++i}]]`;
      const re = new RegExp(escapeRegExp(name), "gi");
      if (re.test(out)) {
        out = out.replace(re, token);
        map[token] = name;
      } else {
        i--; // name not present — don't burn a token number
      }
    }
    return { text: out, map };
  }

  /** Swap tokens back to the original names in a model reply. */
  rehydrate(text: string, map: Record<string, string>): string {
    if (!text) return text;
    let out = text;
    for (const [token, name] of Object.entries(map)) {
      out = out.split(token).join(name);
    }
    return out;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
