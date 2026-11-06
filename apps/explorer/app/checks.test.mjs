import { test } from "node:test";
import assert from "node:assert/strict";
import { barModel, siteHistory, headline } from "./checks.js";

const h = (t, status) => ({ observed_at: t, status });

test("newest check is rightmost", () => {
  const m = barModel([h(300, "match"), h(200, "mismatch"), h(100, "match")]);
  assert.deepEqual(m.map((s) => s.at), [100, 200, 300]);
});
test("colour mapping: match green, mismatch red, anything else yellow", () => {
  const m = barModel([h(4, "match"), h(3, "mismatch"), h(2, "unreachable"), h(1, "weird")]);
  assert.deepEqual(m.map((s) => s.tone), ["unknown", "unknown", "mismatch", "match"]);
});
test("caps the count, keeping the newest", () => {
  const rows = Array.from({ length: 30 }, (_, i) => h(1000 - i, "match"));
  const m = barModel(rows, 12);
  assert.equal(m.length, 12);
  assert.equal(m.at(-1).at, 1000);
});
test("empty or bad input gives an empty bar", () => {
  assert.deepEqual(barModel([]), []);
  assert.deepEqual(barModel(undefined), []);
});
test("each square has a title with time and verdict", () => {
  const [s] = barModel([h(Date.UTC(2026, 10, 5, 12, 30), "mismatch")]);
  assert.match(s.title, /2026-11-05 12:30 UTC/);
  assert.match(s.title, /Differs from the release/);
});
test("siteHistory finds the domain in the API payload", () => {
  const p = { sites: [{ domain: "a.com", history: [h(1, "match")] }, { domain: "b.com", history: [] }] };
  assert.equal(siteHistory(p, "a.com").length, 1);
  assert.deepEqual(siteHistory(p, "zzz.com"), []);
  assert.deepEqual(siteHistory(null, "a.com"), []);
});
test("headline words the latest verdict with time since", () => {
  assert.equal(headline([h(1000, "match")], 31000), "Matches the release, checked 30 s ago");
  assert.equal(headline([h(1000, "mismatch")], 1000 + 120000), "Differs from the release, checked 2 min ago");
  assert.equal(headline([h(1000, "unknown")], 1000), "Not reachable, checked 0 s ago");
  assert.equal(headline([], 5), "Not checked yet");
});
