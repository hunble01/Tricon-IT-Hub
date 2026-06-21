/**
 * Demo data for showcases — layered on top of the base seed (run `pnpm db:seed`
 * first; this needs the buildings + roles to exist). Creates believable named
 * staff, devices with real custody history, tickets (some resolved, which seed
 * recall memory), tasks across the board, onboardings, and one departed-staff-
 * still-holding-a-laptop case so the dashboard "needs attention" strip lights up.
 *
 * Idempotent — guarded by natural keys (device.assetTag, ticket externalId,
 * task.sourceKey, staff fullName) so re-running won't duplicate.
 */

import { DeviceType, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

async function buildingId(name: string) {
  const b = await prisma.building.findUnique({ where: { name } });
  if (!b) throw new Error(`building ${name} missing — run the base seed first`);
  return b.id;
}
async function roleId(title: string) {
  const r = await prisma.role.findUnique({ where: { title } });
  if (!r) throw new Error(`role ${title} missing — run the base seed first`);
  return r.id;
}

async function ensureStaff(p: {
  fullName: string;
  role: string;
  building: string;
  status?: "ACTIVE" | "ONBOARDING" | "DEPARTED";
  startOffsetDays?: number;
}) {
  const existing = await prisma.staff.findFirst({ where: { fullName: p.fullName } });
  if (existing) return existing;
  const [firstName, ...rest] = p.fullName.split(" ");
  const lastName = rest.join(" ") || firstName;
  return prisma.staff.create({
    data: {
      fullName: p.fullName,
      firstName,
      lastName,
      adPrefix: `${firstName[0]}${lastName}`.toLowerCase().replace(/[^a-z]/g, ""),
      roleId: await roleId(p.role),
      buildingId: await buildingId(p.building),
      employmentStatus: p.status ?? "ACTIVE",
      startDate: daysFromNow(p.startOffsetDays ?? -120),
      email: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "") + "@triconresidential.com",
      source: "MANUAL",
    },
  });
}

async function ensureDevice(p: {
  assetTag: string;
  type: DeviceType;
  model: string;
  cost: number;
  purchasedDaysAgo: number;
  location: string;
}) {
  return prisma.device.upsert({
    where: { assetTag: p.assetTag },
    update: {},
    create: {
      assetTag: p.assetTag,
      serialNumber: `SN-${p.assetTag}`,
      type: p.type,
      model: p.model,
      status: "IN_STOCK",
      locationId: await buildingId(p.location),
      purchaseCost: p.cost,
      purchaseDate: daysFromNow(-p.purchasedDaysAgo),
    },
  });
}

async function assign(deviceId: string, staffId: string, sinceDays: number, returnedDaysAgo?: number) {
  const open = await prisma.deviceAssignment.findFirst({ where: { deviceId, returnedAt: null } });
  if (open) return;
  await prisma.deviceAssignment.create({
    data: {
      deviceId,
      staffId,
      assignedAt: daysFromNow(-sinceDays),
      returnedAt: returnedDaysAgo != null ? daysFromNow(-returnedDaysAgo) : null,
    },
  });
  if (returnedDaysAgo == null) {
    await prisma.device.update({ where: { id: deviceId }, data: { status: "ASSIGNED" } });
  }
}

async function ensureTicket(p: {
  externalId: string;
  subject: string;
  body: string;
  status: "OPEN" | "PENDING" | "RESOLVED";
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  slaOffsetDays?: number;
  resolution?: string;
}) {
  const ticket = await prisma.ticket.upsert({
    where: { source_externalId: { source: "MANUAL", externalId: p.externalId } },
    update: {},
    create: {
      source: "MANUAL",
      externalId: p.externalId,
      subject: p.subject,
      body: p.body,
      status: p.status,
      priority: p.priority ?? "NORMAL",
      slaDueAt: p.slaOffsetDays != null ? daysFromNow(p.slaOffsetDays) : null,
    },
  });
  // Resolved tickets seed recall memory (no embedding here — trgm recall covers it;
  // the live API can re-embed via memory.reembedAll for vector search).
  if (p.resolution) {
    const content = `Issue: ${p.subject}\nResolution: ${p.resolution}`;
    const existing = await prisma.memoryEntry.findFirst({ where: { refTable: "Ticket", refId: ticket.id } });
    if (!existing) {
      await prisma.memoryEntry.create({
        data: { type: "TICKET_RESOLUTION", refTable: "Ticket", refId: ticket.id, content },
      });
    }
  }
  return ticket;
}

