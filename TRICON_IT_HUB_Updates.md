# TRICON IT HUB — Updates Since Handoff

**Read this alongside `TRICON_IT_HUB_Phase1_Spec.md`.** These are decisions made *after* the spec was first handed off. Where this file and the original spec disagree, **this file wins.** None of this changes Phase 1 scope — it’s mostly Phase 2 direction plus a few seams to respect now.

> Exception: §6 (Inventory upgrade) is **promoted into Phase 1** — see that section.

-----

## TL;DR

- Phase 1 scope is **unchanged** (except §6 inventory, promoted in). Keep building it as specified.
- The ticket “adapter” is now a broader **source adapter** (tickets **+ email**, with chat deferred).
- Phase 2’s live sources are confirmed: **ServiceNow (primary) + Outlook via Microsoft Graph `Mail.Read` (secondary)**. **Teams is deferred to a stub.**
- Live adapters will be built/tested against **developer sandboxes** (M365 Developer tenant + ServiceNow PDI), never against real company data.
- **Identity model revised (see §5, which supersedes §2’s service-account note):** the app acts as the **signed-in IT agent** (delegated), not a tenant-wide service account. Each agent connects **their own** Outlook inbox; ServiceNow is **view-all, act-on-assigned**; sending is **human-in-the-loop** (no auto-send).

-----

## 1. Source adapters (supersedes “Integration status” in spec Part 1)

Generalize the ticket adapter into a single **source adapter interface** covering tickets and email (chat stubbed). The drafting/memory engine depends only on this interface and the neutral `Ticket` model.

| Source | Role | Status | Notes |
|---|---|---|---|
| Manual / paste-in | fallback | **Phase 1 (build now)** | Zero-access default; already specified |
| ServiceNow | primary ticket source | **Phase 2** | REST Table API; read-only via integration account + read role |
| Outlook (MS Graph `Mail.Read`) | secondary source | **Phase 2** | Reads the IT mailbox (see §5 — per-agent delegated) |
| Zendesk | — | **Do not build** | Being retired |
| Teams | — | **Stub only, deferred** | Protected APIs; admin + Microsoft approval; low signal |

**Read vs. send:** everything above is **read-only**. Sending replies is a separate, later, higher-trust grant — not in Phase 1 or early Phase 2.

**Phase 1 action:** no live connectors. Make the adapter interface general enough to add `ServiceNowAdapter` and `OutlookAdapter` later without touching the engine. Rename/generalize the interface now while it’s cheap.

-----

## 2. Auth model — app users (clarifies spec Part 1 “multi-user”)

> The *data-access* half (tenant-wide service account) is **superseded by §5** (delegated, per-agent). The “two distinct logins” point and the privacy guardrail still hold.

- **App users = the IT support team only.** Regular Tricon employees never log into TRICON IT HUB. Keep `User` roles `ADMIN`/`AGENT`.
- **Privacy guardrail:** the app reads **shared support sources only** — never individual employees’ private mailboxes.

-----

## 3. Development & test environment (new — for Phase 2)

- **Microsoft 365 Developer tenant** (free) — register the app, grant `Mail.Read`, test on seeded mailbox data.
- **ServiceNow Personal Developer Instance (PDI)** — build/test the ServiceNow adapter.
- **Hard rule:** dev/test data and Tricon data stay completely separate.

**Phase 1 action:** none. Phase 2 wires adapters to dev instances first (env-driven base URLs/credentials).

-----

## 4. Admin request list (for later — not a build task)

All scopes **delegated** (per agent): 1) ServiceNow read → write on assigned; 2) Outlook delegated `Mail.Read` (own inbox); 3) Outlook delegated `Mail.Send`; 4) Teams (only if needed).

-----

## What has NOT changed

- Phase 1 scope, build order, schema, seed data, acceptance criteria — build as written (plus §6).
- Memory (audit log + pgvector), data governance, multi-user-from-day-one — unchanged.
- Part 6 backlog still applies; Phase 2 line refined (ServiceNow + Outlook live, Teams deferred).

