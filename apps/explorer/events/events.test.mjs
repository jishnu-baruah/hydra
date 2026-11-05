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
  assert.deepEqual(t[0], { kind: "release", key: "0xr2", at: 4000, app: "demo-dex", version: "1.1.0", commit: "fff9999", files: 5 });
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

test("filters: releases, observed, and changes (a change or a mismatch)", () => {
  const t = timeline(releases, obs);
  assert.deepEqual(only(t, "releases").map((e) => e.key), ["0xr2", "0xr1"]);
  assert.equal(only(t, "observed").length, 4);
  assert.deepEqual(only(t, "changes").map((e) => e.key), ["0xo2"]);
  assert.equal(only(t, "all").length, 6);
});
