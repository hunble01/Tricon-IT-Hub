import { Injectable, Logger } from "@nestjs/common";
import { Building, DeviceType, Role } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { DevicesService } from "../devices/devices.service";
import { LlmService } from "../llm/llm.service";
import { OnboardingService } from "../onboarding/onboarding.service";
import { PrismaService } from "../prisma/prisma.service";
import { splitName, normalize } from "../staff/name";
import { StaffService } from "../staff/staff.service";
import { AnalyzeIntakeDto, CommitIntakeDto, IntakeHint } from "./dto";

type IntakeKind = "NEW_HIRE" | "DEVICES" | "STAFF" | "UNKNOWN";

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
    private readonly audit: AuditService,
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

  async commit(dto: CommitIntakeDto, actor: AuthenticatedUser) {
    const created = { onboardings: 0, staff: 0, devices: 0 };

    for (const h of dto.newHires ?? []) {
      await this.onboarding.start(
        { fullName: h.fullName, roleId: h.roleId, buildingId: h.buildingId, startDate: h.startDate },
        actor,
      );
      created.onboardings++;
    }

    for (const s of dto.staff ?? []) {
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
    }

    for (const d of dto.devices ?? []) {
      const qty = Math.max(1, Math.min(d.quantity ?? 1, 50));
      const type = normalizeDeviceType(d.type);
      for (let i = 0; i < qty; i++) {
        const assetTag = d.assetTag ? (qty > 1 ? `${d.assetTag}-${i + 1}` : d.assetTag) : undefined;
        // Only carry an individual serial when a single unit is created.
        const serialNumber = qty === 1 ? d.serialNumber || undefined : undefined;
        await this.devices.create(
          { type, model: d.model || undefined, serialNumber, assetTag, locationId: d.locationId || undefined },
          actor,
        );
        created.devices++;
      }
    }

    await this.audit.record({
      action: "intake.commit",
      userId: actor.userId,
      entityType: "Intake",
      metadata: created,
    });

    return created;
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

    const user = [
      hint !== "AUTO" ? `The user says this is: ${hint}.` : "",
      `Known roles: ${roles.map((r) => r.title).join(", ")}`,
      `Known buildings: ${buildings.map((b) => b.name).join(", ")}`,
      "",
      "TEXT:",
      rawText,
    ].join("\n");

    const { text } = await this.llm.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      maxTokens: 1200,
    });
    const parsed = extractJson(text) as RawExtraction;
    if (!parsed.kind) parsed.kind = "UNKNOWN";
    return parsed;
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

  private resolve(
    raw: RawExtraction,
    roles: Role[],
    buildings: Building[],
    source: "ai" | "basic",
  ): AnalyzeResult {
    const resolveRole = (name?: string) => matchByName(name, roles, (r) => r.title);
    const resolveBuilding = (name?: string) => matchByName(name, buildings, (b) => b.name);

    return {
      kind: raw.kind ?? "UNKNOWN",
      source,
      summary: raw.summary ?? "",
      newHires: (raw.newHires ?? [])
        .filter((h) => h.fullName?.trim())
        .map((h) => {
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
          };
        }),
      devices: (raw.devices ?? [])
        .map((d) => ({
          type: normalizeDeviceType(d.type),
          model: d.model?.trim() || null,
          serialNumber: d.serialNumber?.trim() || null,
          assetTag: d.assetTag?.trim() || null,
          quantity: Math.max(1, Math.min(Number(d.quantity) || 1, 50)),
        }))
        .filter((d) => d.type !== "OTHER" || d.model || d.serialNumber || d.assetTag),
      staff: (raw.staff ?? [])
        .filter((s) => s.fullName?.trim())
        .map((s) => {
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
          };
        }),
    };
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