-----

## 5. Identity, scope & send model (REVISED — supersedes §2’s service-account note)

The app acts as the **signed-in IT agent (delegated identity)**, not a tenant-wide service account.

- **Outlook — per-agent, own inbox only.** Each agent connects their own mailbox via delegated Graph scopes. Never a colleague’s, never org-wide.
- **ServiceNow — view all, act on assigned.** Read all tickets; write (reply/note/status) only on tickets assigned to the current agent — enforce as an explicit app rule, not UI-only. Draft anywhere; **Send** enabled only on assigned. Allow self-assign/claim to unlock reply.
- **Sending is real + human-in-the-loop.** Send makes a real API call (posts to Outlook + ServiceNow, stamped as the agent). **No auto-send.** Flow: AI drafts → agent reviews/edits → agent presses Send. Auto-send deferred.
- **Memory & KB stay team-shared.** Actions are per-agent; knowledge is shared. **Knowledge is shared; actions are owned.** Do not silo memory per user.
- **Permission ladder:** Read → Write/Send → Auto-send (much later).

**Phase 1 action:** respect the seams — the source-adapter interface must carry **the acting agent’s identity/credentials per request**, and **every write/action is audited to the acting user** (`AuditLog.userId` always populated on mutations).

-----

## 6. Inventory upgrade — per-item accountability + procurement (PROMOTED INTO PHASE 1)

Inventory is now **top priority**: full chain-of-custody asset tracking + procurement ingestion. Real on-site finding: across ~10 sites, peripherals go missing with no record of who holds what. Fix that.

### 6a. Track every item individually (incl. peripherals)
Every physical item is its own `Device` with its own serial — incl. monitors, keyboards, mice, docks, headsets, webcams, cables, adapters.
- Extend `DeviceType`: add `KEYBOARD, MOUSE, WEBCAM, CABLE, ADAPTER` (MONITOR/DOCK/HEADSET already exist).
- Extend `DeviceStatus`: add `MISSING, MISPLACED, OFFSITE`.
- Add `Device` provenance: `purchaseCost Decimal?`, `purchaseDate DateTime?`, `purchaseLocationId String?` (Building), `invoiceLineItemId String?`.

### 6b. Per-person kit + per-item history
- Per-person kit on Staff detail (current holdings with serial + date).
- Expected vs. actual via role kit (extend `RoleDeviceProfile` to include peripherals — enum extension is enough).
- Per-item custody trail on Device detail (full holder history from `DeviceAssignment`).

### 6c. Site audit mode
New models `SiteAudit` + `SiteAuditEntry` (the spec named it `AuditEntry`; renamed to avoid collision with `AuditLog`). Pick a building → list what should be there → check off found → flag discrepancies and update device statuses (MISSING/MISPLACED).

### 6d. Procurement / invoice ingestion (CDW)
New “Procurement” section: upload quotes/receipts/invoices → store file → (later) AI extracts line items **incl. serial numbers** → human review → create `Device` per item tagged to destination site.
- New models `PurchaseDoc` + `InvoiceLineItem`; enums `DocType {QUOTE,RECEIPT,INVOICE}`, `InvoiceStatus {UPLOADED,EXTRACTED,REVIEWED,PROCESSED}`.
- **Human-in-the-loop:** never auto-create from extraction; agent confirms SNs first.

### Build sequence (after existing Inventory step 7)
1. Schema deltas (enums + Device provenance + role kits).
2. Per-person kit view + per-item custody trail + expected-vs-actual.
3. Site audit mode.
4. Procurement: upload + file storage + **manual** line-item entry first.
5. Procurement: **AI extraction** of line items + serials (key-dependent fast-follow).
Ship 1–4 in Phase 1; 5 lands as fast-follow. Manual path is useful day one.

### Future link
Provenance + serial data is exactly what later **syncs to ServiceNow CMDB** (Part 6 backlog).
