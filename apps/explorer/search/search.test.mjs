import { test } from "node:test";
import assert from "node:assert/strict";
import { lookups, search } from "./search.js";

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
  assert.deepEqual(lookups("https://App.Demo.xyz/swap?x=1"), [
    { schema: "hydra.app", field: "domain", value: "app.demo.xyz", via: "domain" },
  ]);
  assert.deepEqual(lookups("demo-dex"), [{ schema: "hydra.app", field: "app", value: "demo-dex", via: "app name" }]);
  assert.deepEqual(lookups(`SHA256-${HEX.toUpperCase()}`), [
    { schema: "hydra.file", field: "sha256", value: `sha256-${HEX}`, via: "file sha256" },
  ]);
  // Bare 64 hex is either a file hash or a Swarm reference, so both are asked.
  assert.deepEqual(lookups(HEX), [
    { schema: "hydra.file", field: "sha256", value: `sha256-${HEX}`, via: "file sha256" },
    { schema: "hydra.release", field: "swarm_ref", value: HEX, via: "Swarm reference" },
  ]);
});

test("all 4 kinds find the same app", async () => {
  for (const q of ["app.demo.xyz", "demo-dex", `sha256-${HEX}`, SWARM]) {
    const hits = await search(q, find);
    assert.deepEqual(hits.map((h) => h.app), ["demo-dex"], q);
  }
});

test("no match is an empty list, not an error", async () => {
  assert.deepEqual(await search("nobody.example", find), []);
});
