#!/usr/bin/env node
// Builds the extension zip: node apps/extension/scripts/pack.mjs
//
// Node built-ins only (zlib deflate and crc32, Node 22.2 or later). Files are sorted and every
// timestamp is fixed, so the same source always gives the same zip and the same sha256: anyone can
// rebuild it and compare. Only what the browser loads goes in: manifest, icons and src, without
// tests.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";
import { join, relative, sep } from "node:path";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const out = join(root, `hydra-extension-${manifest.version}.zip`);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const files = ["manifest.json", ...[...walk(join(root, "icons")), ...walk(join(root, "src"))].map((f) => relative(root, f).split(sep).join("/"))]
  .filter((f) => !f.endsWith(".test.mjs"))
  .sort();

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, the zip epoch; time 00:00:00
const u16 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

const local = [];
const central = [];
let offset = 0;
for (const name of files) {
  const data = readFileSync(join(root, name));
  const packed = deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(data);
  // version 20, flag 0x0800 (UTF-8 names), method 8 (deflate), time 0, fixed date
  const common = Buffer.concat([u16(20), u16(0x0800), u16(8), u16(0), u16(DOS_DATE), u32(crc), u32(packed.length), u32(data.length), u16(nameBuf.length), u16(0)]);
  const header = Buffer.concat([u32(0x04034b50), common, nameBuf]);
  local.push(header, packed);
  central.push(Buffer.concat([u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]));
  offset += header.length + packed.length;
}
const cd = Buffer.concat(central);
const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
const zip = Buffer.concat([...local, cd, end]);
writeFileSync(out, zip);

console.log(`${relative(process.cwd(), out)}: ${files.length} files, ${zip.length} bytes`);
console.log(`sha256 ${createHash("sha256").update(zip).digest("hex")}`);
if (readFileSync(join(root, "src/ui/links.js"), "utf8").includes('"http://localhost')) {
  console.log("note: explorer links point at localhost; set EXPLORER in src/ui/links.js to the deployed explorer first (T-B06)");
}
