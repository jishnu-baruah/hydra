import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TAMPER, demoPayload, deployDemo } from '../src/demo.ts'

const files = { 'index.html': '<html></html>', 'app.js': 'quote()\n', '.well-known/hydra.txt': 'hydra-app=demo-dapp\n', 'vercel.json': '{}' }
const project = { name: 'hydra-demo-dapp', projectId: 'prj_x', teamId: 'team_y' }

test('fix deploys the files as they are, to production of the one project', () => {
  const p = demoPayload('fix', files, project)
  assert.equal(p.name, 'hydra-demo-dapp')
  assert.equal(p.project, 'prj_x')
  assert.equal(p.target, 'production')
  assert.deepEqual(Object.fromEntries(p.files.map((f) => [f.file, f.data])), files)
})

test('hack adds exactly one harmless line to app.js and changes nothing else', () => {
  const p = demoPayload('hack', files, project)
  const got = Object.fromEntries(p.files.map((f) => [f.file, f.data]))
  assert.equal(got['app.js'], files['app.js'] + TAMPER)
  assert.match(TAMPER, /^\nconsole\.warn\(.*\)\n$/)
  for (const k of ['index.html', '.well-known/hydra.txt', 'vercel.json']) assert.equal(got[k], files[k])
})

test('deployDemo posts to the team, with the token, and returns the deployment', async () => {
  let url = ''
  let auth = ''
  const r = await deployDemo('hack', { token: 'T', project, files, fetch: async (u, i) => {
    url = String(u)
    auth = String((i?.headers as Record<string, string>).Authorization)
    return new Response(JSON.stringify({ id: 'dpl_1', url: 'x.vercel.app', readyState: 'QUEUED' }), { status: 200 })
  } })
  assert.equal(url, 'https://api.vercel.com/v13/deployments?teamId=team_y&forceNew=1')
  assert.equal(auth, 'Bearer T')
  assert.deepEqual(r, { id: 'dpl_1', url: 'x.vercel.app', state: 'QUEUED' })
})

test('a Vercel error names its cause and never the token', async () => {
  await assert.rejects(
    deployDemo('fix', { token: 'SECRETTOKEN', project, files, fetch: async () => new Response(JSON.stringify({ error: { message: 'Not authorized' } }), { status: 403 }) }),
    (e: Error) => /Vercel answered HTTP 403: Not authorized/.test(e.message) && !/SECRETTOKEN/.test(e.message),
  )
})
