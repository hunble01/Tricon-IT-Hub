import assert from "node:assert/strict";
import { test } from "node:test";
import { NameMasker, parsePlan } from "./planner";

test("parsePlan extracts a JSON plan from chatty text", () => {
  const p = parsePlan('Sure thing! {"reply":"hi","tool":null,"confirm":false} hope that helps');
  assert.equal(p.reply, "hi");
  assert.equal(p.tool, null);
});

test("parsePlan returns a tool call when present", () => {
  const p = parsePlan('{"reply":null,"tool":{"name":"search_staff","args":{"query":"Jane"}},"confirm":false}');
  assert.equal(p.tool?.name, "search_staff");
  assert.deepEqual(p.tool?.args, { query: "Jane" });
});

test("parsePlan falls back to plain text when there's no JSON", () => {
  const p = parsePlan("no json here");
  assert.equal(p.tool, null);
  assert.equal(p.reply, "no json here");
});

test("NameMasker gives a person the same token across turns", () => {
  const m = new NameMasker(["Jane Doe", "John Smith"], true);
  const t1 = m.mask("assign a laptop to Jane Doe");
  const t2 = m.mask("now email Jane Doe again");
  const tok = t1.match(/\[\[PERSON_\d+\]\]/)?.[0];
  assert.ok(tok, "a token should be produced");
  assert.ok(t2.includes(tok!), "same person reuses the same token");
  assert.equal(m.unmask(t1), "assign a laptop to Jane Doe");
});

test("NameMasker disabled is a passthrough", () => {
  const m = new NameMasker(["Jane Doe"], false);
  assert.equal(m.mask("hi Jane Doe"), "hi Jane Doe");
});

test("unmaskArgs rehydrates string args but leaves non-strings", () => {
  const m = new NameMasker(["Jane Doe"], true);
  const masked = m.mask("Jane Doe");
  const out = m.unmaskArgs({ query: masked, limit: 5 });
  assert.equal(out.query, "Jane Doe");
  assert.equal(out.limit, 5);
});
