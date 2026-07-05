import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSegmentKind, heuristicClassify } from "./intake.service";

test("detectSegmentKind recognizes a ticket-shaped paragraph", () => {
  assert.equal(detectSegmentKind("The printer on the 3rd floor is broken and won't print anything."), "TICKET");
});

test("detectSegmentKind recognizes a new-hire paragraph", () => {
  assert.equal(detectSegmentKind("Please onboard our new hire, starting Monday as Leasing Consultant."), "NEW_HIRE");
});

test("detectSegmentKind recognizes a device-shaped paragraph", () => {
  assert.equal(detectSegmentKind("Dell Latitude laptop S/N: ABC123 asset: LAP-01"), "DEVICES");
});

test("detectSegmentKind recognizes an invoice-shaped paragraph", () => {
  assert.equal(detectSegmentKind("Invoice #INV-1 — total $349.00, PO# 4471"), "INVOICE");
});

test("detectSegmentKind recognizes a task-shaped paragraph", () => {
  assert.equal(detectSegmentKind("Reminder: need to order more HDMI cables, don't forget."), "TASK");
});

test("heuristicClassify splits genuinely mixed content into separate segments", () => {
  const text = [
    "Our new hire Marcus starts Monday as Maintenance Tech at Birch House.",
    "",
    "The printer on the 3rd floor at Cedar Court is broken and won't print anything.",
  ].join("\n");
  const segments = heuristicClassify(text);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.kind, "NEW_HIRE");
  assert.equal(segments[1]!.kind, "TICKET");
});

test("heuristicClassify merges adjacent same-kind paragraphs into one segment", () => {
  const text = [
    "Please onboard our new hire.",
    "",
    "Name: Priya Anand, starting Monday as Leasing Consultant.",
  ].join("\n");
  const segments = heuristicClassify(text);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.kind, "NEW_HIRE");
  assert.match(segments[0]!.text, /Priya Anand/);
});

test("heuristicClassify falls back to the whole text as one segment with no blank lines", () => {
  const segments = heuristicClassify("Dell Latitude laptop S/N: ABC123");
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.kind, "DEVICES");
});
