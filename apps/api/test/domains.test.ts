import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appForDomain } from '../src/domains.ts'

const rel = (app: string, publisher: string, at: number, domains: string[]) => ({ app, publisher, published_at: at, domains })
const owners = { alpha: '0xaaa', beta: '0xbbb' }

test('the app whose release lists the domain, from its owner, owns it', () => {
  assert.equal(appForDomain([rel('alpha', '0xAAA', 10, ['App.Example.com'])], owners, 'app.example.com'), 'alpha')
})

test('a release that does not list the domain, or is by someone other than the app owner, does not count', () => {
  assert.equal(appForDomain([rel('alpha', '0xaaa', 10, ['other.example.com'])], owners, 'app.example.com'), null)
  assert.equal(appForDomain([rel('alpha', '0xmallory', 10, ['app.example.com'])], owners, 'app.example.com'), null)
  assert.equal(appForDomain([rel('ghost', '0xaaa', 10, ['app.example.com'])], owners, 'app.example.com'), null) // no live claim
})

test('the earliest app to prove a domain keeps it, so a later claim cannot silence the check', () => {
  const rows = [rel('beta', '0xbbb', 50, ['app.example.com']), rel('alpha', '0xaaa', 10, ['app.example.com']), rel('alpha', '0xaaa', 60, ['app.example.com'])]
  assert.equal(appForDomain(rows, owners, 'app.example.com'), 'alpha')
})

test('no releases, or junk values, give null', () => {
  assert.equal(appForDomain([], owners, 'app.example.com'), null)
  assert.equal(appForDomain([{ app: 'alpha', publisher: '0xaaa', published_at: 'x', domains: [] }], owners, 'app.example.com'), null)
})
