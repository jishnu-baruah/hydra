import test from "node:test";
import assert from "node:assert/strict";
import { approval, approvalText, statusText } from "./ensview.js";

const k = (c) => "0x" + c.repeat(64);
const keys = [k("a"), k("b"), k("c")];

test("none when empty", () => assert.equal(approval(keys, "").state, "none"));
test("none when only whitespace", () => assert.equal(approval(keys, "  ").state, "none"));
test("invalid when not a key", () => assert.equal(approval(keys, "latest").state, "invalid"));
test("invalid when too short", () => assert.equal(approval(keys, "0xabc").state, "invalid"));
test("latest", () => assert.deepEqual(approval(keys, k("a")), { state: "latest", key: k("a") }));
test("latest is case-insensitive", () => assert.equal(approval(keys, "0x" + "A".repeat(64)).state, "latest"));
test("older", () => assert.deepEqual(approval(keys, k("c")), { state: "older", key: k("c") }));
test("unknown", () => assert.equal(approval(keys, k("d")).state, "unknown"));
test("unknown when list empty", () => assert.equal(approval([], k("a")).state, "unknown"));

test("approvalText names the name and never promises safety", () => {
  for (const s of ["latest", "older", "unknown", "none", "invalid"]) {
    const t = approvalText(s, "x.eth");
    assert.match(t, /^x\.eth /);
    assert.doesNotMatch(t, /safe|secure/i);
  }
  assert.match(approvalText("older", "x.eth"), /not the newest/);
});

test("statusText", () => {
  assert.match(statusText("match"), /match/i);
  assert.match(statusText("mismatch"), /differs/i);
  assert.equal(statusText("whatever"), "No status yet");
  assert.equal(statusText(""), "No status yet");
});
