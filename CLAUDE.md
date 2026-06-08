# TRICON IT HUB — Project Context

> This file is durable context. Re-read at the start of every session. It governs every phase.

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

## Phase 1 seams to leave for later phases (do NOT implement now)

These are noted only so Phase 1 is built with the right hooks:
- **Tenancy boundary** — keep all queries scoped through a service layer so multi-tenant / white-label is a later switch, not a rewrite. Single tenant ("Tricon") for now.
- **Auth provider abstraction** — wrap login behind an interface so Microsoft Entra / M365 SSO can drop in later.
- **Identity source abstraction** — design `Staff` ingestion so an Active Directory / Entra sync can later become an additional source feeding the same records.
- **Ticket adapter interface** — already specified; ServiceNow becomes the primary adapter later.
- **KB ingestion** — `KnowledgeArticle` + `MemoryEntry` already support growth; later add an article-from-resolution generator.

Phases 2–5 features (offboarding, SLA jobs, Ask-the-Hub, M365 SSO, mobile/PWA, etc.) are tracked in the Phase 1 spec's Part 6. Do not build them now.
