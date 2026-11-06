import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, timeline, only, EMPTY } from "./events.js";

const row = ($key, attrs) => ({ $key, $attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])) });
const hex = (o) => "0x" + Buffer.from(JSON.stringify(o)).toString("hex");
const H = (c) => `sha256-${c.repeat(64)}`;

const releases = [
  row("0xr1", { app: "demo-dex", version: "1.0.0", commit: "abc1234def", file_count: 4n, published_at: 1000n }),
  row("0xr2", { app: "demo-dex", version: "1.1.0", commit: "fff9999", file_count: 5n, published_at: 4000n }),
];
const obs = [
  row("0xo1", { domain: "app.demo.xyz", app: "demo", status: "match", observed_at: 2000n, scripts_hash: H("a"), body: hex({ scripts: [{ url: "u", sha256: "x" }], problems: [], changed: false }) }),
  row("0xo2", { domain: "app.demo.xyz", app: "demo", status: "mismatch", observed_at: 3000n, scripts_hash: H("b"), body: hex({ scripts: [{ url: "u", sha256: "y" }], problems: ["CHANGED /app.js"], changed: false }) }),
  row("0xo3", { domain: "other.xyz", status: "unknown", observed_at: 2500n, scripts_hash: EMPTY, body: hex({ scripts: [], problems: ["UNREACHABLE HTTP 403"] }) }),
  row("0xo4", { domain: "other.xyz", status: "unknown", observed_at: 3500n, scripts_hash: EMPTY, body: "0xnothex" }),
];

test("decode reads a hex JSON body and returns null for anything else", () => {
  assert.deepEqual(decode(hex({ a: 1 })), { a: 1 });
  assert.equal(decode("0xnothex"), null);
  assert.equal(decode(undefined), null);
});

test("releases and observations mix, newest first", () => {
  const t = timeline(releases, obs);
  assert.deepEqual(t.map((e) => e.key), ["0xr2", "0xo4", "0xo2", "0xo3", "0xo1", "0xr1"]);
  assert.deepEqual(t[0], { kind: "release", key: "0xr2", at: 4000, app: "demo-dex", version: "1.1.0", commit: "fff9999", files: 5, ci: null });
});

test("a site's script set changing between 2 observations is a change, whatever the indexer said", () => {
  const t = timeline([], obs);
  const byKey = Object.fromEntries(t.map((e) => [e.key, e]));
  assert.equal(byKey["0xo1"].changed, false); // first sighting: nothing to compare with
  assert.equal(byKey["0xo2"].changed, true); // hash a -> b, though the body said false
  assert.equal(byKey["0xo4"].changed, false); // same (empty) hash as before
  assert.deepEqual(byKey["0xo2"].problems, ["CHANGED /app.js"]);
  assert.equal(byKey["0xo2"].scripts, 1);
});

test("an observation that saw no scripts says so", () => {
  const t = timeline([], obs);
  const o3 = t.find((e) => e.key === "0xo3");
  assert.equal(o3.empty, true);
  assert.equal(o3.scripts, 0);
  assert.equal(t.find((e) => e.key === "0xo1").empty, false);
  // An unreadable body still yields an event, with no script count.
  assert.equal(t.find((e) => e.key === "0xo4").scripts, null);
});

test("filters: releases, observed, and changes that matter", () => {
  // Natural churn: a site with no release whose script set moved. Observed, but not a change.
  const churn = [
    row("0xc1", { domain: "churn.xyz", status: "unknown", observed_at: 100n, scripts_hash: H("c") }),
    row("0xc2", { domain: "churn.xyz", status: "unknown", observed_at: 200n, scripts_hash: H("d") }),
  ];
  const t = timeline(releases, [...obs, ...churn]);
  assert.equal(t.find((e) => e.key === "0xc2").changed, true);
  assert.deepEqual(only(t, "releases").map((e) => e.key), ["0xr2", "0xr1"]);
  assert.equal(only(t, "observed").length, 6);
  assert.deepEqual(only(t, "changes").map((e) => e.key), ["0xo2"]);
  assert.equal(only(t, "all").length, 8);
});

test("app name claims join the feed, and a release links its CI run only when it is a GitHub Actions run", () => {
  const apps = [row("0xa1", { app: "demo-dex", publisher: "0xabc", created_at: 500n })];
  const rel = [
    row("0xr9", { app: "demo-dex", version: "2", commit: "c", file_count: 1n, published_at: 5000n, body: hex({ ci_run_url: "https://github.com/acme/demo/actions/runs/123" }) }),
    row("0xr8", { app: "demo-dex", version: "1", commit: "c", file_count: 1n, published_at: 4500n, body: hex({ ci_run_url: "javascript:alert(1)" }) }),
  ];
  const t = timeline(rel, [], apps);
  assert.deepEqual(t.map((e) => e.kind), ["release", "release", "claim"]);
  assert.deepEqual(t[2], { kind: "claim", key: "0xa1", at: 500, app: "demo-dex", publisher: "0xabc" });
  assert.equal(t[0].ci, "https://github.com/acme/demo/actions/runs/123");
  assert.equal(t[1].ci, null);
  assert.deepEqual(only(t, "releases").map((e) => e.kind), ["release", "release", "claim"]);
});

import { verdict, integratedOnly } from "./events.js";
const ob = (status, problems = [], extra = {}) => ({ kind: "observation", status, problems, changed: false, empty: false, ...extra });

test("verdict: match and a release are green", () => {
  assert.equal(verdict(ob("match")).level, "green");
  assert.equal(verdict({ kind: "release" }).level, "green");
});
test("verdict: a mismatch with a script in no release or a changed script is red", () => {
  assert.equal(verdict(ob("mismatch", ["EXTRA /evil.js"])).level, "red");
  assert.equal(verdict(ob("mismatch", ["CHANGED /app.js"])).level, "red");
  assert.equal(verdict(ob("mismatch")).level, "red");
});
test("verdict: a mismatch caused only by a runtime origin or unreachable site is yellow", () => {
  assert.equal(verdict(ob("mismatch", ["NEW_RUNTIME_ORIGIN https://x.io"])).level, "yellow");
  assert.equal(verdict(ob("mismatch", ["UNREACHABLE HTTP 429"], { empty: true })).level, "yellow");
  assert.equal(verdict(ob("mismatch", ["TRUNCATED 110 scripts, checked 60"])).level, "yellow");
});
test("verdict: unknown is yellow, with a label that says why", () => {
  assert.deepEqual(verdict(ob("unknown")), { level: "yellow", label: "Unknown" });
  assert.equal(verdict(ob("unknown", ["UNREACHABLE HTTP 403"], { empty: true })).label, "Unreachable");
  assert.equal(verdict(ob("unknown", [], { empty: true })).label, "Skipped");
});
test("verdict: a name claim is neutral", () => {
  assert.equal(verdict({ kind: "claim" }).level, "neutral");
});

test("integratedOnly keeps releases, claims and checks of sites ever compared with a release", () => {
  const ev = [
    { kind: "release", key: "r" },
    { kind: "claim", key: "c" },
    { kind: "observation", key: "1", domain: "bound.app", status: "unknown" },
    { kind: "observation", key: "2", domain: "bound.app", status: "match" },
    { kind: "observation", key: "3", domain: "coverage.xyz", status: "unknown" },
  ];
  assert.deepEqual(integratedOnly(ev).map((e) => e.key), ["r", "c", "1", "2"]);
  assert.deepEqual(integratedOnly([]), []);
});
