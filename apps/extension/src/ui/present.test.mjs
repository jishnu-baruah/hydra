import { test } from "node:test";
import assert from "node:assert/strict";
import { present } from "./present.js";

const opts = { explorer: "http://localhost:5173/", origin: "https://app.demo.xyz" };
const red = (n) => ({
  verdict: "red",
  app: "demo-dex",
  version: "1.0.0",
  matched: 3,
  ignored: 0,
  mismatches: Array.from({ length: n }, (_, i) => ({
    url: i === 1 ? "https://cdn.evil.example/x.js" : `https://app.demo.xyz/assets/f${i}.js?v=1`,
    kind: ["changed", "extra", "unreadable"][i % 3],
  })),
});

test("red lists at most 10 scripts, then says how many more", () => {
  const v = present(red(12), opts);
  assert.equal(v.state, "red");
  assert.equal(v.label, "Changed");
  assert.equal(v.message, "12 scripts are not in demo-dex 1.0.0. Do not sign or approve anything here until the team confirms.");
  assert.equal(v.items.length, 10);
  assert.equal(v.more, 2);
  // Same origin shows the path; another origin shows host and path. No query strings.
  assert.deepEqual(v.items.slice(0, 3), [
    { path: "/assets/f0.js", kind: "changed", text: "Changed since the release" },
    { path: "cdn.evil.example/x.js", kind: "extra", text: "Not in the release" },
    { path: "/assets/f2.js", kind: "unreadable", text: "Could not be read back" },
  ]);
  assert.deepEqual(v.link, { href: "http://localhost:5173/app/?name=demo-dex", text: "Open demo-dex on Hydra" });
});

test("one of anything reads in the singular", () => {
  assert.equal(present(red(1), opts).message.slice(0, 33), "1 script is not in demo-dex 1.0.0");
  const one = present({ verdict: "green", app: "demo-dex", version: "1.0.0", matched: 1, ignored: 2, mismatches: [] }, opts);
  assert.equal(one.message, "The 1 script matches demo-dex 1.0.0.");
  assert.equal(one.note, "2 scripts injected by the host were not judged.");
});

test("green says what matched and links to the app", () => {
  const v = present({ verdict: "green", app: "demo-dex", version: "1.0.0", matched: 6, ignored: 1, mismatches: [] }, opts);
  assert.equal(v.label, "Match");
  assert.equal(v.message, "All 6 scripts match demo-dex 1.0.0.");
  assert.equal(v.note, "1 script injected by the host was not judged.");
  assert.deepEqual(v.items, []);
  assert.equal(v.link.href, "http://localhost:5173/app/?name=demo-dex");
});

test("an unknown site says no release on record, with no link", () => {
  const v = present({ verdict: "grey", reason: "No release on record matches this site's scripts." }, opts);
  assert.equal(v.state, "grey");
  assert.equal(v.label, "No release on record");
  assert.equal(v.message, "No release on record matches this site's scripts.");
  assert.equal(v.link, null);
});

test("before the worker answers, the page is being checked", () => {
  assert.equal(present(null, opts).label, "Checking");
  assert.equal(present({ verdict: "none" }, opts).label, "Not a website");
});

test("the app name is encoded into the link", () => {
  assert.equal(present({ ...red(1), app: "a b&c" }, opts).link.href, "http://localhost:5173/app/?name=a%20b%26c");
});
