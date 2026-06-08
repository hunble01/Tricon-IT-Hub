/**
 * Import historical staff + onboarding records from an Excel workbook.
 *
 * Source: seed/onboarding.xlsx (or seed/MFR Onboarding Info and Setup.xlsx
 * as a fallback). One sheet per month, sheet name (e.g. "Nov. 2025") becomes
 * the Onboarding.monthLabel.
 *
 * Columns (per Part 4 of the spec):
 *   Name, Start Date, Title, Office Location, Stock Source,
 *   AD Account Prefix, Onboarding Tickets Solved?, Device(s) to Assign,
 *   Device(s) Set Up?, Notes
 *
 * Behaviour:
 *   - Upserts Staff by (firstName + lastName + buildingId) — names alone aren't
 *     guaranteed unique across the whole company, but within a building they
 *     effectively are. New staff get source = ONBOARDING.
 *   - Upserts the Onboarding row by its (unique) staffId.
 *   - Detects "No longer joining Tricon" in Notes → employmentStatus = NO_SHOW.
 *   - Handles Excel serial date numbers AND human strings like "Nov. 17".
 *   - Trims trailing whitespace from building / title cells.
 *   - Logs warnings (does not throw) for unknown roles, buildings, or devices.
 *
 * Idempotent — safe to re-run after edits to the workbook.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DeviceType,
  EmploymentStatus,
  OnboardingDeviceStatus,
  PrismaClient,
  StaffSource,
} from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

// ────────────────────────────────────────────────────────────
// Locate the workbook
// ────────────────────────────────────────────────────────────

function locateWorkbook(): string {
  const candidates = [
    process.env.ONBOARDING_XLSX,
    path.resolve(process.cwd(), "../../seed/onboarding.xlsx"),
    path.resolve(process.cwd(), "../../seed/MFR Onboarding Info and Setup.xlsx"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `No onboarding workbook found. Looked in: ${candidates.join(", ")}. ` +
      `Set ONBOARDING_XLSX or drop the file at seed/onboarding.xlsx.`,
  );
}

// ────────────────────────────────────────────────────────────
// Parsing helpers
// ────────────────────────────────────────────────────────────

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

/** Split "Jason Harrison" → { firstName: "Jason", lastName: "Harrison", fullName: "Jason Harrison" } */
function splitName(raw: string): { firstName: string; lastName: string; fullName: string } | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "", fullName: parts[0]! };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
    fullName: parts.join(" "),
  };
}

/** Year inferred from sheet name like "Nov. 2025" → 2025. */
function yearFromSheetName(sheetName: string): number | null {
  const m = sheetName.match(/(\d{4})/);
  return m && m[1] ? Number(m[1]) : null;
}