async function ensureTask(p: {
  key: string;
  title: string;
  type: string;
  status?: string;
  priority?: string;
  dueOffsetDays?: number;
  staffId?: string;
  buildingId?: string;
}) {
  await prisma.task.upsert({
    where: { sourceKey: p.key },
    update: {},
    create: {
      sourceKey: p.key,
      source: "MANUAL",
      title: p.title,
      type: p.type as never,
      status: (p.status ?? "TODO") as never,
      priority: (p.priority ?? "NORMAL") as never,
      dueDate: p.dueOffsetDays != null ? daysFromNow(p.dueOffsetDays) : null,
      staffId: p.staffId,
      buildingId: p.buildingId,
      completedAt: p.status === "DONE" ? daysFromNow(-1) : null,
    },
  });
}

async function main() {
  console.log("[demo] starting");

  // ---- staff ----
  const staff = {
    amelia: await ensureStaff({ fullName: "Amelia Chen", role: "Property Manager", building: "The Taylor" }),
    marcus: await ensureStaff({ fullName: "Marcus Bell", role: "Leasing Consultant", building: "The Ivy" }),
    priya: await ensureStaff({ fullName: "Priya Nair", role: "Resident Experience Manager", building: "The Selby" }),
    diego: await ensureStaff({ fullName: "Diego Santos", role: "Maintenance Technician", building: "Cherry House" }),
    hannah: await ensureStaff({ fullName: "Hannah Wright", role: "Property Administrator", building: "The James" }),
    omar: await ensureStaff({ fullName: "Omar Haddad", role: "Maintenance Manager", building: "Maple House" }),
    sofia: await ensureStaff({ fullName: "Sofia Russo", role: "Director, Operations", building: "Corporate" }),
    liam: await ensureStaff({ fullName: "Liam O'Brien", role: "Leasing Consultant", building: "The Spoke" }),
    // onboarding
    ava: await ensureStaff({ fullName: "Ava Thompson", role: "Property Administrator", building: "Birch House", status: "ONBOARDING", startOffsetDays: 5 }),
    noah: await ensureStaff({ fullName: "Noah Kim", role: "Leasing Consultant", building: "The Taylor", status: "ONBOARDING", startOffsetDays: 9 }),
    // departed — still holding a laptop (attention item)
    grace: await ensureStaff({ fullName: "Grace Miller", role: "Leasing Consultant", building: "The Ivy", status: "DEPARTED", startOffsetDays: -300 }),
  };
  console.log("[demo] staff ready");

  // ---- devices + custody ----
  const laptops = [
    { tag: "TRC-LAP-001", model: "Dell Latitude 5450", cost: 1349.0, age: 380, holder: staff.amelia, since: 360 },
    { tag: "TRC-LAP-002", model: "Dell Latitude 5450", cost: 1349.0, age: 380, holder: staff.hannah, since: 200 },
    { tag: "TRC-LAP-003", model: "MacBook Air M3", cost: 1499.0, age: 95, holder: staff.sofia, since: 90 },
    { tag: "TRC-LAP-004", model: "Dell Latitude 5450", cost: 1349.0, age: 60, holder: staff.omar, since: 40 },
    { tag: "TRC-LAP-005", model: "Dell Latitude 5450", cost: 1349.0, age: 30, holder: staff.grace, since: 250 }, // departed holder
    { tag: "TRC-LAP-006", model: "Dell Latitude 5450", cost: 1349.0, age: 15, holder: null, since: 0 },
    { tag: "TRC-LAP-007", model: "Dell Latitude 5450", cost: 1349.0, age: 15, holder: null, since: 0 },
  ];
  for (const l of laptops) {
    const d = await ensureDevice({ assetTag: l.tag, type: "LAPTOP", model: l.model, cost: l.cost, purchasedDaysAgo: l.age, location: "Corporate" });
    if (l.holder) await assign(d.id, l.holder.id, l.since);
  }

  const phones = ["TRC-PHN-001", "TRC-PHN-002", "TRC-PHN-003", "TRC-PHN-004"];
  for (const tag of phones) await ensureDevice({ assetTag: tag, type: "PHONE", model: "iPhone 15", cost: 999.0, purchasedDaysAgo: 120, location: "Corporate" });
  const ph1 = await prisma.device.findUnique({ where: { assetTag: "TRC-PHN-001" } });
  if (ph1) await assign(ph1.id, staff.diego.id, 110);

  const monitors = ["TRC-MON-001", "TRC-MON-002", "TRC-MON-003", "TRC-MON-004", "TRC-MON-005", "TRC-MON-006"];
  for (const tag of monitors) await ensureDevice({ assetTag: tag, type: "MONITOR", model: "Dell P2425", cost: 289.0, purchasedDaysAgo: 200, location: "Corporate" });
  const docks = ["TRC-DCK-001", "TRC-DCK-002", "TRC-DCK-003"];
  for (const tag of docks) await ensureDevice({ assetTag: tag, type: "DOCK", model: "Dell WD19S", cost: 219.0, purchasedDaysAgo: 200, location: "Corporate" });
  console.log("[demo] devices + custody ready");

  // ---- tickets (some resolved -> recall memory) ----
  await ensureTicket({
    externalId: "DEMO-T-001",
    subject: "Can't connect to office WiFi on work laptop",
    body: "Since the weekend my laptop sees the network at The Taylor but won't connect.",
    status: "RESOLVED",
    resolution: "Forgot the SSID, removed the stale saved profile, then rejoined with the staff cert. Also renewed DHCP. Confirmed back online.",
  });
  await ensureTicket({
    externalId: "DEMO-T-002",
    subject: "uniFLOW printing not working — secure print fails",
    body: "Secure print at the leasing desk asks for a PIN then errors out.",
    status: "RESOLVED",
    resolution: "User's uniFLOW PIN had not been set. Set the PIN in the uniFLOW console and reinstalled the cloud print queue. Test print succeeded.",
  });
  await ensureTicket({
    externalId: "DEMO-T-003",
    subject: "New starter needs Outlook + MFA set up",
    body: "Ava starts next week and needs her mailbox and MFA configured.",
    status: "RESOLVED",
    resolution: "Created the M365 account, assigned an E3 licence, enrolled two MFA methods (Authenticator + phone), and verified Outlook on first sign-in.",
  });
  await ensureTicket({ externalId: "DEMO-T-004", subject: "Second monitor request for leasing desk", body: "Could we get a second monitor for tour scheduling?", status: "OPEN", priority: "NORMAL", slaOffsetDays: 2 });
  await ensureTicket({ externalId: "DEMO-T-005", subject: "Laptop running very slow after update", body: "Since the latest Windows update the Latitude is crawling.", status: "PENDING", priority: "HIGH", slaOffsetDays: 1 });
  await ensureTicket({ externalId: "DEMO-T-006", subject: "URGENT: concierge desk phone is dead", body: "The shared concierge phone at Cherry House has no dial tone.", status: "OPEN", priority: "URGENT", slaOffsetDays: -1 }); // past SLA
  console.log("[demo] tickets + recall memory ready");

  // ---- tasks (varied statuses + due dates) ----
  await ensureTask({ key: "demo:task:1", title: "Image 4 loaner laptops for The Taylor", type: "SETUP", priority: "HIGH", status: "IN_PROGRESS", dueOffsetDays: 0, buildingId: await buildingId("The Taylor") }); // due today
  await ensureTask({ key: "demo:task:2", title: "Install dual monitors at the Ivy leasing desk", type: "INSTALL", status: "TODO", dueOffsetDays: 3, buildingId: await buildingId("The Ivy") });
  await ensureTask({ key: "demo:task:3", title: "Collect laptop from Grace Miller (departed)", type: "RETURN_DEVICE", priority: "HIGH", status: "TODO", dueOffsetDays: -2, staffId: staff.grace.id }); // overdue
  await ensureTask({ key: "demo:task:4", title: "Swap failed dock at Maple House", type: "REPAIR", status: "BLOCKED", dueOffsetDays: -1 }); // overdue
  await ensureTask({ key: "demo:task:5", title: "Provision accounts for Ava Thompson", type: "SETUP", status: "DONE", staffId: staff.ava.id });
  await ensureTask({ key: "demo:task:6", title: "Set up Noah Kim workstation at The Taylor", type: "ASSIGN_DEVICE", status: "TODO", dueOffsetDays: 7, staffId: staff.noah.id });
  await ensureTask({ key: "demo:task:7", title: "Quarterly site audit — The Selby", type: "AUDIT", status: "TODO", dueOffsetDays: 14, buildingId: await buildingId("The Selby") });
  console.log("[demo] tasks ready");

  // ---- onboardings ----
  for (const s of [staff.ava, staff.noah]) {
    const existing = await prisma.onboarding.findUnique({ where: { staffId: s.id } });
    if (!existing) {
      await prisma.onboarding.create({
        data: {
          staffId: s.id,
          startDate: s.startDate,
          recommendedDevices: [{ type: "LAPTOP", quantity: 1 }, { type: "MONITOR", quantity: 2 }],
          deviceStatus: "PENDING",
        },
      });
    }
  }
  console.log("[demo] onboardings ready");

  console.log("[demo] done");
}

main()
  .catch((err) => {
    console.error("[demo] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export {};
