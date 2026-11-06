import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.chrome = { storage: { local: { get: async () => ({}) } } };
const { appForDomain } = await import("./lookup.js");

const reply = (status, body) => async (url) => ((globalThis.lastUrl = String(url)), new Response(JSON.stringify(body), { status }));

test("the API names the app for a hostname", async () => {
  globalThis.fetch = reply(200, { domain: "app.example.com", app: "alpha" });
  assert.equal(await appForDomain("app.example.com"), "alpha");
  assert.match(globalThis.lastUrl, /\/v1\/domains\/app\.example\.com$/);
});

test("no app on record gives null", async () => {
  globalThis.fetch = reply(200, { domain: "x.example.com", app: null });
  assert.equal(await appForDomain("x.example.com"), null);
});

test("an older API without the route, or a network failure, falls back to null instead of throwing", async () => {
  globalThis.fetch = reply(404, { error: "not found" });
  assert.equal(await appForDomain("app.example.com"), null);
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await appForDomain("app.example.com"), null);
});

test("a hostname that is not a plain hostname is never sent", async () => {
  globalThis.lastUrl = "";
  globalThis.fetch = reply(200, { app: "evil" });
  for (const h of ["", "localhost", "a/b", "a b.com", "app.example.com:8080", "x.com?y=1", "ab-.com", "-ab.com", "a".repeat(64) + ".com"]) assert.equal(await appForDomain(h), null, h);
  assert.equal(globalThis.lastUrl, "");
});
