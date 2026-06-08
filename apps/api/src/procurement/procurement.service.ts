import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import { DeviceStatus, DeviceType, InvoiceStatus, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types";
import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { AddLineItemsDto, CreatePurchaseDocDto } from "./dto";

interface ProposedLineItem {
  description: string;
  quantity: number;
  unitCost: number | null;
  serialNumbers: string[];
  mappedType: DeviceType | null;
}

interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? join(process.env.UPLOAD_DIR, "procurement")
  : join(process.cwd(), "uploads", "procurement");

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const DEVICE_TYPES: DeviceType[] = [
  "LAPTOP", "SURFACE", "PHONE", "TABLET", "HEADSET", "DOCK", "MONITOR",
  "MINI_PC", "USB_ADAPTER", "OTHER", "KEYBOARD", "MOUSE", "WEBCAM", "CABLE", "ADAPTER",
];
const TYPE_KEYWORDS: Array<[string, DeviceType]> = [
  ["macbook", "LAPTOP"], ["laptop", "LAPTOP"], ["latitude", "LAPTOP"], ["thinkpad", "LAPTOP"],
  ["elitebook", "LAPTOP"], ["notebook", "LAPTOP"], ["surface", "SURFACE"],
  ["iphone", "PHONE"], ["pixel", "PHONE"], ["phone", "PHONE"], ["ipad", "TABLET"], ["tablet", "TABLET"],
  ["keyboard", "KEYBOARD"], ["mx keys", "KEYBOARD"], ["mouse", "MOUSE"], ["webcam", "WEBCAM"],
  ["monitor", "MONITOR"], ["display", "MONITOR"], ["headset", "HEADSET"], ["jabra", "HEADSET"],
  ["dock", "DOCK"], ["mini pc", "MINI_PC"], ["optiplex", "MINI_PC"], ["cable", "CABLE"],
  ["adapter", "ADAPTER"], ["dongle", "ADAPTER"],
];

function mapType(raw: string | undefined): DeviceType | null {
  if (!raw) return null;
  const up = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((DEVICE_TYPES as string[]).includes(up)) return up as DeviceType;
  const low = raw.toLowerCase();
  for (const [kw, t] of TYPE_KEYWORDS) if (low.includes(kw)) return t;
  return null;
}

/**
 * Updates §6d — procurement ingestion. Phase 1 ships the MANUAL path: create a
 * purchase doc, enter line items (incl. serials), then "process" into inventory
 * — each item becomes a Device tagged to the destination site with purchase
 * provenance. AI extraction of line items/serials is the key-dependent
 * fast-follow (step 5); it would populate the same line-item review screen.
 */
@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Updates §6d step 5 — extract line items (incl. serials) from pasted invoice
   * text. LLM-first (strict JSON) when a key is configured; deterministic
   * heuristic fallback otherwise. Returns PROPOSALS only — the agent reviews and
   * confirms before they become line items (human-in-the-loop).
   */
  async extract(rawText: string): Promise<{ source: "ai" | "basic"; items: ProposedLineItem[] }> {
    if (this.llm.providerName !== "stub") {
      try {
        return { source: "ai", items: await this.llmExtract(rawText) };
      } catch (err) {
        this.logger.warn(`LLM invoice extraction failed, using heuristic: ${(err as Error).message}`);
      }
    }
    return { source: "basic", items: this.heuristicExtract(rawText) };
  }

  private async llmExtract(rawText: string): Promise<ProposedLineItem[]> {
    const system = [
      "You extract purchase line items from pasted invoice/quote/receipt text. Never invent data.",
      "For each item return: description, quantity (int), unitCost (number or null), serialNumbers (array of strings found), and type — one of: " + DEVICE_TYPES.join(", ") + " (map product names; null if unknown).",
      'Respond with ONLY JSON: {"items":[{"description":"","quantity":1,"unitCost":null,"serialNumbers":[],"type":""}]}',
    ].join("\n");
    const { text } = await this.llm.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: rawText },
      ],
      temperature: 0,
      maxTokens: 1200,
    });
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      items?: Array<{ description?: string; quantity?: number; unitCost?: number; serialNumbers?: string[]; type?: string }>;
    };
    return (parsed.items ?? [])
      .filter((i) => i.description?.trim())
      .map((i) => ({
        description: i.description!.trim(),
        quantity: Math.max(1, Number(i.quantity) || 1),
        unitCost: typeof i.unitCost === "number" ? i.unitCost : null,
        serialNumbers: Array.isArray(i.serialNumbers) ? i.serialNumbers.filter(Boolean) : [],
        mappedType: mapType(i.type),
      }));
  }

  private heuristicExtract(rawText: string): ProposedLineItem[] {
    const out: ProposedLineItem[] = [];
    for (const line of rawText.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || /^(subtotal|total|tax|shipping|order|invoice|date|vendor|qty\b.*price)/i.test(l)) continue;

      const type = mapType(l);
      const serialMatches = [...l.matchAll(/\b(?:s\/n|serial(?:\s*number)?|sn)[:#\s]+([A-Za-z0-9-]{4,})/gi)].map((m) => m[1]);
      const qtyM = l.match(/(?:^|\s)(?:qty[:\s]*(\d+)|(\d+)\s*x\b|x\s*(\d+)|\((\d+)\))/i);
      // Fall back to a bare leading quantity ("3 Logitech …"), capped to avoid model numbers.
      const leadM = !qtyM ? l.match(/^(\d{1,2})\s+(?=\D)/) : null;
      const quantity = qtyM ? Number(qtyM[1] ?? qtyM[2] ?? qtyM[3] ?? qtyM[4]) : leadM ? Number(leadM[1]) : 1;
      // first currency amount on the line = unit cost
      const costM = l.match(/\$\s*([\d,]+\.\d{2})/);
      const unitCost = costM ? Number(costM[1].replace(/,/g, "")) : null;

      if (!type && serialMatches.length === 0 && !costM) continue;

      let description = l
        .replace(/\b(?:s\/n|serial(?:\s*number)?|sn)[:#\s]+[A-Za-z0-9-]{4,}/gi, "")
        .replace(/\$\s*[\d,]+\.\d{2}/g, "")
        .replace(/(?:^|\s)(?:qty[:\s]*\d+|\d+\s*x|x\s*\d+|\(\d+\))/i, "");
      if (leadM) description = description.replace(/^\s*\d{1,2}\s+/, "");
      description = description.replace(/[•\-*]\s*/, "").replace(/\s{2,}/g, " ").trim();

      out.push({
        description: description || l,
        quantity: Number.isFinite(quantity) ? quantity : 1,
        unitCost,
        serialNumbers: serialMatches,
        mappedType: type,
      });
    }
    return out;
  }

  async list() {
    const docs = await this.prisma.purchaseDoc.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { lineItems: true } } },
    });
    const buildings = await this.prisma.building.findMany({ select: { id: true, name: true } });
    const names = new Map(buildings.map((b) => [b.id, b.name]));
    return docs.map((d) => ({
      id: d.id,
      vendor: d.vendor,
      docType: d.docType,
      docNumber: d.docNumber,
      purchaseDate: d.purchaseDate,
      destinationId: d.destinationId,
      destinationName: d.destinationId ? names.get(d.destinationId) ?? null : null,
      totalCost: d.totalCost,
      status: d.status,
      hasFile: Boolean(d.filePath),
      createdAt: d.createdAt,
      lineItemCount: d._count.lineItems,
    }));
  }

  async get(id: string) {
    const doc = await this.prisma.purchaseDoc.findUnique({
      where: { id },
      include: { lineItems: { orderBy: { id: "asc" } } },
    });
    if (!doc) throw new NotFoundException("Purchase doc not found");
    const building = doc.destinationId
      ? await this.prisma.building.findUnique({ where: { id: doc.destinationId } })
      : null;
    const { filePath, ...rest } = doc;
    return { ...rest, hasFile: Boolean(filePath), destinationName: building?.name ?? null };
  }

  async create(dto: CreatePurchaseDocDto, actor: AuthenticatedUser) {
    const doc = await this.prisma.purchaseDoc.create({
      data: {
        vendor: dto.vendor || "CDW",
        docType: dto.docType,
        docNumber: dto.docNumber,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
        destinationId: dto.destinationId || null,
        totalCost: dto.totalCost != null ? new Prisma.Decimal(dto.totalCost) : null,
        filePath: dto.filePath ?? "",
        uploadedById: actor.userId,
      },
    });
    await this.audit.record({
      action: "procurement.create",
      userId: actor.userId,
      entityType: "PurchaseDoc",
      entityId: doc.id,
      metadata: { vendor: doc.vendor, docType: doc.docType },
    });
    return this.get(doc.id);
  }

  async addLineItems(id: string, dto: AddLineItemsDto, actor: AuthenticatedUser) {
    await this.get(id);
    for (const li of dto.lineItems) {
      await this.prisma.invoiceLineItem.create({
        data: {
          purchaseDocId: id,
          description: li.description,
          quantity: li.quantity ?? 1,
          unitCost: li.unitCost != null ? new Prisma.Decimal(li.unitCost) : null,
          serialNumbers: li.serialNumbers ?? [],
          mappedType: li.mappedType ?? null,
        },
      });
    }
    await this.prisma.purchaseDoc.update({
      where: { id },
      data: { status: InvoiceStatus.REVIEWED },
    });
    await this.audit.record({
      action: "procurement.lineitems.add",
      userId: actor.userId,
      entityType: "PurchaseDoc",
      entityId: id,
      metadata: { added: dto.lineItems.length },
    });
    return this.get(id);
  }

  /** Turn reviewed line items into real Device records tagged to the site. */
  async process(id: string, actor: AuthenticatedUser) {
    const doc = await this.get(id);
    const pending = doc.lineItems.filter((li) => !li.reviewed);
    if (pending.length === 0) throw new BadRequestException("Nothing left to process");

    let devicesCreated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const li of pending) {
        const qty = Math.max(1, li.quantity);
        const type = (li.mappedType ?? DeviceType.OTHER) as DeviceType;
        const createdIds: string[] = [];
        for (let i = 0; i < qty; i++) {
          const serialNumber = li.serialNumbers[i] || null;
          const dev = await tx.device.create({
            data: {
              type,
              model: li.description,
              serialNumber,
              status: DeviceStatus.IN_STOCK,
              locationId: doc.destinationId ?? null,
              purchaseCost: li.unitCost,
              purchaseDate: doc.purchaseDate,
              purchaseLocationId: doc.destinationId ?? null,
              invoiceLineItemId: li.id,
            },
          });
          createdIds.push(dev.id);
          devicesCreated++;
        }
        await tx.invoiceLineItem.update({
          where: { id: li.id },
          data: { reviewed: true, createdDeviceIds: createdIds },
        });
      }
      await tx.purchaseDoc.update({ where: { id }, data: { status: InvoiceStatus.PROCESSED } });
    });

    await this.audit.record({
      action: "procurement.process",
      userId: actor.userId,
      entityType: "PurchaseDoc",
      entityId: id,
      metadata: { devicesCreated },
    });

    return { ...(await this.get(id)), devicesCreated };
  }

  /** Store the original quote/receipt/invoice file alongside the record. */
  async attachFile(id: string, file: UploadedFileLike, actor: AuthenticatedUser) {
    await this.get(id);
    if (!file?.buffer?.length) throw new BadRequestException("No file uploaded");

    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_").slice(-80);
    const filename = `${id}-${safe}`;
    const fullPath = join(UPLOAD_DIR, filename);
    writeFileSync(fullPath, file.buffer);

    await this.prisma.purchaseDoc.update({ where: { id }, data: { filePath: fullPath } });
    await this.audit.record({
      action: "procurement.file.attach",
      userId: actor.userId,
      entityType: "PurchaseDoc",
      entityId: id,
      metadata: { name: safe, size: file.size },
    });
    return this.get(id);
  }

  /** Resolve a stored file for streaming back to the browser. */
  async getFileMeta(id: string) {
    const doc = await this.prisma.purchaseDoc.findUnique({ where: { id }, select: { filePath: true } });
    if (!doc?.filePath || !existsSync(doc.filePath)) throw new NotFoundException("No file attached");
    const name = basename(doc.filePath);
    const ext = extname(doc.filePath).toLowerCase();
    return {
      stream: createReadStream(doc.filePath),
      name,
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    };
  }
}
