import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensLinkProblem, ensNameOk, ensStatusTargets, ensStatusValue } from '../src/ens.ts'

const R = '0xD0FcfcCcB378174ca736A4b4969B74Fb24850b58'

test('targets: "<domain>=<ens name>@<resolver>" pairs, comma separated, domain lowercased', () => {
  const t = ensStatusTargets(`Hydra-Demo-Dapp.vercel.app=status.demodapp.eth@${R}, a.example.com=status.a.eth@${R}`)
  assert.deepEqual(t.get('hydra-demo-dapp.vercel.app'), { name: 'status.demodapp.eth', resolver: R })
  assert.equal(t.size, 2)
})

test('targets: empty or missing config is no targets', () => {
  assert.equal(ensStatusTargets(undefined).size, 0)
  assert.equal(ensStatusTargets('  ').size, 0)
})

test('targets: a malformed entry is refused with the fix, never half-read', () => {
  assert.throws(() => ensStatusTargets('a.example.com=status.a.eth'), /HYDRA_ENS_STATUS.*<domain>=<ens name>@<resolver address>/)
  assert.throws(() => ensStatusTargets(`a.example.com=not a name@${R}`), /HYDRA_ENS_STATUS/)
  assert.throws(() => ensStatusTargets('a.example.com=status.a.eth@0x123'), /HYDRA_ENS_STATUS/)
})

test('value: only match or mismatch are written', () => {
  assert.equal(ensStatusValue('match'), 'match')
  assert.equal(ensStatusValue('mismatch'), 'mismatch')
  assert.equal(ensStatusValue('unreachable'), null)
})

// T-A36: a team links its own ENS name from the console. The name's owner tags it with the app
// (hydra.app) and grants Hydra hydra.status; the API checks both on chain before it trusts the link.
const facts = { app: 'demodapp', name: 'demodapp.eth', resolver: R, appTag: 'demodapp', hydraCanWrite: true }

test('link: a name with a resolver, tagged with this app and writable by Hydra is linked', () => {
  assert.equal(ensLinkProblem(facts), null)
})

test('link: no resolver means the name is not registered on ENSv2 Sepolia, and says so', () => {
  assert.match(ensLinkProblem({ ...facts, resolver: null })!, /demodapp\.eth has no resolver.*register it/i)
  assert.match(ensLinkProblem({ ...facts, resolver: '0x0000000000000000000000000000000000000000' })!, /no resolver/)
})

test('link: a name tagged with another app (or untagged) is refused, so nobody links a name they do not control', () => {
  assert.match(ensLinkProblem({ ...facts, appTag: 'evilapp' })!, /hydra\.app.*"evilapp".*Allow Hydra/)
  assert.match(ensLinkProblem({ ...facts, appTag: null })!, /hydra\.app.*empty/)
})

test('link: without the hydra.status grant the link is refused, since Hydra could not write the status', () => {
  assert.match(ensLinkProblem({ ...facts, hydraCanWrite: false })!, /may not set hydra\.status.*Allow Hydra/)
})

test('name: lowercase ENS names only, with at least one dot', () => {
  for (const ok of ['demodapp.eth', 'status.demodapp.eth', 'a-b.eth']) assert.equal(ensNameOk(ok), true, ok)
  for (const bad of ['', 'demodapp', 'Demo.eth', 'a..eth', 'a.eth.', 'a b.eth', `${'a'.repeat(260)}.eth`]) assert.equal(ensNameOk(bad), false, bad)
})
