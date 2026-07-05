import { Injectable, Logger } from "@nestjs/common";
import { Building, DeviceType, Prisma, Role } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { DevicesService } from "../devices/devices.service";
import { LlmService } from "../llm/llm.service";
import { PiiService } from "../llm/pii.service";
import { OnboardingService } from "../onboarding/onboarding.service";
import { PrismaService } from "../prisma/prisma.service";
import { splitName, normalize } from "../staff/name";
import { StaffMatcherService } from "../staff/staff-matcher.service";
import { StaffService } from "../staff/staff.service";
import { AnalyzeIntakeDto, CommitIntakeDto, IntakeHint } from "./dto";

export interface PossibleDuplicate {
  staffId: string;
  fullName: string;
  similarity: number;
}

type IntakeKind = "NEW_HIRE" | "DEVICES" | "STAFF" | "UNKNOWN";

export type IntakeSegmentKind = "TICKET" | "NEW_HIRE" | "STAFF" | "DEVICES" | "INVOICE" | "TASK" | "UNKNOWN";
const SEGMENT_KINDS: IntakeSegmentKind[] = ["TICKET", "NEW_HIRE", "STAFF", "DEVICES", "INVOICE", "TASK", "UNKNOWN"];

export interface IntakeSegment {
  text: string;
  kind: IntakeSegmentKind;
  summary: string;
  requesterNameGuess: string | null;
}

export interface ClassifyResult {
  source: "ai" | "basic";
  segments: IntakeSegment[];
}

interface RawExtraction {
  kind: IntakeKind;
  summary: string;
  newHires?: Array<{ fullName?: string; roleTitle?: string; buildingName?: string; startDate?: string }>;
  devices?: Array<{ type?: string; model?: string; serialNumber?: string; assetTag?: string; quantity?: number }>;
  staff?: Array<{ fullName?: string; roleTitle?: string; buildingName?: string; email?: string; phone?: string }>;
}

export interface AnalyzeResult {
  kind: IntakeKind;
  source: "ai" | "basic";
  summary: string;
  newHires: Array<{
    fullName: string;
    roleTitle: string | null;
    roleId: string | null;
    buildingName: string | null;
    buildingId: string | null;
    startDate: string | null;
    adPrefix: string | null;
    unresolved: string[];
    possibleDuplicate: PossibleDuplicate | null;
  }>;
  devices: Array<{
    type: DeviceType;
    model: string | null;
    serialNumber: string | null;
    assetTag: string | null;
    quantity: number;
  }>;
  staff: Array<{
    fullName: string;
    roleTitle: string | null;
    roleId: string | null;
    buildingName: string | null;
    buildingId: string | null;
    email: string | null;
    phone: string | null;
    possibleDuplicate: PossibleDuplicate | null;
  }>;
}

const DEVICE_TYPES: DeviceType[] = [
  "LAPTOP", "SURFACE", "PHONE", "TABLET", "HEADSET",
  "DOCK", "MONITOR", "MINI_PC", "USB_ADAPTER", "OTHER",
];

// Free-text → enum. Keys are matched as lowercase substrings.
const TYPE_KEYWORDS: Array<[string, DeviceType]> = [
  ["macbook", "LAPTOP"], ["laptop", "LAPTOP"], ["notebook", "LAPTOP"], ["thinkpad", "LAPTOP"],
  ["latitude", "LAPTOP"], ["elitebook", "LAPTOP"], ["xps", "LAPTOP"],
  ["surface", "SURFACE"],
  ["iphone", "PHONE"], ["pixel", "PHONE"], ["phone", "PHONE"], ["galaxy", "PHONE"],
  ["ipad", "TABLET"], ["tablet", "TABLET"],
  ["headset", "HEADSET"], ["headphone", "HEADSET"], ["jabra", "HEADSET"], ["poly", "HEADSET"],
  ["dock", "DOCK"], ["docking", "DOCK"],
  ["monitor", "MONITOR"], ["display", "MONITOR"], ["screen", "MONITOR"],
  ["mini pc", "MINI_PC"], ["mini-pc", "MINI_PC"], ["nuc", "MINI_PC"], ["optiplex", "MINI_PC"],
  ["adapter", "USB_ADAPTER"], ["dongle", "USB_ADAPTER"], ["usb-c", "USB_ADAPTER"],
];