/** Convert a value from the Start Date cell into a JS Date (best-effort). */
function parseStartDate(value: unknown, sheetName: string): Date | null {
  if (value == null || value === "") return null;
  // Excel serial number (e.g. 46153)
  if (typeof value === "number") {
    const epoch = Date.UTC(1899, 11, 30); // Excel's day 0
    return new Date(epoch + value * 86400 * 1000);
  }
  // Already a Date
  if (value instanceof Date) return value;
  // String like "Nov. 17" — combine with year from sheet name
  const s = String(value).trim();
  const year = yearFromSheetName(sheetName);
  if (year) {
    const parsed = new Date(`${s.replace(/\.$/, "")} ${year}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const direct = new Date(s);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

const DEVICE_LOOKUP: Record<string, DeviceType> = {
  laptop: DeviceType.LAPTOP,
  surface: DeviceType.SURFACE,
  phone: DeviceType.PHONE,
  tablet: DeviceType.TABLET,
  headset: DeviceType.HEADSET,
  dock: DeviceType.DOCK,
  monitor: DeviceType.MONITOR,
  "mini-pc": DeviceType.MINI_PC,
  "mini pc": DeviceType.MINI_PC,
  minipc: DeviceType.MINI_PC,
  "usb adapter": DeviceType.USB_ADAPTER,
  adapter: DeviceType.USB_ADAPTER,
};

function parseDevices(raw: string): DeviceType[] {
  if (!raw) return [];
  return raw
    .split(/[,;/]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => DEVICE_LOOKUP[s])
    .filter((t): t is DeviceType => !!t);
}

function parseDeviceStatus(raw: string): OnboardingDeviceStatus {
  const s = raw.toLowerCase();
  if (s.includes("already")) return OnboardingDeviceStatus.ALREADY_SET_UP;
  if (s === "yes" || s.includes("done") || s.includes("set up") || s.includes("complete")) {
    return OnboardingDeviceStatus.DONE;
  }
  return OnboardingDeviceStatus.PENDING;
}

function parseChecklist(raw: string): {
  ad: boolean;
  badge: boolean;
  hardware: boolean;
  software: boolean;
} {
  const tokens = raw
    .toLowerCase()
    .split(/[,;/]/)
    .map((s) => s.trim());
  return {
    ad: tokens.some((t) => t.startsWith("ad")),
    badge: tokens.includes("badge"),
    hardware: tokens.includes("hardware"),
    software: tokens.includes("software"),
  };
}

function looksLikeNoShow(notes: string): boolean {
  const s = notes.toLowerCase();
  return s.includes("no longer joining") || s.includes("no-show") || s.includes("no show");
}

// ────────────────────────────────────────────────────────────
// Reference data lookups (cached)
// ────────────────────────────────────────────────────────────

/**
 * Aliases for sheet values that don't match the canonical seed names.
 * Keys are lowercased; values are the canonical name (also lowercased).
 */
const BUILDING_ALIASES: Record<string, string> = {
  "corporate (tlr)": "corporate",
  "corporate (tlr / hq)": "corporate",
  "tlr": "corporate",
  "hq": "corporate",
};

const ROLE_ALIASES: Record<string, string> = {
  "lease administrator, retail and commercial": "lease administrator",
};

async function loadLookups(): Promise<{
  buildingsByName: Map<string, string>;
  rolesByTitle: Map<string, string>;
}> {
  const [buildings, roles] = await Promise.all([
    prisma.building.findMany({ select: { id: true, name: true } }),
    prisma.role.findMany({ select: { id: true, title: true } }),
  ]);
  const buildingsByName = new Map(buildings.map((b) => [b.name.toLowerCase(), b.id]));
  const rolesByTitle = new Map(roles.map((r) => [r.title.toLowerCase(), r.id]));
  // Layer aliases on top so they resolve to the canonical id.
  for (const [alias, canonical] of Object.entries(BUILDING_ALIASES)) {
    const id = buildingsByName.get(canonical);
    if (id) buildingsByName.set(alias, id);
  }
  for (const [alias, canonical] of Object.entries(ROLE_ALIASES)) {
    const id = rolesByTitle.get(canonical);
    if (id) rolesByTitle.set(alias, id);
  }
  return { buildingsByName, rolesByTitle };
}

function resolveBuildingId(
  raw: string,
  lookup: Map<string, string>,
  warnings: string[],
): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  const id = lookup.get(key);
  if (!id) warnings.push(`unknown building: "${raw}"`);
  return id ?? null;
}

function resolveRoleId(
  raw: string,
  lookup: Map<string, string>,
  warnings: string[],
): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  const id = lookup.get(key);
  if (!id) warnings.push(`unknown role: "${raw}"`);
  return id ?? null;
}

// ────────────────────────────────────────────────────────────
// Row processor
// ────────────────────────────────────────────────────────────

type SheetRow = Record<string, unknown>;

interface ImportStats {
  sheets: number;
  rows: number;
  staffCreated: number;
  staffUpdated: number;
  onboardingsUpserted: number;
  skipped: number;
  warnings: string[];
}

async function importRow(
  row: SheetRow,
  sheetName: string,
  lookups: Awaited<ReturnType<typeof loadLookups>>,
  stats: ImportStats,
): Promise<void> {
  const rawName = norm(row["Name"]);
  if (!rawName) {
    stats.skipped++;
    return;
  }
  const nameParts = splitName(rawName);
  if (!nameParts) {
    stats.skipped++;
    return;
  }

  const buildingId = resolveBuildingId(
    norm(row["Office Location"]),
    lookups.buildingsByName,
    stats.warnings,
  );
  const stockSourceId = resolveBuildingId(
    norm(row["Stock Source"]),
    lookups.buildingsByName,
    stats.warnings,
  );
  const roleId = resolveRoleId(norm(row["Title"]), lookups.rolesByTitle, stats.warnings);

  const startDate = parseStartDate(row["Start Date"], sheetName);
  const adPrefix = norm(row["AD Account Prefix"]) || null;
  const notes = norm(row["Notes"]) || null;
  const employmentStatus = notes && looksLikeNoShow(notes)
    ? EmploymentStatus.NO_SHOW
    : EmploymentStatus.ONBOARDING;

  // Find existing staff by name+building (best heuristic without an external ID).
  const existing = buildingId
    ? await prisma.staff.findFirst({
        where: {
          fullName: nameParts.fullName,
          buildingId,
        },
      })
    : await prisma.staff.findFirst({
        where: { fullName: nameParts.fullName, buildingId: null },
      });

  const staffData = {
    fullName: nameParts.fullName,
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    adPrefix,
    roleId,
    buildingId,
    startDate,
    employmentStatus,
    notes,
    source: StaffSource.ONBOARDING,
  };

  const staff = existing
    ? await prisma.staff.update({ where: { id: existing.id }, data: staffData })
    : await prisma.staff.create({ data: staffData });

  if (existing) stats.staffUpdated++;
  else stats.staffCreated++;

  const recommendedDevices = parseDevices(norm(row["Device(s) to Assign"]));
  const checklist = parseChecklist(norm(row["Onboarding Tickets Solved?"]));
  const deviceStatus = parseDeviceStatus(norm(row["Device(s) Set Up?"]));

  await prisma.onboarding.upsert({
    where: { staffId: staff.id },
    update: {
      stockSourceId,
      startDate,
      adDone: checklist.ad,
      badgeDone: checklist.badge,
      hardwareDone: checklist.hardware,
      softwareDone: checklist.software,
      recommendedDevices,
      deviceStatus,
      monthLabel: sheetName,
      notes,
    },
    create: {
      staffId: staff.id,
      stockSourceId,
      startDate,
      adDone: checklist.ad,
      badgeDone: checklist.badge,
      hardwareDone: checklist.hardware,
      softwareDone: checklist.software,
      recommendedDevices,
      deviceStatus,
      monthLabel: sheetName,
      notes,
    },
  });
  stats.onboardingsUpserted++;
}

// ────────────────────────────────────────────────────────────
// Driver
// ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const file = locateWorkbook();
  console.log(`[import-onboarding] reading ${file}`);
  const wb = XLSX.read(fs.readFileSync(file));
  const lookups = await loadLookups();

  const stats: ImportStats = {
    sheets: 0,
    rows: 0,
    staffCreated: 0,
    staffUpdated: 0,
    onboardingsUpserted: 0,
    skipped: 0,
    warnings: [],
  };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: null });
    stats.sheets++;
    stats.rows += rows.length;
    for (const row of rows) {
      try {
        await importRow(row, sheetName, lookups, stats);
      } catch (err) {
        stats.warnings.push(
          `row error in "${sheetName}" for "${norm(row["Name"])}": ${(err as Error).message}`,
        );
      }
    }
    console.log(`[import-onboarding] ${sheetName}: ${rows.length} rows processed`);
  }

  // De-dupe warnings before printing.
  const uniqueWarnings = Array.from(new Set(stats.warnings));

  console.log("\n[import-onboarding] summary");
  console.log(`  sheets:                ${stats.sheets}`);
  console.log(`  rows seen:             ${stats.rows}`);
  console.log(`  staff created:         ${stats.staffCreated}`);
  console.log(`  staff updated:         ${stats.staffUpdated}`);
  console.log(`  onboardings upserted:  ${stats.onboardingsUpserted}`);
  console.log(`  rows skipped:          ${stats.skipped}`);
  if (uniqueWarnings.length > 0) {
    console.log(`\n[import-onboarding] ${uniqueWarnings.length} warnings:`);
    for (const w of uniqueWarnings) console.log(`  - ${w}`);
  }
}

main()
  .catch((err) => {
    console.error("[import-onboarding] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export {};
