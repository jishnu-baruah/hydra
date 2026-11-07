import { test } from "node:test";
import assert from "node:assert/strict";
import { filterApps, nextOpen, rowSummary } from "./list.js";

const apps = [{ app: "Swap-UI" }, { app: "vault" }, { app: "swapper" }];

test("rowSummary: plural channels and key version", () => {
  assert.deepEqual(rowSummary({ app: "a", key_version: 3, channels: [1, 2] }), { name: "a", meta: "key v3 / 2 channels" });
});
test("rowSummary: singular channel", () => {
  assert.equal(rowSummary({ app: "a", key_version: 1, channels: [1] }).meta, "key v1 / 1 channel");
});
test("rowSummary: zero channels, no key version", () => {
  assert.equal(rowSummary({ app: "a", channels: [] }).meta, "0 channels");
  assert.equal(rowSummary({ app: "a" }).meta, "0 channels");
});
test("filterApps: empty or blank query keeps all", () => {
  assert.equal(filterApps(apps, "").length, 3);
  assert.equal(filterApps(apps, "   ").length, 3);
  assert.equal(filterApps(apps, undefined).length, 3);
});
test("filterApps: case-insensitive substring", () => {
  assert.deepEqual(filterApps(apps, "SWAP").map((a) => a.app), ["Swap-UI", "swapper"]);
});
test("filterApps: no match", () => {
  assert.deepEqual(filterApps(apps, "zzz"), []);
});
test("nextOpen: opens, switches, and toggles closed", () => {
  assert.equal(nextOpen(null, "a"), "a");
  assert.equal(nextOpen("a", "b"), "b");
  assert.equal(nextOpen("a", "a"), null);
});
