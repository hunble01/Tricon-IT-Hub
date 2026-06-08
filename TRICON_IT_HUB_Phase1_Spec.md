# TRICON IT HUB — Phase 1 Build Spec

**Audience:** Claude Code (executing agent), running locally in VS Code.
**Author:** Senior technical advisor (planning). **Phase:** 1 of 4.

---

## How to use this document

1. Copy **Part 1 (Project Context)** into a file named `CLAUDE.md` at the repo root. That is durable context — it governs every future phase, so Claude Code should re-read it each session.
2. **Part 2** is the work to execute **now**. Follow the build order top to bottom.
3. **Parts 3–5** are reference (schema, seed data, setup).
4. **Do NOT build Phases 2–4** (live ticket sync, full AI suggestion engine, reporting). They are noted only so you build Phase 1 with the right foundations. Stub where indicated; do not implement live integrations.

---

# PART 1 — PROJECT CONTEXT (→ save as `CLAUDE.md`)

## What this is

TRICON IT HUB is a full-stack IT support platform for **Tricon**, a Toronto multi-family residential company. The IT team supports building staff (property managers, leasing consultants, maintenance techs, concierge, etc.) across ~9 sites plus a corporate office. The app handles **staff CRM, device/asset inventory, onboarding, and ticket assistance** in one place.

It is being built by one IT support engineer and will later be shared with the whole IT support team, then sold to Tricon. Therefore: build it **multi-user and data-governance-clean from day one**, even though only one person uses it now.

## Tech stack (locked — do not substitute)

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- **Backend:** NestJS + TypeScript
- **DB:** PostgreSQL (with `pgvector` and `pg_trgm` extensions) via Prisma
- **Jobs/queue:** Redis + BullMQ (used in later phases; wire the connection in Phase 1, no heavy jobs yet)
- **Infra:** Docker Compose, deploys to a Hostinger VPS behind Nginx/Caddy
- **Package manager / repo:** pnpm workspaces + Turborepo (monorepo)

## Monorepo layout

```
tricon-it-hub/
  apps/
    api/            # NestJS
    web/            # Next.js
  packages/
    db/             # Prisma schema + generated client (shared)
    shared/         # shared TS types + adapter/provider interfaces
  docker-compose.yml
  turbo.json
  pnpm-workspace.yaml
  .env.example
```

## Architecture principles (apply in every phase)

1. **Neutral ticket model + adapter pattern.** Tickets are stored in our own platform-agnostic `Ticket` shape. External systems are thin adapters that map their format into ours. Implementations: `ManualAdapter` (Phase 1, paste-in), `ZendeskAdapter` (later — Zendesk is being **deprecated**), `ServiceNowAdapter` (later — ServiceNow is the **incoming primary** ITSM via its REST Table API). The ticket engine must depend only on the adapter interface, never on a vendor.
2. **Memory is two layers, and it is non-negotiable:**
   - **Relational audit log** — every create/update/assign/resolve action is persisted in `AuditLog`.
   - **AI memory** — a unified `MemoryEntry` store with `pgvector` embeddings over tickets, resolutions, KB articles, and staff context. Retrieval (`recall`) powers suggestions. Embeddings + vectors **live in our Postgres** and never leave the VPS.
3. **Data governance (this is a feature, it makes the enterprise sale possible):**
   - LLM calls are **server-side only** — API keys never reach the browser.
   - Use the provider's **zero-retention / no-training** setting.
   - **Pseudonymize PII** (staff names) before any text leaves for completion; keep the token↔name map local; rehydrate on return.
   - All LLM access goes through an `LlmProvider` interface (`embed`, `complete`) with swappable implementations (`OpenAiProvider`, `AnthropicProvider`). Target for the eventual sale: Azure OpenAI (Canada Central) or a self-hosted model — the abstraction must make that a config swap.
   - Embedding dimension is config-driven (`EMBEDDING_DIM`, default 1536).
4. **Multi-user from day one.** Real auth, `User` + roles (`ADMIN`/`AGENT`). Only one user exists now; never hardcode a single-user assumption.
5. **Conventions:** TypeScript `strict`; validate all API input (class-validator DTOs in Nest, zod on web); REST under `/api`; no secrets in code; everything env-driven; meaningful migrations (never `db push` against shared state).

## Integration status (read before touching tickets)

