import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStep, approvedView } from "./ens-plan.js";

const base = { name: "shop.eth", resolver: "0xabc", appTag: "", app: "shop", hydraCanWrite: false, walletCanAllow: true, registrable: false };
const step = (o) => nextStep({ ...base, ...o }).step;

test("no resolver and registrable: register", () => {
  assert.equal(step({ resolver: null, registrable: true }), "register");
});
test("no resolver and not registrable: taken", () => {
  assert.equal(step({ resolver: null, registrable: false }), "taken");
});
test("resolver, Hydra cannot write yet, wallet can allow: allow", () => {
  assert.equal(step({}), "allow");
});
test("Hydra can write but the app tag is missing: allow", () => {
  assert.equal(step({ hydraCanWrite: true, appTag: "" }), "allow");
});
test("Hydra can write and the tag matches: link", () => {
  assert.equal(step({ hydraCanWrite: true, appTag: "shop" }), "link");
});
test("wallet cannot allow and setup is not done: not-yours", () => {
  assert.equal(step({ walletCanAllow: false }), "not-yours");
});
test("setup done by someone else's wallet still links", () => {
  assert.equal(step({ hydraCanWrite: true, appTag: "shop", walletCanAllow: false }), "link");
});
test("tagged for another app and wallet cannot change it: not-yours", () => {
  assert.equal(step({ hydraCanWrite: true, appTag: "other", walletCanAllow: false }), "not-yours");
});
test("every step carries a sentence without dashes", () => {
  for (const o of [{ resolver: null, registrable: true }, { resolver: null }, {}, { hydraCanWrite: true, appTag: "shop" }, { walletCanAllow: false }]) {
    const r = nextStep({ ...base, ...o });
    assert.ok(r.text.length > 20);
    assert.ok(!/[^\x00-\x7f]/.test(r.text));
  }
});

const K1 = "0x" + "ab".repeat(32);
const K2 = "0x" + "cd".repeat(32);
test("approvedView: case difference still matches the newest release", () => {
  const v = approvedView([K1, K2], K1.toUpperCase().replace("0X", "0x"), "");
  assert.equal(v.state, "latest");
  assert.equal(v.key, K1);
});
test("approvedView: empty read keeps the optimistic value", () => {
  assert.deepEqual(approvedView([K1, K2], "", K1), { state: "latest", key: K1 });
  assert.equal(approvedView([K1, K2], "  ", K1).state, "latest");
});
test("approvedView: the optimistic value wins over a stale non-empty read", () => {
  // old release K2 still approved on chain, user just approved the newer K1
  assert.deepEqual(approvedView([K1, K2], K2, K1), { state: "latest", key: K1 });
  assert.equal(approvedView([K1, K2], K1, K1).state, "latest");
});
test("approvedView: older release", () => {
  assert.deepEqual(approvedView([K1, K2], K2, ""), { state: "older", key: K2 });
});
test("approvedView: invalid and none", () => {
  assert.equal(approvedView([K1], "hello", "").state, "invalid");
  assert.equal(approvedView([K1], "", "").state, "none");
});
