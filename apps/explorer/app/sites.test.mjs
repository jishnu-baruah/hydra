import { test } from "node:test";
import assert from "node:assert/strict";
import { boundDomains, latestVerdict, verdictText } from "./sites.js";

const rel = (at, domains) => ({ published_at: String(at), payload: domains === undefined ? null : { manifest: { domains } } });

test("the domains bound to an app are the newest release's, lower case, unique, at most 5", () => {
  assert.deepEqual(boundDomains([rel(10, ["App.Example.com", "b.example.com", "app.example.com"]), rel(5, ["old.example.com"])]), ["app.example.com", "b.example.com"]);
  assert.deepEqual(boundDomains([rel(5, ["old.example.com"]), rel(10, ["new.example.com"])]), ["new.example.com"]);
  assert.deepEqual(boundDomains([rel(1, Array.from({ length: 9 }, (_, i) => `d${i}.example.com`))]).length, 5);
});

test("no releases, no payload or junk values bind nothing", () => {
  assert.deepEqual(boundDomains([]), []);
  assert.deepEqual(boundDomains([rel(1, undefined)]), []);
  assert.deepEqual(boundDomains([rel(1, [7, null, "", "x y", "ok.example.com"])]), ["ok.example.com"]);
  assert.deepEqual(boundDomains(null), []);
});

const obs = (status, at) => ({ $attributes: { status: { value: status }, observed_at: { value: String(at) } } });

test("the latest verdict is the newest observation", () => {
  assert.deepEqual(latestVerdict([obs("mismatch", 200), obs("match", 100)]), { status: "mismatch", observedAt: 200 });
  assert.equal(latestVerdict([]), null);
  assert.deepEqual(latestVerdict([obs("weird", 5)]), { status: "unknown", observedAt: 5 });
});

test("verdicts are worded for a visitor, never as a safety promise", () => {
  assert.match(verdictText("match"), /matches the team's release/i);
  assert.match(verdictText("match"), /not that the build is safe/i); // the disclaimer is part of the verdict
  assert.doesNotMatch(verdictText("mismatch") + verdictText("unknown"), /\bis safe\b/i);
  assert.match(verdictText("mismatch"), /differs from the release/i);
  assert.match(verdictText("unknown"), /no release/i);
});