- **Zendesk:** current system, **agent-UI access only**, **being retired in weeks**. Do NOT build a live Zendesk connector.
- **ServiceNow:** replacing Zendesk soon; has a proper REST API and native ITSM/CMDB. Future primary adapter. Our asset inventory may later sync to ServiceNow CMDB.
- **Phase 1 ticket support = paste-in only** (`ManualAdapter`). The drafting/memory logic is built now so it lights up unchanged when a real API token arrives.

---

# PART 2 — PHASE 1 SCOPE & BUILD ORDER

## In scope (build all of this)

- Monorepo scaffold + Docker + Postgres(pgvector/pg_trgm) + Redis
- Prisma schema + migrations + seed (Part 3 & 4)
- Auth (email + password, JWT, roles)
- **Buildings**, **Roles**, **Role→Device matrix** (seeded reference data)
- **Staff CRM** — auto-buildable records, fuzzy name/building matcher, AD-prefix suggester
- **Device / Asset inventory** — with stock-source locations + assignment history
- **Onboarding module** — the Excel as a real app: role+building → recommended devices + AD prefix + 4-part checklist (AD / Badge / Hardware / Software)
- **Paste-in Ticket Drafter (stub-grade)** — neutral `Ticket`, `ManualAdapter`, `LlmProvider` + `MemoryService` wired, requester matched to CRM, returns a drafted reply + internal note using retrieved memory/KB
- **Memory** — `MemoryEntry` + pgvector `recall`/`remember`; `AuditLog`

## Explicitly OUT of scope (do not build yet)

- Live Zendesk/ServiceNow sync, OAuth, webhooks
- SLA reminder jobs, ticket auto-prioritization at scale (Phase 2)
- Full suggestion/macro engine + KB ingestion pipeline beyond a basic seed (Phase 3)
- Reporting/analytics dashboards, CMDB sync (Phase 4)
- AD / uniFLOW integration (future; no access yet)

## Build order (execute in sequence; commit after each step)

1. **Scaffold** the monorepo (pnpm + turbo), `apps/api` (Nest), `apps/web` (Next), `packages/db`, `packages/shared`. Add `docker-compose.yml` (postgres w/ pgvector image, redis), `.env.example`, root scripts.
2. **DB package**: Prisma schema from Part 3. Enable `vector` + `pg_trgm` extensions via a migration. Generate client. Add the `MemoryEntry.embedding` vector column via raw SQL in the migration (Prisma maps it `Unsupported("vector(1536)")`).
3. **Seed** reference data from Part 4 (buildings, roles, role→device matrix, KB stubs). Add an Excel importer for staff/onboarding (Part 4).
4. **Auth** in Nest: register/login, JWT, `RolesGuard`. Seed one ADMIN user from env. Protect all routes. Minimal login UI in web.
5. **Buildings + Roles + Role-device matrix**: read APIs + simple admin UI to view/edit. This is the backbone everything references.
6. **Staff / CRM**: CRUD; `StaffMatcher` (normalize name, `pg_trgm` similarity, optional building filter, confidence + threshold → match / suggest-create); `adPrefix` suggester (firstInitial+lastName, collision-resolved). Staff list + detail UI with `source` badge (ONBOARDING / TICKET / MANUAL).
7. **Devices / Assets**: CRUD; statuses; `currentLocation` (stock source building); assign/return → writes `DeviceAssignment` + `AuditLog`; inventory UI filterable by type/status/location.
8. **Onboarding**: create an onboarding record from name + role + building + start date → auto-suggests device list (from role-device matrix) + AD prefix; 4-part checklist (AD/Badge/Hardware/Software) + device-setup status; completing assignment links real `Device`s via `DeviceAssignment`. Onboarding board grouped by month (mirror the Excel).
9. **Ticket Drafter (paste-in)**: `Ticket` create from pasted subject/body; `ManualAdapter`; match requester via `StaffMatcher`; `MemoryService.recall()` pulls similar past tickets + relevant KB + requester history; `LlmProvider.complete()` (PII-pseudonymized) drafts a public reply + internal note; persist as `TicketDraft`. Saving a resolution calls `MemoryService.remember()` so it seeds ticket memory now.
10. **Audit + polish**: ensure every mutating action writes `AuditLog`; basic dashboard (counts: staff, devices by status, onboardings in progress, tickets drafted).

