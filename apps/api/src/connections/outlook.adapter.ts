import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AgentContext,
  NeutralTicket,
  SendRequest,
  SendResult,
  SourceAdapter,
} from "@tricon/shared";

interface GraphMessage {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

/**
 * Updates §5 — Outlook source adapter (secondary source, Phase 2). Reads the
 * signed-in agent's OWN inbox via Microsoft Graph (delegated `Mail.Read`),
 * never a colleague's. Read-only; `Mail.Send` is a later, higher-trust grant.
 *
 * Live mode needs a delegated Graph access token (per agent). For local testing
 * a token can be supplied via GRAPH_ACCESS_TOKEN; the full per-agent OAuth flow
 * is wired when the M365 dev tenant exists. Falls back to SANDBOX samples.
 */
@Injectable()
export class OutlookAdapter implements SourceAdapter {
  readonly source = "OUTLOOK" as const;
  readonly kind = "EMAIL" as const;
  private readonly logger = new Logger(OutlookAdapter.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>("GRAPH_CLIENT_ID"));
  }

  private token(ctx?: AgentContext): string | undefined {
    const fromCtx = ctx?.credentials?.graphToken;
    return (typeof fromCtx === "string" && fromCtx) || this.config.get<string>("GRAPH_ACCESS_TOKEN");
  }

  ingest(input: unknown): NeutralTicket {
    const m = input as GraphMessage;
    const from = m.from?.emailAddress;
    return {
      source: "OUTLOOK",
      externalId: m.id,
      subject: m.subject?.trim() || "(no subject)",
      body: (m.body?.content || m.bodyPreview || "").trim(),
      status: "OPEN",
      requester: from ? { fullName: from.name, email: from.address } : undefined,
      raw: m,
      createdAt: m.receivedDateTime ? new Date(m.receivedDateTime) : undefined,
    };
  }

  /** Fetch the agent's recent inbox messages (live) or sandbox samples. */
  async fetch(ctx?: AgentContext): Promise<{ tickets: NeutralTicket[]; mode: "live" | "sandbox" }> {
    const token = this.token(ctx);
    if (this.isConfigured() && token) {
      const url = "https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=id,subject,bodyPreview,from,receivedDateTime";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.error(`Graph fetch ${res.status}: ${detail.slice(0, 200)}`);
        throw new Error(`Microsoft Graph request failed (${res.status})`);
      }
      const json = (await res.json()) as { value?: GraphMessage[] };
      return { tickets: (json.value ?? []).map((m) => this.ingest(m)), mode: "live" };
    }
    if (this.config.get<string>("SOURCES_SANDBOX") !== "false") {
      return { tickets: this.sample(), mode: "sandbox" };
    }
    return { tickets: [], mode: "sandbox" };
  }

  /**
   * Reply to the requester's email as the signed-in agent via Graph
   * (`/me/messages/{id}/reply`, delegated `Mail.Send`). Before the M365 dev
   * tenant + send grant exist this returns a sandbox simulation so the Send
   * flow is testable end-to-end.
   */
  async send(req: SendRequest, ctx?: AgentContext): Promise<SendResult> {
    const token = this.token(ctx);
    if (this.isConfigured() && token && req.externalId) {
      const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(req.externalId)}/reply`;
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: req.body }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.error(`Graph reply ${res.status}: ${detail.slice(0, 200)}`);
        throw new Error(`Microsoft Graph reply failed (${res.status})`);
      }
      return { delivered: true, mode: "live", externalRef: req.externalId };
    }
    if (this.config.get<string>("SOURCES_SANDBOX") !== "false") {
      return {
        delivered: true,
        mode: "sandbox",
        externalRef: `sandbox-reply-${req.externalId ?? "x"}`,
        detail: "Simulated Outlook reply (sandbox — no Mail.Send grant yet)",
      };
    }
    return { delivered: false, mode: "sandbox", detail: "Outlook not configured" };
  }

  private sample(): NeutralTicket[] {
    return [
      {
        source: "OUTLOOK",
        externalId: "AAMkSANDBOX-001",
        subject: "Help — can't connect to WiFi on my work laptop",
        body: "[SANDBOX] Hi IT, since the weekend my laptop won't join the office WiFi at The Taylor. It sees the network but won't connect. Can you help? Thanks, Dana",
        status: "OPEN",
        requester: { fullName: "Dana Whitfield", email: "dwhitfield@example.com" },
        raw: { sandbox: true },
      },
      {
        source: "OUTLOOK",
        externalId: "AAMkSANDBOX-002",
        subject: "Request: second monitor for the leasing desk",
        body: "[SANDBOX] Could we get a second monitor for the leasing desk? It would really speed up tour scheduling. Let me know what's needed. — Marcus",
        status: "OPEN",
        requester: { fullName: "Marcus Lee", email: "mlee@example.com" },
        raw: { sandbox: true },
      },
    ];
  }
}
