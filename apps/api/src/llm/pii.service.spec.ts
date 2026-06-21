import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigService } from "@nestjs/config";
import { PiiService } from "./pii.service";

const cfg = (val?: string) => ({ get: () => val }) as unknown as ConfigService;

test("pseudonymize masks known names and rehydrate restores them", () => {
  const pii = new PiiService(cfg());
  const { text, map } = pii.pseudonymize("Please help Jane Doe and John Smith", [
    "Jane Doe",
    "John Smith",
  ]);
  assert.ok(!text.includes("Jane Doe"), "name should be masked");
  assert.ok(!text.includes("John Smith"), "name should be masked");
  assert.match(text, /\[\[PERSON_\d+\]\]/);
  assert.equal(pii.rehydrate(text, map), "Please help Jane Doe and John Smith");
});

test("longer names win over bare first names, round-trips cleanly", () => {
  const pii = new PiiService(cfg());
  const { text, map } = pii.pseudonymize("Jane and Jane Doe are here", ["Jane", "Jane Doe"]);
  assert.ok(!text.includes("Jane Doe"));
  assert.equal(pii.rehydrate(text, map), "Jane and Jane Doe are here");
});

test("names not present don't burn tokens", () => {
  const pii = new PiiService(cfg());
  const { map } = pii.pseudonymize("just hardware here", ["Jane Doe"]);
  assert.deepEqual(map, {});
});

test("disabled (PII_PSEUDONYMIZE=false) is a transparent passthrough", () => {
  const pii = new PiiService(cfg("false"));
  const { text, map } = pii.pseudonymize("Jane Doe", ["Jane Doe"]);
  assert.equal(text, "Jane Doe");
  assert.deepEqual(map, {});
});
