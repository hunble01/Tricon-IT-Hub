import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * End-to-end check for the universal-intake feature against a running API
 * (AUTH_DISABLED dev mode). Exercises the real chain: classify splits a mixed
 * paste into segments -> each segment's kind-specific extraction call
 * resolves real data -> each kind's commit path actually creates rows.
 * Skips cleanly when no server is reachable, so `pnpm test` stays green
 * in any environment.
 */

const BASE = (process.env.API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
};

test("universal intake: mixed paste splits into segments and routes to the right systems", async (t) => {
  const reachable = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  if (!reachable) return t.skip(`no API server reachable at ${BASE}`);

  const roles = await api("/roles");
  const buildings = await api("/buildings");
  assert.ok(roles.length > 0 && buildings.length > 0, "seed data must have at least one role/building");
  const role = roles[0];
  const building = buildings[0];

  const mixedText =
    `Name: E2E Testperson\nRole: ${role.title}\nBuilding: ${building.name}\nStart date: 2026-08-03\n\n` +
    `The printer on the 3rd floor is broken and won't print anything.`;

  // 1. Classify splits the mixed paste into exactly two segments of the right kinds.
  const classified = await api("/intake/classify", { method: "POST", body: JSON.stringify({ rawText: mixedText }) });
  assert.equal(classified.segments.length, 2, "mixed paste should split into two segments");
  const hireSeg = classified.segments.find((s: { kind: string }) => s.kind === "NEW_HIRE");
  const ticketSeg = classified.segments.find((s: { kind: string }) => s.kind === "TICKET");
  assert.ok(hireSeg, "one segment should classify as NEW_HIRE");
  assert.ok(ticketSeg, "one segment should classify as TICKET");

  // 2. Per-segment extraction resolves real role/building ids for the hire segment.
  const analyzed = await api("/intake/analyze", {
    method: "POST",
    body: JSON.stringify({ rawText: hireSeg.text, hint: "NEW_HIRE" }),
  });
  assert.equal(analyzed.newHires.length, 1);
  assert.equal(analyzed.newHires[0].fullName, "E2E Testperson");
  assert.equal(analyzed.newHires[0].roleId, role.id, "role should resolve to the real role id");
  assert.equal(analyzed.newHires[0].buildingId, building.id, "building should resolve to the real building id");

  // 3. Ticket segment previews without creating anything (no id on the response).
  const preview = await api("/tickets/preview", { method: "POST", body: JSON.stringify({ rawText: ticketSeg.text }) });
  assert.ok(!("id" in preview), "preview must not create a ticket");
  assert.match(preview.subject, /printer/i);

  // 4. Commit the hire segment through /intake/commit -> a real Onboarding is created.
  const committed = await api("/intake/commit", {
    method: "POST",
    body: JSON.stringify({
      newHires: [{ fullName: analyzed.newHires[0].fullName, roleId: role.id, buildingId: building.id }],
    }),
  });
  assert.equal(committed.onboardings, 1);
  assert.equal(committed.errors.length, 0);

  // 5. Commit the ticket segment through /tickets/draft -> a real Ticket is created,
  //    auto-prioritized HIGH by the "broken" keyword.
  const ticket = await api("/tickets/draft", {
    method: "POST",
    body: JSON.stringify({ subject: preview.subject, body: preview.body }),
  });
  assert.equal(ticket.status, "OPEN");
  assert.equal(ticket.priority, "HIGH");
});

test("universal intake: invoice segment orchestrates create -> line-items -> process", async (t) => {
  const reachable = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  if (!reachable) return t.skip(`no API server reachable at ${BASE}`);

  const extracted = await api("/procurement/extract", {
    method: "POST",
    body: JSON.stringify({ rawText: "Logitech MX Master 3 mouse qty 2 $79.99" }),
  });
  assert.ok(extracted.items.length > 0, "at least one line item should be extracted");

  const doc = await api("/procurement", { method: "POST", body: JSON.stringify({ docType: "INVOICE", vendor: "E2E Vendor" }) });
  assert.ok(doc.id);

  await api(`/procurement/${doc.id}/line-items`, {
    method: "POST",
    body: JSON.stringify({ lineItems: extracted.items }),
  });

  const processed = await api(`/procurement/${doc.id}/process`, { method: "POST" });
  assert.ok(processed.devicesCreated >= 2, "processing should create a device per unit (qty 2)");
});
