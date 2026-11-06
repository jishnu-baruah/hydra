import { test } from "node:test";
import assert from "node:assert/strict";
import { appError, dirError, workflow, handoff, secretCommand } from "./flow.js";

const API = "https://hydra-api.example";

test("app names: 2 to 40 lowercase letters, digits and dashes, starting with a letter or digit", () => {
  assert.equal(appError("my-dapp"), null);
  assert.equal(appError("a1"), null);
  assert.match(appError(""), /Enter an app name/);
  assert.match(appError("My-Dapp"), /lowercase/);
  assert.match(appError("-x"), /lowercase/);
  assert.match(appError("x"), /lowercase/);
  assert.match(appError("a".repeat(41)), /lowercase/);
});

test("the build folder is a plain path, so nothing else lands in the workflow", () => {
  assert.equal(dirError("dist"), null);
  assert.equal(dirError("apps/web/out"), null);
  assert.equal(dirError("./build"), null);
  assert.match(dirError("dist; curl x | sh"), /letters, digits/);
  assert.match(dirError("dist\n  - run: evil"), /letters, digits/);
  assert.match(dirError(""), /folder/);
});

test("the workflow publishes the build folder through the API's publish script", () => {
  const y = workflow(API, "out");
  assert.match(y, /^name: hydra\n/);
  assert.match(y, /branches: \[main\]/);
  assert.match(y, /HYDRA_API_URL: https:\/\/hydra-api\.example\n/);
  assert.match(y, /HYDRA_API_KEY: \$\{\{ secrets\.HYDRA_API_KEY \}\}/);
  assert.match(y, /curl -fsSL "\$HYDRA_API_URL\/publish\.mjs" -o hydra-publish\.mjs\n {10}node hydra-publish\.mjs out\n$/);
});

test("the agent block never carries the key and tells the user to store the secret themselves", () => {
  const h = handoff({ app: "my-dapp", key: "hyd_123", api: API, docs: "https://docs.example/llms.txt" });
  assert.doesNotMatch(h, /hyd_/);
  assert.doesNotMatch(h, /hk_|123/);
  assert.match(h, /App name: my-dapp/);
  assert.match(h, /HYDRA_API_KEY/);
  assert.match(h, /gh secret set HYDRA_API_KEY/);
  assert.doesNotMatch(h, /--body/);
  assert.match(h, /do not ask for the key/i);
  assert.match(h, /curl https:\/\/hydra-api\.example\/v1\/apps\/my-dapp\/releases/);
  assert.match(h, /Docs: https:\/\/docs\.example\/llms\.txt/);
  assert.match(h, /never retry with the same key/);
});

test("the user's own command carries the key", () => {
  assert.equal(secretCommand("hyd_abc"), 'gh secret set HYDRA_API_KEY --body "hyd_abc"');
});