function normalizeDeviceType(raw: string | undefined): DeviceType {
  if (!raw) return "OTHER";
  const up = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((DEVICE_TYPES as string[]).includes(up)) return up as DeviceType;
  const low = raw.toLowerCase();
  for (const [kw, type] of TYPE_KEYWORDS) if (low.includes(kw)) return type;
  return "OTHER";
}

/** Pull the first balanced JSON object out of a model completion. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no json");
  return JSON.parse(text.slice(start, end + 1));
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly onboarding: OnboardingService,
    private readonly devices: DevicesService,
    private readonly staff: StaffService,
    private readonly staffMatcher: StaffMatcherService,
    private readonly audit: AuditService,
    private readonly pii: PiiService,
  ) {}

  async analyze(dto: AnalyzeIntakeDto): Promise<AnalyzeResult> {
    const [roles, buildings] = await Promise.all([
      this.prisma.role.findMany(),
      this.prisma.building.findMany(),
    ]);

    let raw: RawExtraction | null = null;
    let source: "ai" | "basic" = "basic";

    if (this.llm.providerName !== "stub") {
      try {
        raw = await this.llmExtract(dto.rawText, dto.hint ?? "AUTO", roles, buildings);
        source = "ai";
      } catch (err) {
        this.logger.warn(`LLM extraction failed, using basic parser: ${(err as Error).message}`);
      }
    }
    if (!raw) raw = this.heuristicExtract(dto.rawText, dto.hint ?? "AUTO");

    return this.resolve(raw, roles, buildings, source);
  }

  /**
   * Split a pasted blob into independent topical segments and classify each
   * one (TICKET/NEW_HIRE/STAFF/DEVICES/INVOICE/TASK/UNKNOWN) — the "universal
   * paste box" front door. Each segment is later analyzed/extracted and
   * committed through the existing kind-specific flow (Intake analyze/commit,
   * Procurement extract/process, Tickets preview/draft, Tasks create); this
   * method only decides what's in the paste and where it should go.
   */
  async classify(rawText: string): Promise<ClassifyResult> {
    const [roles, buildings] = await Promise.all([
      this.prisma.role.findMany(),
      this.prisma.building.findMany(),
    ]);

    if (this.llm.providerName !== "stub") {
      try {
        const segments = await this.llmClassify(rawText, roles, buildings);
        if (segments.length) return { source: "ai", segments };
      } catch (err) {
        this.logger.warn(`LLM classify failed, using basic parser: ${(err as Error).message}`);
      }
    }
    return { source: "basic", segments: heuristicClassify(rawText) };
  }

  /**
   * Commit is best-effort per record, not all-or-nothing: the three groups
   * (onboardings/staff/devices) are unrelated entities from one heterogeneous
   * paste, so one bad row (e.g. a duplicate assetTag) shouldn't roll back
   * everything else in the batch. Every row is tried, every failure is caught
   * and reported back — nothing 500s and silently half-commits anymore.
   */
  async commit(dto: CommitIntakeDto, actor: AuthenticatedUser) {
    const created = { onboardings: 0, staff: 0, devices: 0 };
    const duplicatesSkipped: Array<{ fullName: string; existingStaffId: string; similarity: number }> = [];
    const errors: Array<{ kind: "newHire" | "staff" | "device"; label: string; message: string }> = [];

    for (const h of dto.newHires ?? []) {
      if (!h.confirmDuplicate) {
        const dupe = await this.findConfirmedDuplicate(h.fullName);
        if (dupe) {
          duplicatesSkipped.push({ fullName: h.fullName, existingStaffId: dupe.staffId, similarity: dupe.similarity });
          continue;
        }
      }
      try {
        await this.onboarding.start(
          { fullName: h.fullName, roleId: h.roleId, buildingId: h.buildingId, startDate: h.startDate },
          actor,
        );
        created.onboardings++;
      } catch (err) {
        errors.push({ kind: "newHire", label: h.fullName, message: this.friendlyError(err) });
      }
    }

    for (const s of dto.staff ?? []) {
      if (!s.confirmDuplicate) {
        const dupe = await this.findConfirmedDuplicate(s.fullName);
        if (dupe) {
          duplicatesSkipped.push({ fullName: s.fullName, existingStaffId: dupe.staffId, similarity: dupe.similarity });
          continue;
        }
      }
      try {
        await this.staff.create(
          {
            fullName: s.fullName,
            roleId: s.roleId,
            buildingId: s.buildingId,
            email: s.email,
            phone: s.phone,
            source: "MANUAL",
          },
          actor,
        );
        created.staff++;
      } catch (err) {
        errors.push({ kind: "staff", label: s.fullName, message: this.friendlyError(err) });
      }
    }

    for (const d of dto.devices ?? []) {
      const qty = Math.max(1, Math.min(d.quantity ?? 1, 50));
      const type = normalizeDeviceType(d.type);
      for (let i = 0; i < qty; i++) {
        const assetTag = d.assetTag ? (qty > 1 ? `${d.assetTag}-${i + 1}` : d.assetTag) : undefined;
        // Only carry an individual serial when a single unit is created.
        const serialNumber = qty === 1 ? d.serialNumber || undefined : undefined;
        const label = assetTag ?? `${d.model ?? type} (unit ${i + 1}/${qty})`;
        try {
          await this.devices.create(
            { type, model: d.model || undefined, serialNumber, assetTag, locationId: d.locationId || undefined },
            actor,
          );
          created.devices++;
        } catch (err) {
          errors.push({ kind: "device", label, message: this.friendlyError(err) });
        }
      }
    }

    await this.audit.record({
      action: "intake.commit",
      userId: actor.userId,
      entityType: "Intake",
      metadata: { ...created, duplicatesSkipped, errors },
    });

    return { ...created, duplicatesSkipped, errors };
  }

  /** Translate a raw Prisma error into something a non-technical user can act on. */
  private friendlyError(err: unknown): string {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const fields = ((err.meta?.target as string[] | undefined) ?? []).join(", ");
      return fields ? `Already in use: ${fields}` : "Already exists (duplicate value)";
    }
    return (err as Error).message ?? "Unknown error";
  }

  /** High-confidence existing-Staff match, used to keep commit() from silently duplicating a person. */
  private async findConfirmedDuplicate(fullName: string): Promise<PossibleDuplicate | null> {
    const verdict = await this.staffMatcher.match(fullName);
    return verdict.kind === "match"
      ? { staffId: verdict.staff.id, fullName: verdict.staff.fullName, similarity: verdict.similarity }
      : null;
  }

  // ---- extraction ----------------------------------------------------

  private async llmExtract(
    rawText: string,
    hint: IntakeHint,
    roles: Role[],
    buildings: Building[],
  ): Promise<RawExtraction> {
    // Anchor relative/partial dates ("next Monday", "June 15") to the real
    // current date so the model can't guess a stale year.
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

    const system = [
      "You convert pasted IT intake text into structured JSON. You never invent data.",
      "Classify the text as one of: NEW_HIRE (people to onboard), DEVICES (hardware to add to inventory), STAFF (existing people for the directory), or UNKNOWN.",
      "Extract every record you can find. For devices, set `type` to one of: " + DEVICE_TYPES.join(", ") + ". Map product names (MacBook→LAPTOP, iPhone→PHONE, etc.). Use `quantity` for repeated items.",
      "Map role and building names to the closest known value when possible.",
      `Today's date is ${today} (${weekday}). Resolve every relative or partial date (e.g. "next Monday", "tomorrow", "June 15") against today. Format dates as YYYY-MM-DD. A start date is today or in the future — if a month/day implies a date already past this year, use next year. Never output a date earlier than today.`,
      "Respond with ONLY a JSON object of this shape:",
      '{"kind":"...","summary":"one sentence","newHires":[{"fullName":"","roleTitle":"","buildingName":"","startDate":""}],"devices":[{"type":"","model":"","serialNumber":"","assetTag":"","quantity":1}],"staff":[{"fullName":"","roleTitle":"","buildingName":"","email":"","phone":""}]}',
    ].join("\n");

    // Pasted intake text is often the PII itself (a new hire's own name, email,
    // phone). Redact every name/email/phone we can find — known staff plus a
    // best-effort local guess at names in this text — before it leaves for
    // completion, then rehydrate the model's JSON reply before parsing it.
    const candidates = await this.candidatePiiStrings(rawText, roles, buildings);
    const { text: safeRawText, map } = this.pii.pseudonymize(rawText, candidates);

    const user = [
      hint !== "AUTO" ? `The user says this is: ${hint}.` : "",
      `Known roles: ${roles.map((r) => r.title).join(", ")}`,
      `Known buildings: ${buildings.map((b) => b.name).join(", ")}`,
      "",
      "TEXT:",
      safeRawText,
    ].join("\n");

    const { text } = await this.llm.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      maxTokens: 1200,
    });
    const parsed = extractJson(this.pii.rehydrate(text, map)) as RawExtraction;
    if (!parsed.kind) parsed.kind = "UNKNOWN";
    return parsed;
  }

  private async llmClassify(rawText: string, roles: Role[], buildings: Building[]): Promise<IntakeSegment[]> {
    const system = [
      "You split pasted work text (an email, note, or paste) into independent topical segments and classify each one.",
      "Keep paragraphs about the SAME topic together in one segment — only split where the topic genuinely changes " +
        "(e.g. a new-hire paragraph followed by an unrelated broken-printer paragraph is two segments; a normal " +
        "multi-paragraph email about one thing is one segment).",
      "Classify each segment as one of: TICKET (an IT problem or request to fix), NEW_HIRE (a person to onboard), " +
        "STAFF (existing people for the directory), DEVICES (hardware to add to inventory), INVOICE (a purchase, " +
        "invoice, or receipt with costs or line items), TASK (a to-do that isn't an IT problem, e.g. \"order more " +
        "HDMI cables\"), or UNKNOWN.",
      "For TICKET segments only, also guess `requesterNameGuess` from a name or signature if one is present " +
        "(omit or leave empty if unsure). Never guess it for other kinds.",
      "`summary` is a short human label for the segment, e.g. \"Ticket: printer broken on 3rd floor\".",
      "Respond with ONLY a JSON object of this shape:",
      '{"segments":[{"text":"...","kind":"...","summary":"...","requesterNameGuess":""}]}',
    ].join("\n");

    // Same redaction discipline as llmExtract — this call doesn't know the
    // kind ahead of time, so it may contain ticket or new-hire PII.
    const candidates = await this.candidatePiiStrings(rawText, roles, buildings);
    const { text: safeRawText, map } = this.pii.pseudonymize(rawText, candidates);

    const { text } = await this.llm.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `TEXT:\n${safeRawText}` },
      ],
      temperature: 0,
      maxTokens: 1600,
    });

    const parsed = extractJson(this.pii.rehydrate(text, map)) as { segments?: Array<Partial<IntakeSegment>> };
    return (parsed.segments ?? [])
      .filter((s) => s.text?.trim())
      .slice(0, 20)
      .map((s) => {
        const kind = SEGMENT_KINDS.includes(s.kind as IntakeSegmentKind) ? (s.kind as IntakeSegmentKind) : "UNKNOWN";
        const segText = s.text!.trim();
        return {
          text: segText,
          kind,
          summary: s.summary?.trim() || firstLineSummary(segText),
          requesterNameGuess: kind === "TICKET" ? s.requesterNameGuess?.trim() || null : null,
        };
      });
  }

  /**
   * Best-effort list of strings to redact before an intake paste leaves for
   * completion: existing staff names (covers STAFF-directory pastes and any
   * existing person mentioned in a NEW_HIRE email), plus emails, phone numbers,
   * and labeled/likely name tokens pulled straight out of this paste (covers a
   * brand-new hire who isn't in the Staff table yet). Over-matching is
   * harmless — pseudonymize/rehydrate round-trips exactly, so a false-positive
   * "name" (e.g. a building name) just costs the model a little context.
   */
  private async candidateStaffNames(): Promise<string[]> {
    const staff = await this.prisma.staff.findMany({ select: { fullName: true, lastName: true } });
    const names: string[] = [];
    for (const s of staff) {
      if (s.fullName) names.push(s.fullName);
      if (s.lastName) names.push(s.lastName);
    }
    return names;
  }

  private async candidatePiiStrings(rawText: string, roles: Role[], buildings: Building[]): Promise<string[]> {
    const known = await this.candidateStaffNames();

    const emails = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
    const phones = rawText.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) ?? [];

    const labeled = rawText.match(/\b(?:name|new hire|employee)\s*[:\-]\s*([^\n,]+)/gi) ?? [];
    const labeledNames = labeled
      .map((m) => m.replace(/\b(?:name|new hire|employee)\s*[:\-]\s*/i, "").trim())
      .filter(Boolean);

    // "Firstname Lastname"-shaped runs, minus known role/building titles so
    // e.g. "Leasing Consultant" doesn't get needlessly redacted.
    const properNoise = new Set(
      [...roles.map((r) => r.title), ...buildings.map((b) => b.name)].map((s) => s.toLowerCase()),
    );
    const nameRuns = (rawText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) ?? []).filter(
      (n) => !properNoise.has(n.toLowerCase()),
    );

    return [...known, ...emails, ...phones, ...labeledNames, ...nameRuns];
  }

  /** Deterministic fallback used when no LLM key is configured. */
  private heuristicExtract(rawText: string, hint: IntakeHint): RawExtraction {
    const kind = hint !== "AUTO" ? hint : this.detectKind(rawText);
    if (kind === "DEVICES") {
      return { kind, summary: "Parsed device lines.", devices: this.parseDevices(rawText) };
    }
    if (kind === "NEW_HIRE") {
      return { kind, summary: "Parsed new hire(s).", newHires: this.parsePeople(rawText) };
    }
    if (kind === "STAFF") {
      return { kind, summary: "Parsed staff list.", staff: this.parsePeople(rawText) };
    }
    return { kind: "UNKNOWN", summary: "Could not classify the text. Pick a type above and retry." };
  }

  private detectKind(text: string): IntakeKind {
    const low = text.toLowerCase();
    const deviceHits = [
      /serial|s\/n|asset tag|\bsku\b|\bqty\b|\bx\d|model/, ...TYPE_KEYWORDS.map(([k]) => new RegExp(k)),
    ].filter((re) => re.test(low)).length;
    const hireHits = [/new hire|onboard|start date|starts?\b|joining|role|position|title/].filter((re) =>
      re.test(low),
    ).length;
    if (deviceHits >= 2 && deviceHits >= hireHits) return "DEVICES";
    if (hireHits >= 1) return "NEW_HIRE";
    if (text.split(/\r?\n/).filter((l) => l.trim()).length > 0) return "STAFF";
    return "UNKNOWN";
  }

  private parseDevices(text: string): RawExtraction["devices"] {
    const out: NonNullable<RawExtraction["devices"]> = [];
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      const type = normalizeDeviceType(l);
      const serial = l.match(/\b(?:s\/n|serial(?:\s*number)?|sn)[:#\s]+([A-Za-z0-9-]{4,})/i)?.[1];
      const tag = l.match(/\b(?:asset(?:\s*tag)?|tag)[:#\s]+([A-Za-z0-9-]{3,})/i)?.[1];
      const qty = l.match(/(?:^|\s)(?:x\s*(\d+)|qty[:\s]*(\d+)|\((\d+)\)|(\d+)\s*x)\b/i);
      const quantity = qty ? Number(qty[1] ?? qty[2] ?? qty[3] ?? qty[4]) : 1;
      // Skip lines that have neither a recognizable type nor any identifier.
      if (type === "OTHER" && !serial && !tag) continue;
      const model = l
        .replace(/\b(?:s\/n|serial(?:\s*number)?|sn)[:#\s]+[A-Za-z0-9-]{4,}/i, "")
        .replace(/\b(?:asset(?:\s*tag)?|tag)[:#\s]+[A-Za-z0-9-]{3,}/i, "")
        .replace(/(?:^|\s)(?:x\s*\d+|qty[:\s]*\d+|\(\d+\)|\d+\s*x)\b/i, "")
        .replace(/[•\-*]\s*/, "")
        .trim();
      out.push({
        type,
        model: model || undefined,
        serialNumber: serial,
        assetTag: tag,
        quantity: Number.isFinite(quantity) ? quantity : 1,
      });
    }
    return out;
  }

  private parsePeople(text: string): Array<{ fullName?: string; roleTitle?: string; buildingName?: string; startDate?: string; email?: string; phone?: string }> {
    // Labeled block ("Name: …", "Role: …") → single record.
    const labeled = this.parseLabeledPerson(text);
    if (labeled) return [labeled];

    // Otherwise: one person per line, "Full Name — Role, Building, starts <date>".
    const out: Array<{ fullName?: string; roleTitle?: string; buildingName?: string; startDate?: string }> = [];
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim().replace(/^[•\-*]\s*/, "");
      if (!l) continue;
      const date = l.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
      const segments = l.split(/\s+[–—-]\s+|,/).map((s) => s.trim()).filter(Boolean);
      const fullName = segments[0];
      if (!fullName || !/[a-z]/i.test(fullName)) continue;
      out.push({
        fullName,
        roleTitle: segments[1]?.replace(/\bstarts?\b.*/i, "").trim() || undefined,
        buildingName: segments[2]?.replace(/\bstarts?\b.*/i, "").trim() || undefined,
        startDate: date,
      });
    }
    return out;
  }

  private parseLabeledPerson(text: string) {
    const field = (re: RegExp) => text.match(re)?.[1]?.trim();
    const fullName = field(/\b(?:name|new hire|employee)\s*[:\-]\s*(.+)/i);
    if (!fullName) return null;
    return {
      fullName,
      roleTitle: field(/\b(?:role|title|position)\s*[:\-]\s*(.+)/i),
      buildingName: field(/\b(?:building|site|location|property)\s*[:\-]\s*(.+)/i),
      startDate:
        text.match(/\bstart(?:\s*date)?\s*[:\-]\s*(.+)/i)?.[1]?.trim().match(/\d{4}-\d{2}-\d{2}/)?.[0] ??
        text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1],
      email: field(/\b(?:email|e-mail)\s*[:\-]\s*(\S+@\S+)/i),
      phone: field(/\b(?:phone|tel|mobile|cell)\s*[:\-]\s*([\d\-+() ]{7,})/i),
    };
  }

  // ---- resolution ----------------------------------------------------

  private async resolve(
    raw: RawExtraction,
    roles: Role[],
    buildings: Building[],
    source: "ai" | "basic",
  ): Promise<AnalyzeResult> {
    const resolveRole = (name?: string) => matchByName(name, roles, (r) => r.title);
    const resolveBuilding = (name?: string) => matchByName(name, buildings, (b) => b.name);

    const newHires = await Promise.all(
      (raw.newHires ?? [])
        .filter((h) => h.fullName?.trim())
        .map(async (h) => {
          const role = resolveRole(h.roleTitle);
          const building = resolveBuilding(h.buildingName);
          const parts = splitName(h.fullName!);
          const unresolved: string[] = [];
          if (!role) unresolved.push("role");
          if (!building) unresolved.push("building");
          return {
            fullName: h.fullName!.trim(),
            roleTitle: h.roleTitle ?? null,
            roleId: role?.id ?? null,
            buildingName: h.buildingName ?? null,
            buildingId: building?.id ?? null,
            startDate: normalizeDate(h.startDate),
            adPrefix: parts ? `${parts.firstName[0] ?? ""}${parts.lastName}`.toLowerCase() : null,
            unresolved,
            possibleDuplicate: await this.findConfirmedDuplicate(h.fullName!),
          };
        }),
    );

    const devices = (raw.devices ?? [])
      .map((d) => ({
        type: normalizeDeviceType(d.type),
        model: d.model?.trim() || null,
        serialNumber: d.serialNumber?.trim() || null,
        assetTag: d.assetTag?.trim() || null,
        quantity: Math.max(1, Math.min(Number(d.quantity) || 1, 50)),
      }))
      .filter((d) => d.type !== "OTHER" || d.model || d.serialNumber || d.assetTag);

    const staff = await Promise.all(
      (raw.staff ?? [])
        .filter((s) => s.fullName?.trim())
        .map(async (s) => {
          const role = resolveRole(s.roleTitle);
          const building = resolveBuilding(s.buildingName);
          return {
            fullName: s.fullName!.trim(),
            roleTitle: s.roleTitle ?? null,
            roleId: role?.id ?? null,
            buildingName: s.buildingName ?? null,
            buildingId: building?.id ?? null,
            email: s.email?.trim() || null,
            phone: s.phone?.trim() || null,
            possibleDuplicate: await this.findConfirmedDuplicate(s.fullName!),
          };
        }),
    );

    return { kind: raw.kind ?? "UNKNOWN", source, summary: raw.summary ?? "", newHires, devices, staff };
  }
}

/** Lightweight name resolver: exact-normalized, then substring, then token overlap. */
function matchByName<T>(input: string | undefined, items: T[], getName: (t: T) => string): T | null {
  if (!input) return null;
  const q = normalize(input);
  if (!q) return null;
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const name = normalize(getName(item));
    let score = 0;
    if (name === q) score = 1;
    else if (q.includes(name) || name.includes(q)) score = 0.8;
    else {
      const qt = new Set(q.split(" "));
      const nt = name.split(" ");
      const overlap = nt.filter((t) => qt.has(t)).length;
      if (overlap > 0) score = (0.5 * overlap) / Math.max(qt.size, nt.length);
    }
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best && best.score >= 0.4 ? best.item : null;
}

function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic fallback for classify() when no LLM key is configured.
 * Splits on blank lines, classifies each paragraph, then merges adjacent
 * paragraphs that share a kind — so a normal multi-paragraph single-topic
 * email doesn't get shredded into fake segments, only genuine topic changes
 * produce a new one.
 */
export function heuristicClassify(rawText: string): IntakeSegment[] {
  const paragraphs = rawText
    .split(/\r?\n\s*\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = paragraphs.length > 0 ? paragraphs : [rawText.trim()];

  const merged: Array<{ text: string; kind: IntakeSegmentKind }> = [];
  for (const chunkText of chunks) {
    const detected = detectSegmentKind(chunkText);
    const last = merged[merged.length - 1];
    // A paragraph with no category signal of its own (UNKNOWN) is far more
    // likely a continuation of the topic just above it than a genuinely new
    // unrelated segment — inherit the previous kind rather than splitting.
    const kind = detected === "UNKNOWN" && last ? last.kind : detected;
    if (last && last.kind === kind) {
      last.text = `${last.text}\n\n${chunkText}`;
    } else {
      merged.push({ text: chunkText, kind });
    }
  }

  return merged
    .filter((m) => m.text.trim())
    .map((m) => ({
      text: m.text,
      kind: m.kind,
      summary: firstLineSummary(m.text),
      requesterNameGuess: null,
    }));
}

export function firstLineSummary(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/** Extended version of detectKind() with TICKET/INVOICE/TASK signals, used only by classify(). */
export function detectSegmentKind(text: string): IntakeSegmentKind {
  const low = text.toLowerCase();
  const count = (patterns: RegExp[]) => patterns.filter((re) => re.test(low)).length;

  const deviceHits = count([
    /serial|s\/n|asset tag|\bsku\b|\bqty\b|\bx\d|model/, ...TYPE_KEYWORDS.map(([k]) => new RegExp(k)),
  ]);
  const hireHits = count([/new hire|onboard|start date|starts?\b|joining|role|position|title/]);
  const ticketHits = count([
    /broken|not working|can'?t (?:log|connect|print|access)|won'?t (?:connect|turn on|print)|issue\b|problem\b|error\b|\bdown\b|locked out|stuck\b|help(?:ing)? with/,
  ]);
  const invoiceHits = count([/\$\s?\d|invoice|receipt|purchase order|\bpo\s?#|\btotal\b|subtotal|order\s?#/]);
  const taskHits = count([/\bto-?do\b|follow up|remind(?:er)?|need to|don'?t forget|order more|schedule\b/]);

  const scored: Array<[IntakeSegmentKind, number]> = [
    ["DEVICES", deviceHits >= 2 ? deviceHits : 0],
    ["INVOICE", invoiceHits],
    ["TICKET", ticketHits],
    ["NEW_HIRE", hireHits],
    ["TASK", taskHits],
  ];
  const best = scored.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : "UNKNOWN";
}