## Acceptance criteria (Phase 1 is "done" when)

- `docker compose up` + `pnpm dev` runs web + api locally; migrations + seed succeed.
- I can log in; unauthenticated API calls are rejected.
- Buildings, roles, and the role-device matrix are seeded and visible.
- I can create a staff member; the app suggests their AD prefix; a near-duplicate name triggers a match suggestion instead of a silent duplicate.
- I can add devices, assign one to a staff member, return it, and see the assignment history.
- I can start an onboarding from role+building and get the correct recommended device list + checklist; completing it assigns real devices.
- I can paste a ticket, get the requester matched to CRM, and receive a drafted reply + internal note that cites retrieved context; saving a resolution stores a memory.
- Every mutation appears in `AuditLog`. LLM keys are server-side only; names are pseudonymized in outbound LLM payloads (verify in logs).

---

# PART 3 — DATA MODEL (Prisma reference)

Implement this schema (refine names/fields if clearly better, but keep the relationships and the memory/audit/adapter design intact).

```prisma
// datasource: postgresql; generator: prisma-client-js
// Required extensions (add in migration): vector, pg_trgm

enum UserRole { ADMIN AGENT }
enum BuildingStatus { LIVE OPENING COMING_SOON CORPORATE }
enum RoleCategory { BUILDING_STAFF MANAGER CORPORATE }
enum DeviceType { LAPTOP SURFACE PHONE TABLET HEADSET DOCK MONITOR MINI_PC USB_ADAPTER OTHER }
enum DeviceStatus { IN_STOCK ASSIGNED RETURNED IN_REPAIR RETIRED }
enum EmploymentStatus { ONBOARDING ACTIVE NO_SHOW DEPARTED }
enum StaffSource { ONBOARDING TICKET MANUAL }
enum OnboardingDeviceStatus { PENDING ALREADY_SET_UP DONE }
enum TicketSource { MANUAL ZENDESK SERVICENOW }
enum TicketStatus { OPEN PENDING RESOLVED }
enum TicketPriority { LOW NORMAL HIGH URGENT }
enum MemoryType { TICKET_RESOLUTION KB STAFF_CONTEXT ACTION_LOG NOTE }

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         UserRole @default(AGENT)
  createdAt    DateTime @default(now())
  assignments  DeviceAssignment[]
  auditLogs    AuditLog[]
}

model Building {
  id          String         @id @default(cuid())
  name        String         @unique           // e.g. "Cherry House"
  displayName String?                          // e.g. "Cherry House at Canary Landing"
  neighborhood String?
  status      BuildingStatus @default(LIVE)
  notes       String?
  staff       Staff[]
  devices     Device[]                         // stock/current location
  onboardings Onboarding[]
}

model Role {
  id            String          @id @default(cuid())
  title         String          @unique
  category      RoleCategory    @default(BUILDING_STAFF)
  isSharedDevice Boolean        @default(false) // concierge desks share a device
  notes         String?
  deviceProfile RoleDeviceProfile[]
  staff         Staff[]
}

model RoleDeviceProfile {
  id        String     @id @default(cuid())
  roleId    String
  role      Role       @relation(fields: [roleId], references: [id])
  deviceType DeviceType
  quantity  Int        @default(1)
  @@unique([roleId, deviceType])
}

model Staff {
  id               String           @id @default(cuid())
  fullName         String
  firstName        String
  lastName         String
  adPrefix         String?                       // suggested or confirmed
  roleId           String?
  role             Role?            @relation(fields: [roleId], references: [id])
  buildingId       String?
  building         Building?        @relation(fields: [buildingId], references: [id])
  startDate        DateTime?
  employmentStatus EmploymentStatus @default(ONBOARDING)
  email            String?
  phone            String?
  source           StaffSource      @default(MANUAL)
  notes            String?
  createdAt        DateTime         @default(now())
  devices          DeviceAssignment[]
  onboarding       Onboarding?
  tickets          Ticket[]
}

model Device {
  id            String       @id @default(cuid())
  assetTag      String?      @unique
  serialNumber  String?      @unique
  type          DeviceType
  model         String?
  status        DeviceStatus @default(IN_STOCK)
  locationId    String?                          // stock source / current building
  location      Building?    @relation(fields: [locationId], references: [id])
  notes         String?
  createdAt     DateTime     @default(now())
  assignments   DeviceAssignment[]
}

model DeviceAssignment {
  id           String   @id @default(cuid())
  deviceId     String
  device       Device   @relation(fields: [deviceId], references: [id])
  staffId      String
  staff        Staff    @relation(fields: [staffId], references: [id])
  assignedById String?
  assignedBy   User?    @relation(fields: [assignedById], references: [id])
  assignedAt   DateTime @default(now())
  returnedAt   DateTime?
  notes        String?
}

model Onboarding {
  id              String                 @id @default(cuid())
  staffId         String                 @unique
  staff           Staff                  @relation(fields: [staffId], references: [id])
  stockSourceId   String?
  stockSource     Building?              @relation(fields: [stockSourceId], references: [id])
  startDate       DateTime?
  // 4-part checklist (Excel "Onboarding Tickets Solved?")
  adDone          Boolean                @default(false)
  badgeDone       Boolean                @default(false)
  hardwareDone    Boolean                @default(false)
  softwareDone    Boolean                @default(false)
  recommendedDevices Json                // device types suggested from role matrix
  deviceStatus    OnboardingDeviceStatus @default(PENDING)
  assignedTech    String?                // who did the setup (free text for now)
  monthLabel      String?                // e.g. "Jun. 2026" (Excel grouping)
  notes           String?
  createdAt       DateTime               @default(now())
}

model Ticket {
  id              String         @id @default(cuid())
  source          TicketSource   @default(MANUAL)
  externalId      String?
  requesterStaffId String?
  requester       Staff?         @relation(fields: [requesterStaffId], references: [id])
  subject         String
  body            String
  category        String?
  status          TicketStatus   @default(OPEN)
  priority        TicketPriority @default(NORMAL)
  slaDueAt        DateTime?
  lastReplyAt     DateTime?
  raw             Json?
  createdAt       DateTime       @default(now())
  drafts          TicketDraft[]
}

model TicketDraft {
  id               String   @id @default(cuid())
  ticketId         String
  ticket           Ticket   @relation(fields: [ticketId], references: [id])
  suggestedReply   String
  suggestedNote    String?
  retrievedContext Json?    // ids/snippets of memories used
  model            String?
  createdAt        DateTime @default(now())
}

model KnowledgeArticle {
  id        String   @id @default(cuid())
  title     String
  content   String
  source    String?
  tags      String[]
  createdAt DateTime @default(now())
}

model MemoryEntry {
  id        String     @id @default(cuid())
  type      MemoryType
  refTable  String?
  refId     String?
  content   String                                   // text that was embedded
  // embedding column added via raw SQL migration:
  // embedding vector(1536)
  embedding Unsupported("vector(1536)")?
  metadata  Json?
  createdAt DateTime   @default(now())
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id])
  action     String                                   // e.g. "device.assign"
  entityType String?
  entityId   String?
  metadata   Json?
  createdAt  DateTime @default(now())
}
```

