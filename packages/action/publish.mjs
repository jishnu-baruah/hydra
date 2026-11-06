#!/usr/bin/env node
// Hydra publish: hash a build folder, hash the external scripts its HTML loads, and send the
// release to the Hydra API, which stores it on Swarm and records it on Arkiv.
// No dependencies, so CI can fetch and run it directly:
//   node publish.mjs <build-dir>
// Env: HYDRA_API_KEY (repo secret), HYDRA_API_URL; optional HYDRA_VERSION, HYDRA_DOMAINS (comma list; the server
// checks each: it must serve /.well-known/hydra.txt with the line hydra-app=<app>, else it is reported and left out).

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const MAX_BYTES = 20 * 1024 * 1024

function fail(msg) {
  console.error(`hydra: ${msg}`)
  process.exit(1)
}

const dir = process.argv[2] ?? 'dist'
const api = (process.env.HYDRA_API_URL ?? '').replace(/\/+$/, '')
const key = process.env.HYDRA_API_KEY
if (!api) fail('set HYDRA_API_URL to the Hydra API address')
if (!key) fail('set HYDRA_API_KEY from a repo secret; get a key on the Hydra site')

async function walk(d) {
  const out = []
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else if (e.isFile()) out.push(p)
  }
  return out
}

const sha256 = (data) => `sha256-${createHash('sha256').update(data).digest('hex')}`

const files = {}
const html = []
let total = 0
for (const p of await walk(dir).catch(() => fail(`build folder "${dir}" not found`))) {
  const data = await readFile(p)
  total += data.length
  if (total > MAX_BYTES) fail(`build is over ${MAX_BYTES} bytes; publish the deployable output only`)
  const path = '/' + relative(dir, p).split(sep).join('/')
  files[path] = data.toString('base64')
  if (/\.html?$/i.test(path)) html.push(data.toString('utf8'))
}
if (!files['/index.html']) fail(`no index.html in "${dir}"; pass the build output folder`)

// External scripts are hashed here, at build time, so later swaps at the same URL show up.
const scripts = {}
for (const page of html) {
  for (const m of page.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'](https:\/\/[^"']+)["']/gi)) {
    const url = m[1]
    if (scripts[url]) continue
    const res = await fetch(url).catch(() => null)
    if (!res?.ok) fail(`could not fetch external script ${url} to hash it`)
    scripts[url] = sha256(Buffer.from(await res.arrayBuffer()))
  }
}

const gh = process.env
const ciRunUrl = gh.GITHUB_RUN_ID ? `${gh.GITHUB_SERVER_URL}/${gh.GITHUB_REPOSITORY}/actions/runs/${gh.GITHUB_RUN_ID}` : undefined
const body = {
  files,
  scripts,
  commit: gh.GITHUB_SHA ?? 'local',
  version: gh.HYDRA_VERSION || (gh.GITHUB_RUN_NUMBER ? `${new Date().toISOString().slice(0, 10)}.${gh.GITHUB_RUN_NUMBER}` : undefined),
  domains: (gh.HYDRA_DOMAINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  ciRunUrl,
}

console.log(`hydra: publishing ${Object.keys(files).length} files and ${Object.keys(scripts).length} external scripts to ${api}`)
const res = await fetch(`${api}/v1/releases`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify(body),
}).catch((e) => fail(`could not reach ${api}: ${e.message}`))
const out = await res.json().catch(() => ({}))

if (res.status === 201) {
  console.log(`hydra: release ${out.version} of ${out.app} recorded on Arkiv`)
  console.log(`hydra:   release entity  ${out.release}`)
  console.log(`hydra:   transaction     https://rabdi.explorer.arkiv.network/tx/${out.releaseTx}`)
  console.log(`hydra:   swarm           ${out.swarmRef}`)
  console.log(`hydra:   files indexed   ${out.filesIndexed}`)
  for (const u of out.domainsUnverified ?? []) console.log(`hydra: domain not bound: ${u.domain}: ${u.reason}`)
} else if (res.status === 502 && out.phase && out.phase !== 'preflight') {
  fail(`${out.error}\nThe release may have been recorded. Check the transaction before re-running.`)
} else {
  fail(`HTTP ${res.status}: ${out.error ?? 'unknown error'}`)
}
