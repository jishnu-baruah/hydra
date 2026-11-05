import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "./extension/hash.js";

// Vectors from FIPS 180-2, also what `printf abc | sha256sum` prints.
test("sha256Hex matches sha256sum", async () => {
  const enc = new TextEncoder();
  assert.equal(
    await sha256Hex(enc.encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    await sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