**pgvector notes for the migration:** `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;` then `ALTER TABLE "MemoryEntry" ADD COLUMN "embedding" vector(1536);` and an IVFFlat/HNSW index for cosine similarity. Similarity search uses `$queryRaw` (`ORDER BY embedding <=> $query LIMIT k`). Keep dimension in env (`EMBEDDING_DIM`).

---

# PART 4 — SEED DATA REFERENCE

## Buildings

| name | displayName | neighborhood | status |
|---|---|---|---|
| Cherry House | Cherry House at Canary Landing | Canary District | LIVE |
| Maple House | Maple House at Canary Landing | Canary District | LIVE |
| Birch House | Birch House at Canary Landing | Canary District | LIVE |
| The Spoke | The Spoke | The Junction | LIVE |
| The Ivy | The Ivy | Yonge & Bloor | LIVE |
| The Taylor | The Taylor | Fashion/Entertainment District | LIVE |
| The Selby | The Selby | Bloor Street East | LIVE |
| The James | The James | Rosedale | LIVE |
| ROQ City | ROQ City | Garden District/Corktown | OPENING |
| Corporate | Corporate (TLR / HQ) | — | CORPORATE |

(Optional future: Oak House, The Stella — COMING_SOON.)

## Roles + Role→Device matrix

Seed each role with its default device list. Concierge is the shared-device exception (`isSharedDevice = true`, no personal devices by default).

