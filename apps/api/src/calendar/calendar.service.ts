import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface CalendarEventInput {
  title: string;
  description?: string | null;
  /** The day the work is due — pushed as an all-day event. */
  date: Date;
}

export interface CalendarSyncResult {
  eventId: string;
  mode: "live" | "sandbox";
  webLink?: string;
}

/**
 * Pushes hub tasks onto the agent's calendar via Microsoft Graph
 * (`POST /me/events`, delegated per-agent like the Outlook adapter). We chose
 * Graph over a third-party broker (e.g. Nylas) so calendar data stays inside the
 * Microsoft tenant the org already trusts — no extra processor sees it, keeping
 * the on-VPS governance story intact.
 *
 * Live mode needs a delegated Graph token (GRAPH_ACCESS_TOKEN for local testing;
 * full per-agent OAuth lands with the M365 dev tenant). Falls back to a SANDBOX
 * simulation so the sync flow is testable end-to-end before credentials exist.
 */
@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(private readonly config: ConfigService) {}

  get available(): boolean {
    return Boolean(this.config.get<string>("GRAPH_CLIENT_ID"));
  }

  private token(): string | undefined {
    return this.config.get<string>("GRAPH_ACCESS_TOKEN") || undefined;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarSyncResult> {
    const day = input.date.toISOString().slice(0, 10);
    const nextDay = new Date(input.date.getTime() + 86_400_000).toISOString().slice(0, 10);
    const token = this.token();

    if (this.available && token) {
      const body = {
        subject: input.title,
        body: { contentType: "text", content: input.description ?? "" },
        isAllDay: true,
        start: { dateTime: `${day}T00:00:00`, timeZone: "UTC" },
        end: { dateTime: `${nextDay}T00:00:00`, timeZone: "UTC" },
        categories: ["Tricon IT Hub"],
      };
      const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        this.logger.error(`Graph event create ${res.status}: ${detail.slice(0, 200)}`);
        throw new Error(`Microsoft Graph calendar request failed (${res.status})`);
      }
      const json = (await res.json()) as { id?: string; webLink?: string };
      return { eventId: json.id ?? "", mode: "live", webLink: json.webLink };
    }

    if (this.config.get<string>("SOURCES_SANDBOX") !== "false") {
      // Deterministic-ish sandbox id from the title + day (no Date.now in scope concerns).
      return { eventId: `sandbox-evt-${day}-${slug(input.title)}`, mode: "sandbox" };
    }
    throw new Error("Calendar not configured (no Graph token, sandbox disabled)");
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
}
