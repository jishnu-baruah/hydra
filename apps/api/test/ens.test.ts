import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensStatusTargets, ensStatusValue } from '../src/ens.ts'

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
