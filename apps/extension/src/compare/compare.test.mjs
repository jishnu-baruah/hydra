import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "./compare.js";

const H = (c) => c.repeat(64);
const manifest = {
  files: { "/index.html": `sha256-${H("0")}`, "/assets/app.js": `sha256-${H("a")}`, "/assets/vendor.js": `sha256-${H("b")}` },
  scripts: { "https://cdn.vendor.example/rum.js": `sha256-${H("c")}` },
};
const origin = "https://app.demo.xyz";
const seen = (list) => list.map(([url, hex]) => ({ url, sha256: hex }));

test("every script in the release is green", () => {
  const r = compare(manifest, origin, seen([
    ["https://app.demo.xyz/assets/app.js", H("a")],
    ["https://app.demo.xyz/assets/vendor.js?v=2", H("b")],
    ["https://cdn.vendor.example/rum.js", H("c")],
  ]));
  assert.equal(r.verdict, "green");
  assert.deepEqual(r.mismatches, []);
  assert.equal(r.matched, 3);
});

test("a changed file is red and named", () => {
  const r = compare(manifest, origin, seen([["https://app.demo.xyz/assets/app.js", H("f")], ["https://app.demo.xyz/assets/vendor.js", H("b")]]));
  assert.equal(r.verdict, "red");
  assert.deepEqual(r.mismatches, [{ url: "https://app.demo.xyz/assets/app.js", kind: "changed" }]);
});

test("a script in no release is red, same origin or not", () => {
  const r = compare(manifest, origin, seen([["https://app.demo.xyz/assets/evil.js", H("e")], ["https://cdn.evil.example/x.js", H("d")]]));
  assert.equal(r.verdict, "red");
  assert.deepEqual(r.mismatches.map((m) => m.kind), ["extra", "extra"]);
});

test("a changed vendor script is red", () => {
  const r = compare(manifest, origin, seen([["https://cdn.vendor.example/rum.js", H("9")]]));
  assert.deepEqual(r.mismatches, [{ url: "https://cdn.vendor.example/rum.js", kind: "changed" }]);
});

test("a script that could not be fetched is red, not silently green", () => {
  const r = compare(manifest, origin, [{ url: "https://app.demo.xyz/assets/app.js", error: "HTTP 503" }]);
  assert.equal(r.verdict, "red");
  assert.deepEqual(r.mismatches, [{ url: "https://app.demo.xyz/assets/app.js", kind: "unreadable" }]);
});

test("Cloudflare's injected bot check is ignored, not red (spike F3)", () => {
  const r = compare(manifest, origin, seen([
    ["https://app.demo.xyz/cdn-cgi/challenge-platform/h/b/scripts/jsd/8340802ab0bb/main.js?ray=a1", H("7")],
    ["https://app.demo.xyz/assets/app.js", H("a")],
  ]));
  assert.equal(r.verdict, "green");
  assert.equal(r.ignored, 1);
});

test("no manifest is grey", () => {
  assert.equal(compare(null, origin, seen([["https://app.demo.xyz/assets/app.js", H("a")]])).verdict, "grey");
});