| Role | category | shared? | default devices |
|---|---|---|---|
| Maintenance Technician | BUILDING_STAFF | no | Phone |
| Maintenance Manager | MANAGER | no | Phone, Laptop, Headset |
| Concierge | BUILDING_STAFF | **yes** | (none — uses shared desk Mini-PC) |
| Property Manager | MANAGER | no | Phone, Laptop, Headset |
| Property Administrator | BUILDING_STAFF | no | Laptop, Headset |
| Leasing Consultant | BUILDING_STAFF | no | Phone, Surface, Headset |
| Director, Operations | MANAGER | no | Phone, Laptop, Headset |
| General Manager, CPM | CORPORATE | no | Laptop, Headset |
| Resident Experience Manager | MANAGER | no | Phone, Laptop, Headset |
| Dockmaster (Receiving Coordinator) | BUILDING_STAFF | no | Phone, Tablet, Headset |
| Lease Administrator | CORPORATE | no | Laptop, Headset |

**Desk-side setup note (not per-person assets):** laptop users dock to a stationary ThinkPad dock + monitor + mouse left at the desk. Model docks/monitors as building-fixed devices (location set, no staff assignment) — do not auto-assign them during onboarding.

## AD prefix convention

`firstInitial + lastName`, lowercase (e.g. Jason Harrison → `jharrison`). On collision, extend the first name (e.g. `jleandrinmella`, `juaguilar`). The suggester returns a candidate; the user confirms.

## KnowledgeArticle seed (from the orientation deck — short stubs, full ingestion is Phase 3)

Seed one article per topic with the key facts:
- **Contacting IT** — support portal / `helpdesk@triconhomes.com` / (833) 700-2454; hours 9 a.m.–9 p.m. ET.
- **Intranet** — `triconone.sharepoint.com` (benefits, expenses, jobs, events).
- **Hardware policy** — staff responsible for issued gear; return in working order; limited 3rd-party support; USB drives prohibited; no personal data on devices.
- **Company apps** — via Company Portal; Sync under Settings for updates.
- **App requests** — submit ticket with justification (IT Procurement Policy).
- **Conference rooms** — Teams & Zoom; Zoom license needed for 40-min+ meetings.
- **External calls** — Teams phone numbers for corporate + Canadian MFR staff.
- **Printing — uniFLOW** — cloud print; set uniFLOW as default; secure print + scanning need a uniFLOW PIN; mgmt URL `https://tricon-residential.us.uniflowonline.com/`.
- **Password policy** — min 10 chars, upper+lower+number+special, no personal info, never written/shared; expires every 180 days; change via Ctrl+Alt+Del → Change a password.
- **MFA** — ≥2 methods; set up at `mysignins.microsoft.com/security-info`; Microsoft Authenticator, phone, or email.
- **SSO / O365** — sign in with Tricon email at office.com or local apps; use Outlook, not native Mail.
- **Backup — OneDrive** — backs up Documents, Pictures, Desktop; used for sharing.
- **Security — KnowBe4** — report suspicious email via Phish Alert → Process Report.

## Staff / Onboarding import

The historical onboarding records live in an Excel workbook (`MFR_Onboarding_Info_and_Setup.xlsx`) with one sheet per month and columns: *Name, Start Date, Title, Office Location, Stock Source, AD Account Prefix, Onboarding Tickets Solved?, Device(s) to Assign, Device(s) Set Up?, Notes*.

Write a script `packages/db/scripts/import-onboarding.ts` that:
- Reads each monthly sheet (use `xlsx`/SheetJS), tagging `monthLabel` from the sheet name.
- Upserts a `Staff` (split name; map Title→Role, Office Location→Building; set `adPrefix`; `source = ONBOARDING`).
- Creates an `Onboarding` (stock source, start date, device list from "Device(s) to Assign", `deviceStatus`, notes, `monthLabel`).
- Marks `employmentStatus = NO_SHOW` when notes say "No longer joining Tricon".
- Handles messy dates (some cells are Excel serial numbers, e.g. `46153`) and trailing spaces in building/title names.
- Place the workbook at `seed/onboarding.xlsx`; the script reads from there.

---

# PART 5 — SETUP & RUN

## Prerequisites
Node 20+, pnpm, Docker.

