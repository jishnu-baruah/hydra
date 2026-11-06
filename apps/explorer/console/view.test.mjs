import { test } from "node:test";
import assert from "node:assert/strict";
import { appCard, consoleRequest, rotateCommand, sessionLive, shortAddress, walletErrorText, apiErrorText, normalizeApps, toHex } from "./view.js";

test("shortAddress keeps both ends", () => {
  assert.equal(shortAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234...5678");
  assert.equal(shortAddress(""), "");
});

test("sessionLive: accepts ISO, seconds and ms; rejects past or junk", () => {
  const now = Date.parse("2026-11-07T10:00:00Z");
  assert.equal(sessionLive({ session: "hys_a", expires: "2026-11-07T11:00:00Z" }, now), true);
  assert.equal(sessionLive({ session: "hys_a", expires: "2026-11-07T09:00:00Z" }, now), false);
  assert.equal(sessionLive({ session: "hys_a", expires: Math.floor(now / 1000) + 60 }, now), true);
  assert.equal(sessionLive({ session: "hys_a", expires: now + 60000 }, now), true);
  assert.equal(sessionLive({ session: "bad", expires: now + 60000 }, now), false);
  assert.equal(sessionLive(null, now), false);
});

test("appCard: link, date, version, channel count", () => {
  const c = appCard({ app: "my app", created_at: "2026-11-05T08:00:00Z", key_version: 3, channels: [{}, {}] });
  assert.equal(c.href, "../app/?name=my%20app");
  assert.equal(c.claimed, "Claimed 2026-11-05");
  assert.equal(c.version, "Key version 3");
  assert.equal(c.count, "2 of 5 channels");
  assert.equal(appCard({ app: "x" }).claimed, "");
});

test("normalizeApps drops junk and defaults channels", () => {
  const a = normalizeApps({ apps: [{ app: "a" }, null, { nope: 1 }, { app: "b", channels: [{ id: "1" }] }] });
  assert.deepEqual(a.map((x) => [x.app, x.channels.length]), [["a", 0], ["b", 1]]);
  assert.deepEqual(normalizeApps({}), []);
});

test("consoleRequest wallet mode: paths and bearer", () => {
  const r = consoleRequest("wallet", "hys_s", "my app", "rotate");
  assert.equal(r.path, "/v1/console/apps/my%20app/rotate");
  assert.equal(r.init.method, "POST");
  assert.equal(r.init.headers.authorization, "Bearer hys_s");
  assert.equal(consoleRequest("wallet", "t", "a", "list").path, "/v1/console/apps");
  assert.equal(consoleRequest("wallet", "t", "a", "test", "i/d").path, "/v1/console/apps/a/alerts/i%2Fd/test");
  assert.equal(consoleRequest("wallet", "t", "a", "delete", "7").init.method, "DELETE");
  assert.equal(consoleRequest("wallet", "t", "a", "chats").path, "/v1/console/apps/a/telegram-chats");
  const add = consoleRequest("wallet", "t", "a", "add", { kind: "slack", target: " https://x " });
  assert.equal(add.path, "/v1/console/apps/a/alerts");
  assert.deepEqual(JSON.parse(add.init.body), { kind: "slack", target: "https://x" });
});

test("consoleRequest key mode uses the old routes", () => {
  assert.equal(consoleRequest("key", "hyd_k", "a", "list").path, "/v1/alerts");
  assert.equal(consoleRequest("key", "hyd_k", "a", "test", "5").path, "/v1/alerts/5/test");
  assert.equal(consoleRequest("key", "hyd_k", "a", "chats").path, "/v1/alerts/telegram-chats");
  assert.throws(() => consoleRequest("key", "hyd_k", "a", "rotate"), /wallet/);
});

test("rotateCommand quotes the key and refuses odd characters", () => {
  assert.equal(rotateCommand("hyd_abc123"), 'gh secret set HYDRA_API_KEY --body "hyd_abc123"');
  assert.throws(() => rotateCommand('hyd_a"; rm'), /key/);
});

test("toHex encodes a message as 0x hex of UTF-8", () => {
  assert.equal(toHex("Hi"), "0x4869");
  assert.equal(toHex("é"), "0xc3a9");
});

test("walletErrorText names the cause and the next step", () => {
  assert.match(walletErrorText({ code: 4001 }), /rejected.*try again/i);
  assert.match(walletErrorText({ code: -32002 }), /open your wallet/i);
  assert.match(walletErrorText(null), /MetaMask|Rabby/);
  assert.match(walletErrorText(new Error("boom")), /boom/);
});

test("apiErrorText: 401, 403, 400 stale", () => {
  assert.match(apiErrorText({ status: 401, message: "x" }), /Sign in again/);
  assert.match(apiErrorText({ status: 403, message: "x" }), /not owned by this wallet/);
  assert.match(apiErrorText({ status: 400, message: "stale" }, "signin"), /stale.*try again/i);
  assert.match(apiErrorText({ status: 502, message: "bad" }), /bad/);
});
