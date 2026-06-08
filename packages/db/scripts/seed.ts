/**
 * Seed reference data from Part 4 of the spec:
 *   - 10 Buildings
 *   - 11 Roles with role→device matrix
 *   - 13 KnowledgeArticle stubs
 *   - 1 ADMIN User (from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env)
 *
 * Idempotent — safe to re-run. Uses upsert keyed on natural unique fields
 * (Building.name, Role.title, KnowledgeArticle.title, User.email).
 */

import bcrypt from "bcryptjs";
import { DeviceType, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ────────────────────────────────────────────────────────────
// Buildings (Part 4 table)
// ────────────────────────────────────────────────────────────

const buildings: Array<{
  name: string;
  displayName?: string;
  neighborhood?: string;
  status: "LIVE" | "OPENING" | "COMING_SOON" | "CORPORATE";
}> = [
  { name: "Cherry House", displayName: "Cherry House at Canary Landing", neighborhood: "Canary District", status: "LIVE" },
  { name: "Maple House", displayName: "Maple House at Canary Landing", neighborhood: "Canary District", status: "LIVE" },
  { name: "Birch House", displayName: "Birch House at Canary Landing", neighborhood: "Canary District", status: "LIVE" },
  { name: "The Spoke", displayName: "The Spoke", neighborhood: "The Junction", status: "LIVE" },
  { name: "The Ivy", displayName: "The Ivy", neighborhood: "Yonge & Bloor", status: "LIVE" },
  { name: "The Taylor", displayName: "The Taylor", neighborhood: "Fashion/Entertainment District", status: "LIVE" },
  { name: "The Selby", displayName: "The Selby", neighborhood: "Bloor Street East", status: "LIVE" },
  { name: "The James", displayName: "The James", neighborhood: "Rosedale", status: "LIVE" },
  { name: "ROQ City", displayName: "ROQ City", neighborhood: "Garden District/Corktown", status: "OPENING" },
  { name: "Corporate", displayName: "Corporate (TLR / HQ)", status: "CORPORATE" },
];

// ────────────────────────────────────────────────────────────
// Roles + role→device matrix (Part 4 table)
// ────────────────────────────────────────────────────────────

type RoleSeed = {
  title: string;
  category: "BUILDING_STAFF" | "MANAGER" | "CORPORATE";
  isSharedDevice: boolean;
  devices: Array<{ type: DeviceType; quantity?: number }>;
};

const roles: RoleSeed[] = [
  { title: "Maintenance Technician",            category: "BUILDING_STAFF", isSharedDevice: false, devices: [{ type: DeviceType.PHONE }] },
  { title: "Maintenance Manager",               category: "MANAGER",        isSharedDevice: false, devices: [{ type: DeviceType.PHONE }, { type: DeviceType.LAPTOP }, { type: DeviceType.HEADSET }] },
  { title: "Concierge",                         category: "BUILDING_STAFF", isSharedDevice: true,  devices: [] },
  { title: "Property Manager",                  category: "MANAGER",        isSharedDevice: false, devices: [{ type: DeviceType.PHONE }, { type: DeviceType.LAPTOP }, { type: DeviceType.HEADSET }] },
  { title: "Property Administrator",            category: "BUILDING_STAFF", isSharedDevice: false, devices: [{ type: DeviceType.LAPTOP }, { type: DeviceType.HEADSET }] },
  { title: "Leasing Consultant",                category: "BUILDING_STAFF", isSharedDevice: false, devices: [{ type: DeviceType.PHONE }, { type: DeviceType.SURFACE }, { type: DeviceType.HEADSET }] },
  { title: "Director, Operations",              category: "MANAGER",        isSharedDevice: false, devices: [{ type: DeviceType.PHONE }, { type: DeviceType.LAPTOP }, { type: DeviceType.HEADSET }] },
  { title: "General Manager, CPM",              category: "CORPORATE",      isSharedDevice: false, devices: [{ type: DeviceType.LAPTOP }, { type: DeviceType.HEADSET }] },
  { title: "Resident Experience Manager",       category: "MANAGER",        isSharedDevice: false, devices: [{ type: DeviceType.PHONE }, { type: DeviceType.LAPTOP }, { type: DeviceType.HEADSET }] },
  { title: "Dockmaster (Receiving Coordinator)", category: "BUILDING_STAFF", isSharedDevice: false, devices: [{ type: DeviceType.PHONE }, { type: DeviceType.TABLET }, { type: DeviceType.HEADSET }] },
  { title: "Lease Administrator",               category: "CORPORATE",      isSharedDevice: false, devices: [{ type: DeviceType.LAPTOP }, { type: DeviceType.HEADSET }] },
];

// ────────────────────────────────────────────────────────────
// KnowledgeArticle stubs (Part 4 — Phase 1 just seeds key facts;
// full ingestion is Phase 3)
// ────────────────────────────────────────────────────────────

const knowledgeArticles: Array<{
  title: string;
  content: string;
  source?: string;
  tags: string[];
}> = [
  {
    title: "Contacting IT",
    content:
      "Reach IT via the support portal, email helpdesk@triconhomes.com, or call (833) 700-2454. Support hours are 9 a.m.–9 p.m. ET.",
    source: "Orientation deck",
    tags: ["it-support", "contact"],
  },
  {
    title: "Intranet",
    content:
      "Tricon One intranet is at triconone.sharepoint.com. Use it for benefits, expenses, jobs, and events.",
    source: "Orientation deck",
    tags: ["intranet", "sharepoint"],
  },
  {
    title: "Hardware policy",
    content:
      "Staff are responsible for issued gear and must return it in working order. Third-party support is limited. USB drives are prohibited. No personal data on company devices.",
    source: "Orientation deck",
    tags: ["hardware", "policy", "security"],
  },
  {
    title: "Company apps",
    content:
      "Install company apps via the Company Portal. Click Sync under Settings to pull updates.",
    source: "Orientation deck",
    tags: ["apps", "company-portal"],
  },
  {
    title: "App requests",
    content:
      "Submit a ticket with business justification per the IT Procurement Policy to request a new app.",
    source: "Orientation deck",
    tags: ["apps", "procurement"],
  },
  {
    title: "Conference rooms",
    content:
      "Meeting rooms support Teams and Zoom. A Zoom license is required for meetings longer than 40 minutes.",
    source: "Orientation deck",
    tags: ["meetings", "teams", "zoom"],
  },
  {
    title: "External calls",
    content:
      "Teams phone numbers are issued for corporate and Canadian MFR staff. Use Teams to place external calls.",
    source: "Orientation deck",
    tags: ["teams", "phone"],
  },
  {
    title: "Printing — uniFLOW",
    content:
      "Tricon uses uniFLOW cloud print. Set uniFLOW as the default printer. Secure print and scanning require a uniFLOW PIN. Management console: https://tricon-residential.us.uniflowonline.com/",
    source: "Orientation deck",
    tags: ["printing", "uniflow"],
  },
  {
    title: "Password policy",
    content:
      "Passwords: minimum 10 characters with upper, lower, number, and special characters; no personal info; never written or shared; expires every 180 days. Change via Ctrl+Alt+Del → Change a password.",
    source: "Orientation deck",
    tags: ["security", "password"],
  },
  {
    title: "MFA",
    content:
      "Set up at least 2 MFA methods at mysignins.microsoft.com/security-info. Options: Microsoft Authenticator, phone, or email.",
    source: "Orientation deck",
    tags: ["security", "mfa"],
  },
  {
    title: "SSO / O365",
    content:
      "Sign in with your Tricon email at office.com or in local apps. Use Outlook for mail — not the native Mail app.",
    source: "Orientation deck",
    tags: ["sso", "o365", "outlook"],
  },
  {
    title: "Backup — OneDrive",
    content:
      "OneDrive backs up Documents, Pictures, and Desktop folders. Use OneDrive for file sharing.",
    source: "Orientation deck",
    tags: ["onedrive", "backup"],
  },
  {
    title: "Security — KnowBe4",
    content:
      "Report suspicious emails via the KnowBe4 Phish Alert button → Process Report. Do not click links in suspicious mail.",
    source: "Orientation deck",
    tags: ["security", "phishing", "knowbe4"],
  },
];

// ────────────────────────────────────────────────────────────
// Seed driver
// ────────────────────────────────────────────────────────────

async function seedBuildings(): Promise<number> {
  for (const b of buildings) {
    await prisma.building.upsert({
      where: { name: b.name },
      update: { displayName: b.displayName, neighborhood: b.neighborhood, status: b.status },
      create: b,
    });
  }
  return buildings.length;
}

async function seedRoles(): Promise<number> {
  for (const r of roles) {
    const role = await prisma.role.upsert({
      where: { title: r.title },
      update: { category: r.category, isSharedDevice: r.isSharedDevice },
      create: { title: r.title, category: r.category, isSharedDevice: r.isSharedDevice },
    });
    // Reset and re-seed device profile for this role (idempotent).
    await prisma.roleDeviceProfile.deleteMany({ where: { roleId: role.id } });
    for (const d of r.devices) {
      await prisma.roleDeviceProfile.create({
        data: { roleId: role.id, deviceType: d.type, quantity: d.quantity ?? 1 },
      });
    }
  }
  return roles.length;
}

async function seedKnowledgeArticles(): Promise<number> {
  for (const a of knowledgeArticles) {
    // KnowledgeArticle has no @unique on title; emulate idempotency via findFirst.
    const existing = await prisma.knowledgeArticle.findFirst({ where: { title: a.title } });
    if (existing) {
      await prisma.knowledgeArticle.update({
        where: { id: existing.id },
        data: { content: a.content, source: a.source, tags: a.tags },
      });
    } else {
      await prisma.knowledgeArticle.create({ data: a });
    }
  }
  return knowledgeArticles.length;
}

async function seedAdminUser(): Promise<boolean> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";
  if (!email || !password) {
    console.warn(
      "[seed] SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD not set — skipping admin user creation.",
    );
    return false;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: { name, role: "ADMIN" },
    create: { email, name, passwordHash, role: "ADMIN" },
  });
  return true;
}

async function main(): Promise<void> {
  console.log("[seed] starting");
  const buildingsCount = await seedBuildings();
  console.log(`[seed] buildings: ${buildingsCount}`);
  const rolesCount = await seedRoles();
  console.log(`[seed] roles: ${rolesCount}`);
  const kbCount = await seedKnowledgeArticles();
  console.log(`[seed] knowledge articles: ${kbCount}`);
  const adminCreated = await seedAdminUser();
  console.log(`[seed] admin user: ${adminCreated ? "ok" : "skipped"}`);
  console.log("[seed] done");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export {};
