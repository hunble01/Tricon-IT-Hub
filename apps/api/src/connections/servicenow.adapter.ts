import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AgentContext,
  NeutralTicket,
  SendRequest,
  SendResult,
  SourceAdapter,
} from "@tricon/shared";

interface SnIncident {
  number?: string;
  sys_id?: string;
  short_description?: string;
  description?: string;
  state?: string;
  priority?: string;
  opened_at?: string;
  caller_id?: { display_value?: string } | string;
}

/**
 * Updates §1/§5 — ServiceNow source adapter (primary ticket source, Phase 2).
 * Reads the incident queue via the REST Table API as the delegated agent.
 * Read-only here; write-on-assigned + send come later. Falls back to clearly
 * labelled SANDBOX samples when no instance is configured, so the pipeline is
 * demoable before a ServiceNow PDI is wired.
 */
@Injectable()
export class ServiceNowAdapter implements SourceAdapter {
  readonly source = "SERVICENOW" as const;
  readonly kind = "TICKET" as const;
  private readonly logger = new Logger(ServiceNowAdapter.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>("SERVICENOW_INSTANCE_URL"));
  }

  ingest(input: unknown): NeutralTicket {
    const r = input as SnIncident;
    const caller =
      typeof r.caller_id === "string" ? r.caller_id : r.caller_id?.display_value;
    return {
      source: "SERVICENOW",
      externalId: r.number ?? r.sys_id,
      subject: r.short_description?.trim() || "(no subject)",
      body: r.description?.trim() || r.short_description?.trim() || "",
      status: mapState(r.state),
      priority: mapPriority(r.priority),
      requester: caller ? { fullName: caller } : undefined,
      raw: r,
      createdAt: r.opened_at ? new Date(r.opened_at) : undefined,
    };
  }

  /** Fetch recent active incidents (live) or sandbox samples. */
  async fetch(_ctx?: AgentContext): Promise<{ tickets: NeutralTicket[]; mode: "live" | "sandbox" }> {
    if (this.isConfigured()) {
      const base = this.config.get<string>("SERVICENOW_INSTANCE_URL")!.replace(/\/$/, "");
      const user = this.config.get<string>("SERVICENOW_USER") ?? "";
      const pass = this.config.get<string>("SERVICENOW_PASSWORD") ?? "";
      const url = `${base}/api/now/table/incident?sysparm_limit=25&sysparm_query=active=true^ORDERBYDESCopened_at&sysparm_display_value=true`;
      const res = await fetch(url, {
        headers: {
          Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.error(`ServiceNow fetch ${res.status}: ${detail.slice(0, 200)}`);
        throw new Error(`ServiceNow request failed (${res.status})`);
      }
      const json = (await res.json()) as { result?: SnIncident[] };
      return { tickets: (json.result ?? []).map((r) => this.ingest(r)), mode: "live" };
    }
    if (this.config.get<string>("SOURCES_SANDBOX") !== "false") {
      return { tickets: this.sample(), mode: "sandbox" };
    }
    return { tickets: [], mode: "sandbox" };
  }

  /**
   * Post the agent's reply as an incident comment (and optional work note).
   * Live PATCHes the incident via the Table API; resolves the sys_id from the
   * raw payload or by querying the incident number. Before a PDI is wired this
   * returns a clearly-labelled sandbox simulation so the Send flow is testable.
   */
  async send(req: SendRequest, _ctx?: AgentContext): Promise<SendResult> {
    if (this.isConfigured()) {
      const base = this.config.get<string>("SERVICENOW_INSTANCE_URL")!.replace(/\/$/, "");
      const user = this.config.get<string>("SERVICENOW_USER") ?? "";
      const pass = this.config.get<string>("SERVICENOW_PASSWORD") ?? "";
      const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

      let sysId = (req.raw as SnIncident | undefined)?.sys_id;
      if (!sysId && req.externalId) {
        const q = `${base}/api/now/table/incident?sysparm_query=number=${encodeURIComponent(req.externalId)}&sysparm_limit=1&sysparm_fields=sys_id`;
        const lookup = await fetch(q, { headers: { Authorization: auth, Accept: "application/json" } });
        if (lookup.ok) {
          const j = (await lookup.json()) as { result?: Array<{ sys_id?: string }> };
          sysId = j.result?.[0]?.sys_id;
        }
      }
      if (!sysId) throw new Error("Could not resolve the ServiceNow incident to reply to");

      const url = `${base}/api/now/table/incident/${sysId}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          comments: req.body, // customer-visible comment
          ...(req.internalNote ? { work_notes: req.internalNote } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.error(`ServiceNow send ${res.status}: ${detail.slice(0, 200)}`);
        throw new Error(`ServiceNow reply failed (${res.status})`);
      }
      return { delivered: true, mode: "live", externalRef: sysId };
    }
    if (this.config.get<string>("SOURCES_SANDBOX") !== "false") {
      return {
        delivered: true,
        mode: "sandbox",
        externalRef: `sandbox-comment-${req.externalId ?? "x"}`,
        detail: "Simulated ServiceNow comment (sandbox — no PDI configured)",
      };
    }
    return { delivered: false, mode: "sandbox", detail: "ServiceNow not configured" };
  }

  private sample(): NeutralTicket[] {
    return [
      {
        source: "SERVICENOW",
        externalId: "INC0010042",
        subject: "Outlook keeps asking for password at The Selby front desk",
        body: "[SANDBOX] The shared front-desk PC at The Selby repeatedly prompts for the Outlook password and won't stay signed in. Started this morning.",
        status: "OPEN",
        priority: "HIGH",
        requester: { fullName: "Front Desk — The Selby" },
        raw: { sandbox: true },
      },
      {
        source: "SERVICENOW",
        externalId: "INC0010043",
        subject: "New leasing consultant needs a laptop + headset",
        body: "[SANDBOX] Please provision standard kit for our new leasing consultant starting Monday at Birch House.",
        status: "PENDING",
        priority: "NORMAL",
        requester: { fullName: "GM — Birch House" },
        raw: { sandbox: true },
      },
      {
        source: "SERVICENOW",
        externalId: "INC0010044",
        subject: "Monitor flickering in the leasing office",
        body: "[SANDBOX] One of the two monitors at the leasing desk flickers intermittently. Possible cable or dock issue.",
        status: "OPEN",
        priority: "LOW",
        requester: { fullName: "Leasing — The Taylor" },
        raw: { sandbox: true },
      },
    ];
  }
}

function mapState(state?: string): NeutralTicket["status"] {
  const s = (state ?? "").toLowerCase();
  if (s.includes("resolv") || s.includes("closed") || s === "6" || s === "7") return "RESOLVED";
  if (s.includes("progress") || s.includes("pending") || s === "2" || s === "3") return "PENDING";
  return "OPEN";
}

function mapPriority(priority?: string): NeutralTicket["priority"] {
  const p = (priority ?? "").toLowerCase();
  if (p.includes("critical") || p.startsWith("1")) return "URGENT";
  if (p.includes("high") || p.startsWith("2")) return "HIGH";
  if (p.includes("low") || p.startsWith("4") || p.startsWith("5")) return "LOW";
  return "NORMAL";
}