## `.env.example` (root)
```
DATABASE_URL=postgresql://tricon:tricon@localhost:5432/tricon_it_hub
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=change-me
LLM_PROVIDER=openai            # openai | anthropic
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
EMBEDDING_DIM=1536
PII_PSEUDONYMIZE=true
```

## docker-compose.yml
Postgres image **with pgvector** (e.g. `pgvector/pgvector:pg16`) + Redis. Expose 5432 / 6379.

## Commands (root scripts)
```
pnpm install
docker compose up -d
pnpm db:migrate        # prisma migrate dev (incl. extensions + vector column)
pnpm db:seed           # reference data + admin user
pnpm db:import         # onboarding.xlsx import (optional)
pnpm dev               # turbo: web + api
```

---

# PART 6 — FUTURE PHASES & BACKLOG

**Do NOT build any of this in Phase 1.** It is captured so (a) nothing is lost, and (b) Phase 1 is built with the right seams. The owner adds new items here as they learn the job — treat this as a living backlog.

## Phase 1 must leave these seams ready (build the hooks, not the features)

- **Tenancy boundary:** include an optional `tenantId` concept (or keep all queries scoped through a single service layer) so multi-tenant / white-label is a later switch, not a rewrite. Single tenant ("Tricon") for now.
- **Auth provider abstraction:** wrap login behind an interface so **Microsoft Entra / M365 SSO** can be added without touching app code.
- **Identity source abstraction:** the CRM is self-built now; design `Staff` ingestion so an **Active Directory / Entra sync** can later become an additional source feeding the same records.
- **Ticket adapter interface** (already specified): ServiceNow becomes the primary adapter.
- **KB ingestion:** `KnowledgeArticle` + `MemoryEntry` already support growth; later add an article-from-resolution generator.

## Backlog (grouped; ⭐ = highest impact)

**Faster daily work**
- ⭐ **Offboarding flow** — mirror of onboarding: list all devices assigned to a departing person to reclaim, flag AD disable + badge return, close the asset loop.
- ⭐ **Predictive stock levels** — par level per building + lookahead at upcoming onboardings → "ROQ City short 2 phones next week."
- **One-click onboarding kit** — device list + AD request text + badge request + printable setup sheet generated together.
- **Bulk onboarding** — for new building openings.

**Intelligence (the moat)**
- ⭐ **Pattern detection** — cluster related tickets ("5 uniFLOW tickets at The Selby → likely a server/printer issue, not 5 user problems").
- ⭐ **"Ask the Hub"** — natural-language query over all data + memory ("who did I onboard at ROQ City last month?", "how did I fix the dock-not-detecting-monitor issue?", "what's in stock at The James?").
- **Resolution playbooks** — recurring fixes become one-click documented runbooks.
- **Auto-generate KB article** from a resolved ticket.
- **Daily briefing** — morning summary: onboardings this week, tickets needing replies today, low stock.

**Enterprise-grade (wins the sale)**
- ⭐ **Microsoft 365 / Entra SSO** — "sign in with Microsoft"; later auto-populate CRM from AD.
- **Reporting** — tickets resolved, avg resolution time, onboarding SLA, asset utilization/age.
- **Asset lifecycle** — warranty/age tracking → refresh planning.
- **Self-service portal** — staff-facing guides (password, uniFLOW) to deflect tickets.
- **ServiceNow CMDB sync** — inventory ↔ CMDB once on ServiceNow with API access.

**Field-first**
- ⭐ **Mobile / PWA + QR asset tags** — scan a device tag on-site, pull its record, log a fix in the building.

**Sell-it play**
- **Multi-tenant / white-label** — sell to other property managers / IT teams beyond Tricon.

## Tentative phase mapping (subject to change)

- **Phase 2** — ServiceNow adapter, SLA reminder jobs, ticket prioritization, requester auto-enrichment, **offboarding**, daily briefing.
- **Phase 3** — full AI suggestion engine, **"Ask the Hub"**, **pattern detection**, playbooks, KB-from-resolution.
- **Phase 4** — **M365 SSO + AD sync**, reporting, asset lifecycle, self-service portal, **mobile/PWA + QR**, CMDB sync.
- **Phase 5 (commercial)** — multi-tenant / white-label.

---

**End of Phase 1 spec.** When Phase 1 passes its acceptance criteria, request the Phase 2 spec (live ServiceNow adapter design, SLA reminder jobs, ticket prioritization, requester auto-enrichment, offboarding).
