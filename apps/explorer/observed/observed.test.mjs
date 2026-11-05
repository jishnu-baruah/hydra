import { test } from "node:test";
import assert from "node:assert/strict";
import { sites } from "./observed.js";

// Observation events as events.js timeline() returns them, newest first.
const ev = (key, domain, at, status, extra = {}) => ({ kind: "observation", key, at, domain, label: domain.split(".")[0], status, scripts: 3, problems: [], changed: false, empty: false, ...extra });
const events = [
  { kind: "release", key: "0xr", at: 900, app: "demo-dex", version: "1", commit: "c", files: 1 },
  ev("0x6", "b-site.xyz", 600, "unknown", { changed: true }),
  ev("0x5", "a-site.xyz", 500, "unknown"),
  ev("0x4", "c-site.xyz", 400, "mismatch", { problems: ["CHANGED /app.js"] }),
  ev("0x3", "b-site.xyz", 300, "unknown"),
  ev("0x2", "a-site.xyz", 200, "unknown", { changed: true }),
  ev("0x1", "c-site.xyz", 100, "match"),
];

test("1 entry per observed site, mismatches first, then by domain", () => {
  assert.deepEqual(sites(events).map((s) => s.domain), ["c-site.xyz", "a-site.xyz", "b-site.xyz"]);
});

test("each entry carries the latest observation, the run count and the change count", () => {
  const a = sites(events).find((s) => s.domain === "a-site.xyz");
  assert.equal(a.latest.key, "0x5");
  assert.equal(a.status, "unknown");
  assert.equal(a.runs, 2);
  assert.equal(a.changes, 1);
  assert.equal(a.lastSeen, 500);
});

test("a site with no release is labelled observed, not published by the team", () => {
  const all = sites(events);
  assert.equal(all.find((s) => s.domain === "a-site.xyz").published, false);
  // A match or a mismatch means the indexer compared it with a release, so it is published.
  assert.equal(all.find((s) => s.domain === "c-site.xyz").published, true);
});

test("no observations, no sites", () => {
  assert.deepEqual(sites([{ kind: "release", key: "0xr", at: 1 }]), []);
});
