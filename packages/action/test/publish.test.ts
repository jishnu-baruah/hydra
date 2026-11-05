import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { issueKey } from '../../../apps/api/src/keys.ts'
import { createApi } from '../../../apps/api/src/server.ts'

// The real publish script, run as CI would run it, against the real API routes with fake writers.
const SECRET = 'z'.repeat(40)
const run = promisify(execFile)
const script = fileURLToPath(new URL('../publish.mjs', import.meta.url))
const seen: { files: string[]; commit?: string } = { files: [] }

const server = createApi({
  secret: SECRET,
  publish: {
    createOne: async (spec) => {
      seen.commit = (spec.values as { commit: string }).commit
      return { entityKey: `0x${'11'.repeat(32)}`, txHash: `0x${'22'.repeat(32)}` }
    },
    createMany: async (specs) => {
      seen.files.push(...specs.map((s) => (s.values as { path: string }).path))
      return { createdEntities: [], txHash: `0x${'44'.repeat(32)}` }
    },
  },
})
server.listen(0)
after(() => server.close())
const api = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`

function buildDir() {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-build-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<script src="/assets/app.js"></script>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("hi")')
  return dir
}

test('publish.mjs sends a build and the API records it', async () => {
  const key = issueKey(SECRET, { address: '0x00000000000000000000000000000000000000aa', app: 'demo', iat: 1, exp: Date.now() + 3_600_000 })
  const { stdout } = await run(process.execPath, [script, buildDir()], {
    env: { ...process.env, HYDRA_API_URL: api(), HYDRA_API_KEY: key, GITHUB_SHA: 'deadbeef', GITHUB_RUN_NUMBER: '7' },
  })
  assert.match(stdout, /recorded on Arkiv/)
  assert.equal(seen.commit, 'deadbeef')
  assert.deepEqual(seen.files.sort(), ['/assets/app.js', '/index.html'])
})

test('publish.mjs fails clearly with a bad key and with no index.html', async () => {
  await assert.rejects(
    run(process.execPath, [script, buildDir()], { env: { ...process.env, HYDRA_API_URL: api(), HYDRA_API_KEY: 'hyd_bad.key' } }),
    (err: { stderr: string }) => /HTTP 401/.test(err.stderr),
  )
  const empty = mkdtempSync(join(tmpdir(), 'hydra-empty-'))
  writeFileSync(join(empty, 'app.js'), 'x')
  await assert.rejects(
    run(process.execPath, [script, empty], { env: { ...process.env, HYDRA_API_URL: api(), HYDRA_API_KEY: 'x' } }),
    (err: { stderr: string }) => /no index.html/.test(err.stderr),
  )
})
