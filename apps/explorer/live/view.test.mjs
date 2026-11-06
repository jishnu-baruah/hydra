import { test } from "node:test";
import assert from "node:assert/strict";
import { describe } from "./view.js";

const NOW = 1_000_000;
const on = (over = {}) => ({
  on: true,
  domain: "app.example.com",
  app: "demo",
  startedAt: NOW - 60_000,
  expiresAt: NOW + 872_000,
  intervalMs: 5000,
  last: { at: NOW - 3000, verdict: "match", problems: [], scripts: 2, ms: 120 },
  ticks: [{ at: NOW - 8000, verdict: "match" }, { at: NOW - 3000, verdict: "match" }],
  flips: [],
  stoppedBecause: null,
  ...over,
});

test("off is said plainly, with the reason when it stopped by itself", () => {
  const v = describe({ on: false, domain: null, last: null, ticks: [], flips: [], stoppedBecause: null }, NOW);
  assert.equal(v.tone, "off");
  assert.match(v.headline, /not watching/i);
  const t = describe({ on: false, domain: "a.example.com", last: null, ticks: [], flips: [], stoppedBecause: "the 15 minute time limit was reached" }, NOW);
  assert.match(t.detail, /time limit/);
});

test("a match is worded as matching the team's release, never as safe", () => {
  const v = describe(on(), NOW);
  assert.equal(v.tone, "match");
  assert.match(v.headline, /matches the team's release/i);
  assert.match(v.detail, /not that the build is safe/i);
  assert.equal(v.checked, "checked 3 s ago");
  assert.equal(v.remaining, "14 min 32 s left");
});

test("a mismatch names the problems and tells the visitor what to do", () => {
  const v = describe(on({ last: { at: NOW - 1000, verdict: "mismatch", problems: ["CHANGED /app.js"], scripts: 2, ms: 90 } }), NOW);
  assert.equal(v.tone, "mismatch");
  assert.match(v.headline, /differs from the release/i);
  assert.deepEqual(v.problems, ["CHANGED /app.js"]);
  assert.match(v.detail, /do not sign/i);
});

test("unreachable is grey and does not claim a verdict", () => {
  const v = describe(on({ last: { at: NOW - 1000, verdict: "unreachable", problems: ["UNREACHABLE HTTP 500"], scripts: 0, ms: 4000 } }), NOW);
  assert.equal(v.tone, "unknown");
  assert.match(v.headline, /can't reach/i);
});

test("ticks become a strip of at most 30 squares, newest last", () => {
  const ticks = Array.from({ length: 40 }, (_, i) => ({ at: NOW - (40 - i) * 5000, verdict: i === 39 ? "mismatch" : "match" }));
  const v = describe(on({ ticks }), NOW);
  assert.equal(v.strip.length, 30);
  assert.equal(v.strip.at(-1), "mismatch");
});

test("flips say what changed and where the alert stands", () => {
  const flips = [
    { at: NOW - 20_000, from: "match", to: "mismatch", alert: "done" },
    { at: NOW - 10_000, from: "mismatch", to: "match", alert: "pending" },
    { at: NOW - 5_000, from: "match", to: "mismatch", alert: "failed", note: "arkiv down" },
  ];
  const v = describe(on({ flips }), NOW);
  assert.equal(v.events.length, 3);
  // newest first
  assert.match(v.events[0], /matches to differs.*alert failed.*arkiv down/i);
  assert.match(v.events[1], /differs to matches.*alert sending/i);
  assert.match(v.events[2], /matches to differs.*alert sent/i);
});

test("no remaining time is shown when it is off", () => {
  assert.equal(describe({ on: false, domain: null, last: null, ticks: [], flips: [], stoppedBecause: null }, NOW).remaining, "");
});
