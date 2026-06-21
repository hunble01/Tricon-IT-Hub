/**
 * Pure, dependency-free helpers for the assistant agent loop — extracted so they
 * can be unit-tested without booting Nest or hitting a database.
 */

export interface Plan {
  reply?: string | null;
  tool?: { name: string; args?: Record<string, unknown> } | null;
  confirm?: boolean;
}

/** Pull the assistant's JSON plan out of a (possibly chatty) model completion. */
export function parsePlan(text: string): Plan {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return { reply: text.trim() || "…", tool: null };
  try {
    return JSON.parse(text.slice(start, end + 1)) as Plan;
  } catch {
    return { reply: text.trim(), tool: null };
  }
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Stable, multi-turn PII masker: assigns each known staff name a [[PERSON_n]]
 * token the first time it's seen and reuses it for the rest of the conversation,
 * so a token means the same person across every turn (the per-call PiiService
 * can't guarantee that). Pass-through when masking is disabled.
 */
export class NameMasker {
  private readonly names: string[];
  private readonly nameToToken = new Map<string, string>();
  private readonly tokenToName = new Map<string, string>();
  private counter = 0;

  constructor(names: string[], private readonly enabled: boolean) {
    this.names = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort(
      (a, b) => b.length - a.length,
    );
  }

  mask(text: string): string {
    if (!this.enabled || !text) return text;
    let out = text;
    for (const name of this.names) {
      const re = new RegExp(escapeRegExp(name), "gi");
      if (re.test(out)) {
        let token = this.nameToToken.get(name);
        if (!token) {
          token = `[[PERSON_${++this.counter}]]`;
          this.nameToToken.set(name, token);
          this.tokenToName.set(token, name);
        }
        out = out.replace(re, token);
      }
    }
    return out;
  }

  unmask(text: string): string {
    if (!text) return text;
    let out = text;
    for (const [token, name] of this.tokenToName) out = out.split(token).join(name);
    return out;
  }

  unmaskArgs(args: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) out[k] = typeof v === "string" ? this.unmask(v) : v;
    return out;
  }
}
