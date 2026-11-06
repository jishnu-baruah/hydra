import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, targetError, keyError, addRequest, authHeaders, channelLine, errorText } from "./form.js";

test("webhook: any https URL", () => {
  assert.equal(targetError("webhook", "https://example.com/hook"), null);
  assert.match(targetError("webhook", "http://example.com/hook"), /https/);
  assert.match(targetError("webhook", "not a url"), /https/);
  assert.match(targetError("webhook", ""), /Enter/);
});

test("slack: hooks.slack.com/services only", () => {
  assert.equal(targetError("slack", "https://hooks.slack.com/services/T0/B0/xyz"), null);
  assert.match(targetError("slack", "https://example.com/services/T0"), /hooks\.slack\.com/);
  assert.match(targetError("slack", "https://hooks.slack.com.evil.com/services/x"), /hooks\.slack\.com/);
});

test("discord: both webhook hosts", () => {
  assert.equal(targetError("discord", "https://discord.com/api/webhooks/1/abc"), null);
  assert.equal(targetError("discord", "https://discordapp.com/api/webhooks/1/abc"), null);
  assert.match(targetError("discord", "https://discord.com/channels/1/2"), /discord\.com/);
});

test("telegram: integer chat id, may be negative, up to 20 digits", () => {
  assert.equal(targetError("telegram", "123456"), null);
  assert.equal(targetError("telegram", "-1001234567890"), null);
  assert.equal(targetError("telegram", "9".repeat(20)), null);
  assert.match(targetError("telegram", "9".repeat(21)), /chat id/);
  assert.match(targetError("telegram", "@mygroup"), /chat id/);
  assert.match(targetError("telegram", "12.5"), /chat id/);
});

test("unknown kind is rejected", () => {
  assert.match(targetError("sms", "x"), /kind/);
  assert.deepEqual(KINDS, ["webhook", "slack", "discord", "telegram"]);
});

test("api key must start with hyd_", () => {
  assert.equal(keyError("hyd_abc123"), null);
  assert.match(keyError(""), /Paste/);
  assert.match(keyError("hk_abc"), /hyd_/);
});

test("request building trims and sets the bearer header", () => {
  assert.deepEqual(authHeaders(" hyd_k "), { authorization: "Bearer hyd_k" });
  const r = addRequest("hyd_k", "slack", "  https://hooks.slack.com/services/a/b  ");
  assert.equal(r.path, "/v1/alerts");
  assert.equal(r.init.method, "POST");
  assert.equal(r.init.headers.authorization, "Bearer hyd_k");
  assert.equal(r.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(r.init.body), { kind: "slack", target: "https://hooks.slack.com/services/a/b" });
});

test("channel line shows kind, label and date", () => {
  assert.equal(channelLine({ kind: "slack", label: "hooks.slack.com/...", created_at: "2026-11-06T10:00:00Z" }), "slack, hooks.slack.com/..., added 2026-11-06");
  assert.equal(channelLine({ kind: "webhook", label: "x" }), "webhook, x");
});

test("error text names the cause and the next step", () => {
  assert.match(errorText({ status: 401, message: "x" }), /Publish page/);
  assert.match(errorText({ status: 503, message: "off" }), /not set up/);
  assert.match(errorText({ status: 409, message: "5 channels" }), /5 channels.*Delete/);
  assert.match(errorText({ status: 502, message: "boom" }, true), /boom.*Nothing was saved/);
  assert.match(errorText({ status: 400, message: "bad target" }), /bad target/);
  assert.match(errorText(new Error("the Hydra API did not answer")), /did not answer/);
});
