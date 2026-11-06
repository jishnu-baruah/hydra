import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerOf, trustedReleases, swarmUrl } from "./releases.js";

// Rows as a schemaless Arkiv select returns them: { $key, $attributes: { name: { value } } }.
const row = ($key, attrs) => ({ $key, $attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])) });
const REF = "c".repeat(64);
const OWNER = "0xAAAA000000000000000000000000000000000001";
const SQUAT = "0xbbbb000000000000000000000000000000000002";

const apps = [
  row("0xa2", { app: "demo-dex", publisher: SQUAT.toLowerCase(), created_at: 2000n }),
  row("0xa1", { app: "demo-dex", publisher: OWNER.toLowerCase(), created_at: 1000n }),
];
const releases = [
  row("0xr1", { app: "demo-dex", publisher: OWNER, version: "1.0.0", commit: "abc1234", swarm_ref: REF, file_count: 4n, published_at: 1730800000000n }),
  row("0xr2", { app: "demo-dex", publisher: OWNER, version: "1.1.0", commit: "def5678", swarm_ref: "pending", file_count: 5n, published_at: 1730900000000n }),
  row("0xr3", { app: "demo-dex", publisher: SQUAT, version: "6.6.6", commit: "evil000", swarm_ref: REF, file_count: 1n, published_at: 1731000000000n }),
];

test("the earliest app record names the owner", () => {
  assert.equal(ownerOf(apps), OWNER.toLowerCase());
  assert.equal(ownerOf([]), null);
});

test("only the owner's releases, newest first", () => {
  const out = trustedReleases(apps, releases);
  assert.deepEqual(out.map((r) => r.version), ["1.1.0", "1.0.0"]);
  assert.deepEqual(out[1], {
    key: "0xr1",
    version: "1.0.0",
    commit: "abc1234",
    publishedAt: 1730800000000,
    fileCount: 4,
    swarmRef: REF,
    swarmUrl: `https://download.gateway.ethswarm.org/bzz/${REF}/hydra-manifest.json`,
  });
});

test("an app nobody published has no trusted releases", () => {
  assert.deepEqual(trustedReleases([], releases), []);
});

test("a Swarm link only for a real reference", () => {
  assert.equal(swarmUrl("pending"), null);
  assert.equal(swarmUrl("x".repeat(64)), null);
  assert.ok(swarmUrl("d".repeat(128)).endsWith("/hydra-manifest.json"));
});
