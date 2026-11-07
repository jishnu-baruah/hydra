import { test } from "node:test";
import assert from "node:assert/strict";
import { latestPerApp, rowModel, MAX_ROWS } from "./model.js";

const link = (app, name, created_at) => ({ $attributes: { app: { value: app }, name: { value: name }, resolver: { value: "0xabc" }, created_at: { value: created_at } } });
const K1 = "0x" + "11".repeat(32);
const K2 = "0x" + "22".repeat(32);

test("latest link per app wins when an app relinked", () => {
  const rows = latestPerApp([link("shop", "old.eth", 1), link("shop", "new.eth", 5), link("blog", "blog.eth", 3)]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.app === "shop").name, "new.eth");
  assert.equal(rows[0].app, "shop", "newest link first");
});

test("latestPerApp skips rows without an app or name and caps rows", () => {
  const many = Array.from({ length: 30 }, (_, i) => link("app" + i, "n" + i + ".eth", i));
  assert.equal(latestPerApp(many).length, MAX_ROWS);
  assert.deepEqual(latestPerApp([{ $attributes: {} }, null, link("x", 5, 1)]), []);
});

test("approval states come from ensview", () => {
  const base = { app: "shop", link: { name: "shop.eth" }, releaseKeys: [K1, K2] };
  assert.equal(rowModel({ ...base, records: { status: "match", release: K1 } }).approval, "latest");
  assert.equal(rowModel({ ...base, records: { status: "mismatch", release: K2 } }).approval, "older");
  assert.equal(rowModel({ ...base, records: { status: "match", release: "0x" + "33".repeat(32) } }).approval, "unknown");
  assert.equal(rowModel({ ...base, records: { status: "match", release: "" } }).approval, "none");
});

test("empty records show not set, no error", () => {
  const m = rowModel({ app: "shop", link: { name: "shop.eth" }, records: { status: "", app: "", release: "" }, releaseKeys: [K1] });
  assert.equal(m.statusTone, "unknown");
  assert.equal(m.statusLabel, "no status yet");
  assert.equal(m.approvalLabel, "not approved yet");
  assert.equal(m.release, "not set");
});

test("malformed hydra.release is flagged invalid and never trusted", () => {
  const m = rowModel({ app: "shop", link: { name: "shop.eth" }, records: { status: "match", release: "<script>" }, releaseKeys: [K1] });
  assert.equal(m.approval, "invalid");
  assert.equal(m.approvalLabel, "release record is not a release id");
});

test("unknown status text falls back to grey, app link only for valid names", () => {
  const m = rowModel({ app: "Bad App!", link: { name: "x.eth" }, records: { status: "pwned" }, releaseKeys: [] });
  assert.equal(m.statusTone, "unknown");
  assert.equal(m.appHref, null);
  assert.equal(rowModel({ app: "ok-app", link: { name: "x.eth" }, records: {}, releaseKeys: [] }).appHref, "../../app/?name=ok-app");
});
