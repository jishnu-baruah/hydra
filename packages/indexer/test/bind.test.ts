import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindTargets, proofProblem } from '../src/scan.ts'

const mk = (domains: string[]) => ({ files: {}, domains })
const A = mk(['App.Example.com'])
const B = mk(['other.example.com'])

test('bindTargets: a domain in the latest manifest is bound to that app, overriding the label', () => {
  const [t] = bindTargets([{ app: 'wrong', domain: 'app.example.com' }], [{ app: 'good', manifest: A }])
  assert.deepEqual(t, { domain: 'app.example.com', app: 'good', manifest: A, bound: true })
})

test('bindTargets: a listed domain no manifest names keeps its label, with no manifest and unbound', () => {
  const [t] = bindTargets([{ app: 'uniswap', domain: 'App.Uniswap.org' }], [{ app: 'good', manifest: A }])
  assert.deepEqual(t, { domain: 'app.uniswap.org', app: 'uniswap', manifest: null, bound: false })
})

test('bindTargets: a manifest domain missing from targets.json is added', () => {
  const out = bindTargets([], [{ app: 'b', manifest: B }])
  assert.deepEqual(out, [{ domain: 'other.example.com', app: 'b', manifest: B, bound: true }])
})

test('bindTargets: two apps naming one domain bind neither', () => {
  const out = bindTargets([{ domain: 'app.example.com' }], [{ app: 'x', manifest: A }, { app: 'y', manifest: A }])
  assert.deepEqual(out, [{ domain: 'app.example.com', app: undefined, manifest: null, bound: false }])
})

test('proofProblem: only a bound target with a failed proof is a problem, and it names the reason', () => {
  assert.equal(proofProblem(true, { ok: true }), null)
  assert.equal(proofProblem(false, { ok: false, reason: 'HTTP 404' }), null)
  assert.equal(proofProblem(true, { ok: false, reason: 'HTTP 404' }), 'DOMAIN_PROOF_LOST HTTP 404')
})

test('proofProblem: an unreadable file is UNREACHABLE, not LOST, so a network blip is no hijack alarm', () => {
  assert.equal(proofProblem(true, { ok: false, transient: true, reason: 'timed out' }), 'DOMAIN_PROOF_UNREACHABLE timed out')
})
