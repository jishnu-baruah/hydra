import { test } from "node:test";
import assert from "node:assert/strict";
import { listedHost, matchHost, parseList } from "./blocklist.js";

const make = (black, white = []) => ({ black: new Set(black), white: new Set(white) });

test("a hostname, its subdomains and nothing else match a listed domain", () => {
  const l = make(["evil.example"]);
  assert.equal(matchHost("evil.example", l), "evil.example");
  assert.equal(matchHost("EVIL.example.", l), "evil.example"); // case and a trailing dot
  assert.equal(matchHost("claim.app.evil.example", l), "evil.example");
  assert.equal(matchHost("notevil.example", l), null);
  assert.equal(matchHost("evil.example.org", l), null);
  assert.equal(matchHost("example", l), null);
});

test("a bare TLD in the list never flags a whole TLD through the parent walk", () => {
  assert.equal(matchHost("anything.xyz", make(["xyz"])), null);
});

test("the allowlist wins over the blocklist, for a domain and its subdomains", () => {
  const l = make(["bad.example"], ["good.bad.example"]);
  assert.equal(matchHost("good.bad.example", l), null);
  assert.equal(matchHost("x.good.bad.example", l), null);
  assert.equal(matchHost("other.bad.example", l), "bad.example");
});

test("parseList keeps lower-cased strings and refuses a payload that is not a list", () => {
  assert.deepEqual(parseList({ blacklist: ["A.example", 7, "", "b.example"], whitelist: ["ok.example"] }, { min: 1 }), { black: ["a.example", "b.example"], white: ["ok.example"] });
  assert.equal(parseList(null, { min: 1 }), null);
  assert.equal(parseList({ blacklist: "x" }, { min: 1 }), null);
  assert.equal(parseList({ blacklist: ["a.example"] }, { min: 5 }), null); // too short: a truncated or empty answer must not wipe a good list
});

const store = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: data[k] }), set: async (o) => Object.assign(data, o) };
};
const feed = (body, calls) => async () => (calls.n++, new Response(JSON.stringify(body), { status: 200 }));
const BODY = { blacklist: ["evil.example"], whitelist: [] };
const DAY = 86_400_000;

test("the first lookup downloads the list, later ones use the stored copy", async () => {
  const calls = { n: 0 };
  const o = { fetch: feed(BODY, calls), storage: store(), now: () => 1000, min: 1 };
  assert.equal(await listedHost("a.evil.example", o), "evil.example");
  assert.equal(await listedHost("fine.example", o), null);
  assert.equal(calls.n, 1);
});

test("a copy older than a day is refreshed, and a failed refresh keeps the old copy", async () => {
  const calls = { n: 0 };
  const storage = store();
  let now = 1000;
  await listedHost("x.example", { fetch: feed(BODY, calls), storage, now: () => now, min: 1 });
  now += DAY + 1;
  const down = async () => (calls.n++, new Response("no", { status: 503 }));
  assert.equal(await listedHost("evil.example", { fetch: down, storage, now: () => now, min: 1 }), "evil.example"); // stale copy still answers
  assert.equal(calls.n, 2);
});

test("a copy that could not be refreshed for over 14 days is no longer trusted", async () => {
  const storage = store();
  let now = 1000;
  await listedHost("x.example", { fetch: feed(BODY, { n: 0 }), storage, now: () => now, min: 1 });
  const down = async () => new Response("no", { status: 503 });
  now += 13 * DAY;
  assert.equal(await listedHost("evil.example", { fetch: down, storage, now: () => now, min: 1 }), "evil.example"); // 13 days: still used
  now += 2 * DAY;
  assert.equal(await listedHost("evil.example", { fetch: down, storage, now: () => now, min: 1 }), null); // 15 days: dropped
});

test("entries that are not hostnames are dropped, and a list of junk fails the floor", () => {
  assert.deepEqual(parseList({ blacklist: ["ok.example", "has space.example", "path/x.example", "https://x.example", "UP.example"] }, { min: 1 }).black, ["ok.example", "up.example"]);
  assert.equal(parseList({ blacklist: ["a b", "c/d", "e?f"] }, { min: 1 }), null);
});

test("no copy and no network gives null, never an error", async () => {
  const boom = async () => {
    throw new Error("offline");
  };
  assert.equal(await listedHost("evil.example", { fetch: boom, storage: store(), now: () => 1, min: 1 }), null);
});

test("a junk or oversized answer does not replace the stored copy", async () => {
  const storage = store();
  let now = 1000;
  await listedHost("x.example", { fetch: feed(BODY, { n: 0 }), storage, now: () => now, min: 1 });
  now += DAY + 1;
  const junk = async () => new Response("<html>rate limited</html>", { status: 200 });
  assert.equal(await listedHost("evil.example", { fetch: junk, storage, now: () => now, min: 1 }), "evil.example");
  const huge = async () => new Response("x".repeat(100), { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } });
  now += DAY + 1;
  assert.equal(await listedHost("evil.example", { fetch: huge, storage, now: () => now, min: 1 }), "evil.example");
});
