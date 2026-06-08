import { Injectable } from "@nestjs/common";
import type { NeutralTicket, SourceAdapter } from "@tricon/shared";

export interface ManualTicketInput {
  rawText?: string;
  subject?: string;
  body?: string;
  requesterName?: string;
  buildingHint?: string;
  category?: string;
}

/**
 * Phase 1 ticket adapter — turns pasted text into a NeutralTicket. The ticket
 * engine depends only on TicketAdapter, so the ServiceNow REST adapter slots in
 * later without touching the drafting/memory logic.
 */
@Injectable()
export class ManualAdapter implements SourceAdapter {
  readonly source = "MANUAL" as const;
  readonly kind = "TICKET" as const;

  ingest(input: ManualTicketInput): NeutralTicket {
    const subject = (input.subject ?? this.deriveSubject(input.rawText ?? "")).trim();
    const body = (input.body ?? input.rawText ?? "").trim();

    return {
      source: this.source,
      subject: subject || "(no subject)",
      body,
      status: "OPEN",
      priority: "NORMAL",
      category: input.category?.trim() || undefined,
      requester: input.requesterName
        ? { fullName: input.requesterName.trim(), buildingHint: input.buildingHint?.trim() }
        : undefined,
      raw: { ...input },
    };
  }

  /** First non-empty line becomes the subject, capped to a sane length. */
  private deriveSubject(text: string): string {
    const firstLine = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (!firstLine) return "";
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  }
}
