import { test } from "node:test";
import assert from "node:assert/strict";
import { hostOf, lookups, search } from "./search.js";

const HEX = "a".repeat(64);
const SWARM = "b".repeat(64);

// A fake Arkiv: rows shaped like the SDK's schemaless select, { $key, $attributes: { f: { value } } }.
const rows = {
  "hydra.app": [{ $key: "0x01", $attributes: { app: { value: "demo-dex" }, domain: { value: "app.demo.xyz" } } }],
  "hydra.release": [{ $key: "0x02", $attributes: { app: { value: "demo-dex" }, swarm_ref: { value: SWARM } } }],
  "hydra.file": [{ $key: "0x03", $attributes: { app: { value: "demo-dex" }, sha256: { value: `sha256-${HEX}` } } }],
};
const find = async (schema, field, value) =>
  (rows[schema] ?? []).filter((r) => r.$attributes[field]?.value === value);

test("each input kind becomes the right lookups", () => {
  assert.deepEqual(lookups("  "), []);
  // A URL names a site, which search() resolves through the domain lookup, not an Arkiv column.
  assert.deepEqual(lookups("https://App.Demo.xyz/swap?x=1"), []);
  // A dotted word may be a domain or an app name; the app-name lookup is still asked.
  assert.deepEqual(lookups("swap.v2"), [{ schema: "hydra.app", field: "app", value: "swap.v2", via: "app name" }]);
  assert.deepEqual(lookups("demo-dex"), [{ schema: "hydra.app", field: "app", value: "demo-dex", via: "app name" }]);
  // Typed case and lower case are both asked, since app ids are usually lower case.
  assert.deepEqual(lookups("Demo-Dex"), [
    { schema: "hydra.app", field: "app", value: "Demo-Dex", via: "app name" },
    { schema: "hydra.app", field: "app", value: "demo-dex", via: "app name" },
  ]);
  assert.deepEqual(lookups(`SHA256-${HEX.toUpperCase()}`), [
    { schema: "hydra.file", field: "sha256", value: `sha256-${HEX}`, via: "file sha256" },
  ]);
  // Bare 64 hex is either a file hash or a Swarm reference, so both are asked.
  assert.deepEqual(lookups(HEX), [
    { schema: "hydra.file", field: "sha256", value: `sha256-${HEX}`, via: "file sha256" },
    { schema: "hydra.release", field: "swarm_ref", value: HEX, via: "Swarm reference" },
  ]);
});

test("all 5 kinds find the same app", async () => {
  const extra = { appForDomain: async (host) => (host === "app.demo.xyz" ? "demo-dex" : null) };
  for (const q of ["app.demo.xyz", "https://App.Demo.xyz/swap?x=1", "demo-dex", "Demo-Dex", `sha256-${HEX}`, SWARM]) {
    const hits = await search(q, find, extra);
    assert.deepEqual(hits.map((h) => h.app), ["demo-dex"], q);
  }
  const byDomain = await search("app.demo.xyz", find, extra);
  assert.equal(byDomain[0].via, "domain");
});

test("hostOf names the site in a URL or a dotted word, and nothing else", () => {
  assert.equal(hostOf("https://App.Demo.xyz/swap?x=1"), "app.demo.xyz");
  assert.equal(hostOf("swap.v2"), "swap.v2");
  assert.equal(hostOf("demo-dex"), null);
  assert.equal(hostOf(HEX), null);
  assert.equal(hostOf(`sha256-${HEX}`), null);
  assert.equal(hostOf("  "), null);
});

test("a site nobody published but the indexer watches is a site hit, not a miss", async () => {
  const extra = { appForDomain: async () => null, observed: async (host) => host === "app.uniswap.org" };
  assert.deepEqual(await search("app.uniswap.org", find, extra), [{ site: "app.uniswap.org", via: "domain", observed: true }]);
  assert.deepEqual(await search("nobody.example", find, extra), []);
});

test("a failing domain lookup does not hide the other results", async () => {
  const extra = { appForDomain: async () => { throw new Error("api down"); }, observed: async () => { throw new Error("rpc"); } };
  assert.deepEqual((await search("demo-dex", find, extra)).map((h) => h.app), ["demo-dex"]);
  assert.deepEqual(await search("app.demo.xyz", find, extra), []);
});

test("no match is an empty list, not an error", async () => {
  assert.deepEqual(await search("nobody.example", find), []);
});

// The verdict card a domain search opens with, from the API's domain lookup and the indexer's newest
// observation. It must never call a site safe without a match, and never stay quiet on a mismatch.
import { siteVerdict } from "./search.js";
const obs = (status, app, observedAt) => [{ $attributes: { status: { value: status }, app: { value: app }, observed_at: { value: observedAt } } }];
const NOW = 1_800_000_000_000;

test("a matching site is good to go, a mismatching one is a warning", () => {
  const ok = siteVerdict({ host: "app.demo.xyz", app: "demo-dex", rows: obs("match", "demo-dex", NOW - 5 * 60_000), now: NOW });
  assert.equal(ok.kind, "safe");
  assert.match(ok.title, /good to go/i);
  assert.match(ok.text, /demo-dex/);
  assert.match(ok.when, /5 min ago/);
  const bad = siteVerdict({ host: "app.demo.xyz", app: "demo-dex", rows: obs("mismatch", "demo-dex", NOW - 2 * 3_600_000), now: NOW });
  assert.equal(bad.kind, "danger");
  assert.match(bad.title, /do not/i);
  assert.match(bad.text, /wallet/);
  assert.match(bad.when, /2 h ago/);
});

test("no match means no green: published but unchecked, watched but unpublished, unknown", () => {
  const pending = siteVerdict({ host: "a.xyz", app: "demo-dex", rows: [], now: NOW });
  assert.equal(pending.kind, "pending");
  // An observation recorded for another app belongs to that app: the domain was re-bound.
  assert.equal(siteVerdict({ host: "a.xyz", app: "demo-dex", rows: obs("match", "other", NOW), now: NOW }).kind, "pending");
  assert.equal(siteVerdict({ host: "a.xyz", app: null, rows: obs("unknown", "", NOW), now: NOW }).kind, "unverified");
  // The API unreachable: the indexer's own observation names the app, so its match still counts.
  assert.equal(siteVerdict({ host: "a.xyz", app: null, rows: obs("match", "demo-dex", NOW), now: NOW }).kind, "safe");
  assert.equal(siteVerdict({ host: "a.xyz", app: null, rows: [], now: NOW }).kind, "unverified");
  for (const v of [pending, siteVerdict({ host: "a.xyz", app: null, rows: [], now: NOW })]) assert.doesNotMatch(v.title, /good to go/i);
});
