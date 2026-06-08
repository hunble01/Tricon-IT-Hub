# PROJECT STATUS — Tricon IT Hub

> **For any Claude instance or teammate picking this up:** read this first, then
> `CLAUDE.md` (durable architecture rules), then `TRICON_IT_HUB_Phase1_Spec.md`
> (full spec; Part 6 = roadmap) and `TRICON_IT_HUB_Updates.md` (supersedes the
> spec where they conflict). This file is the synthesized *current state* as of
> **2026-06-08**. Contains no secrets — all config is env-driven (see
> `.env.example` / `.env.prod.example`).

## What this is
A multi-user IT support platform for **Tricon** (Toronto multi-family residential,
~9 sites + corporate). One IT engineer builds it; it will be shared with the IT
team, then sold to Tricon. So it's built **multi-user + data-governance-clean from
day one**. Goal: an "automation machine" that kills manual data entry, not prettier
CRUD.

## Architecture pillars (all implemented — see CLAUDE.md for the rules)
- **Neutral Ticket model + source-adapter pattern** — `ManualAdapter` (paste-in),
  `ServiceNowAdapter`, `OutlookAdapter`. Engine depends only on the interface.
- **Two-layer memory** — relational `AuditLog` (every mutation) + `MemoryEntry`
  pgvector AI memory (`recall`/`remember`). Vectors live in our Postgres only.
- **Data governance** — LLM calls server-side only; PII (names) pseudonymized
  before leaving, rehydrated on return; all access via the `LlmProvider`
  interface (swappable: OpenAI/Anthropic now → Azure/self-host later).
- **Multi-user** — real auth, `User` + `ADMIN`/`AGENT`. "Knowledge is shared,
  actions are owned" (per-agent ticket claim/send; shared memory/KB).

## Tech stack
Next.js (App Router) + TS + Tailwind/shadcn web · NestJS API · Postgres +
pgvector + pg_trgm via Prisma · Redis + BullMQ · Docker Compose · pnpm + Turborepo
monorepo (`apps/api`, `apps/web`, `packages/db`, `packages/shared`).

## ✅ Built and working
- **Auth** (JWT, ADMIN/AGENT, RolesGuard)
- **Staff CRM** (fuzzy name matcher, AD-prefix suggester, source badges)
- **Devices/Inventory** — per-item custody, assign/return history, purchase
  provenance, peripherals tracked individually
- **Buildings / Roles / role→device matrix** (seeded reference data)
- **Onboarding** (auto-provision from stock + 4-part checklist) & **Offboarding**
  (reclaim gear + close-out checklist)
- **Tickets** — queue, claim/assign, AI draft (dual-model: Claude + GPT
  side-by-side), resolve, human-in-the-loop send, auto-prioritize + SLA windows
- **AI memory** — pgvector recall/remember (real OpenAI embeddings)
- **Smart Intake** (paste text → structured records), **Site Audits**,
  **Procurement** (manual entry + file upload)
- **Proactive Alerts** (6 categories), **Daily Briefing**, **Dashboard**, **Audit log**
- **SLA sweep job** (BullMQ, every 15 min)
- 17 web pages, mobile-responsive (off-canvas drawer < lg), "Atelier" design system

## ⚠️ Half-built / inert (near-term backlog)
- **Outlook per-agent OAuth** — UI + adapter exist; real sign-in/token exchange
  not wired (uses `GRAPH_ACCESS_TOKEN` test token; SANDBOX otherwise).
- **ServiceNow** — adapter is real but needs a PDI + creds (`SERVICENOW_*`);
  SANDBOX sample data until `SOURCES_SANDBOX=false`.
- **Procurement AI extraction** — `POST /api/procurement/extract` exists; works
  with the live LLM key but is unverified.
- **Email digest** — SLA sweep logs breaches but emails no one yet.
- **Teams source** — deliberately stubbed/deferred.

## 🗺️ Roadmap (spec Part 6, mapped to today)
- **Phase 2** (mostly done keyless: offboarding/SLA/prioritization/briefing) →
  **remaining: go live on ServiceNow + Outlook** (dev sandboxes + creds).
- **Phase 3** (the moat, barely started): **Ask-the-Hub** (NL query over all
  data + memory), **pattern detection** (cluster related tickets → one root
  cause), resolution playbooks, **auto-KB from resolutions**.
- **Phase 4** (enterprise/sale): **M365/Entra SSO + AD sync**, reporting, asset
  lifecycle/warranty, self-service portal, **mobile/PWA + QR tags**, ServiceNow
  CMDB sync.
- **Phase 5**: multi-tenant / white-label (commercial).

## LLM config (current)
Split provider: **Anthropic completions** (`claude-sonnet-4-6`) + **OpenAI
embeddings** (`text-embedding-3-small`, 1536), fused behind `CompositeLlmProvider`.
Set via `LLM_PROVIDER=anthropic` + `EMBEDDING_PROVIDER=openai`. Anthropic has no
embeddings endpoint — that's why embeddings use OpenAI. Tickets draft from BOTH
configured completion providers for side-by-side comparison. After changing the
embedding provider, run `POST /api/memory/reindex` (admin) to re-embed all entries.

## Gotchas
- `Onboarding.recommendedDevices` JSON is **dual-shape** (objects `{type,quantity}`
  OR bare strings) — normalize before use.
- `Device.purchaseLocationId` / `invoiceLineItemId` are plain string refs (no FK
  cascade) — resolved in the service layer.
- `MemoryEntry.embedding` is `Unsupported("vector(1536)")` — query via `$queryRaw`
  only, never the Prisma ORM API.
- `TicketReply.externalRef` is null for MANUAL tickets (no back-channel).
- Migrations are hand-written additive SQL applied via `prisma migrate deploy`
  (never `migrate dev` against shared state) — manual HNSW/trgm indexes.

## Deploy
Production kit is built + build-verified: `apps/api/Dockerfile`,
`apps/web/Dockerfile` (Next standalone), `docker-compose.prod.yml` (postgres +
redis + one-shot migrate + api + web + Caddy, isolated on `tricon-net`, namespaced
`tricon-*` to coexist with other apps), `Caddyfile`, `.env.prod.example`. Full
steps in **`DEPLOY.md`**. Bring up:
`docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build`.
Before going public: real `JWT_SECRET`, `AUTH_DISABLED=false`, fresh LLM keys,
`CORS_ORIGIN` locked to the public origin.
