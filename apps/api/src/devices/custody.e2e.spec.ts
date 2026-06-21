import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * End-to-end custody-chain check against a running API (AUTH_DISABLED dev mode).
 * Exercises the inventory invariant: assigning a device opens a custody record
 * and flips status to ASSIGNED; returning it closes the record and returns the
 * unit to stock. Skips cleanly when no server is reachable, so `pnpm test`
 * stays green in any environment.
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

test("custody chain: assign opens a record + flips status, return closes it", async (t) => {
  const reachable = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  if (!reachable) return t.skip(`no API server reachable at ${BASE}`);

  {
    const device = await api("/devices", {
      method: "POST",
      body: JSON.stringify({ type: "LAPTOP", model: "Custody E2E Laptop" }),
    });
    const staff = await api("/staff", {
      method: "POST",
      body: JSON.stringify({ fullName: "Custody Testperson", source: "MANUAL" }),
    });

    // Assign.
    await api(`/devices/${device.id}/assign`, {
      method: "POST",
      body: JSON.stringify({ staffId: staff.id }),
    });
    let detail = await api(`/devices/${device.id}`);
    assert.equal(detail.status, "ASSIGNED", "status should be ASSIGNED after assign");
    const open = detail.assignments.find((a: { returnedAt: string | null }) => !a.returnedAt);
    assert.ok(open, "an open custody record should exist");
    assert.equal(open.staff.id, staff.id, "custody record points at the assignee");

    // Return. A direct return marks the unit RETURNED (awaiting inspection),
    // distinct from offboarding bulk-reclaim which sends it straight to IN_STOCK.
    await api(`/devices/${device.id}/return`, { method: "POST", body: JSON.stringify({}) });
    detail = await api(`/devices/${device.id}`);
    assert.equal(detail.status, "RETURNED", "status should be RETURNED after a direct return");
    assert.notEqual(detail.status, "ASSIGNED", "device must no longer be held");
    const stillOpen = detail.assignments.filter((a: { returnedAt: string | null }) => !a.returnedAt);
    assert.equal(stillOpen.length, 0, "no custody record should remain open");
    const closed = detail.assignments.find((a: { staff?: { id: string } }) => a.staff?.id === staff.id);
    assert.ok(closed?.returnedAt, "the custody record should be stamped returned");
  }
});
