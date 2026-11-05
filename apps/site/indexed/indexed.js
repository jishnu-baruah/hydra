// Visualises every site the indexer watches, from GET /v1/observations. All values come from the
// chain, so they are shown with textContent only; nothing from the API is parsed as HTML.

import { API_URL } from '../config.js'

const $ = (id) => document.getElementById(id)
const STATES = ['match', 'mismatch', 'unknown', 'pending']
let data = null
let filter = 'all'
let open = null

const el = (tag, text, cls) => {
  const e = document.createElement(tag)
  if (text != null) e.textContent = text
  if (cls) e.className = cls
  return e
}

const ago = (ms) => {
  if (!ms) return 'never'
  const m = Math.round((Date.now() - ms) / 60000)
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

function stat(value, label) {
  const s = el('div', null, 'stat')
  s.append(el('b', String(value)), el('span', label))
  return s
}

function renderSummary() {
  const { summary, sites } = data
  const box = $('summary')
  box.replaceChildren()
  const scripts = sites.reduce((n, s) => n + (s.latest?.scripts ?? 0), 0)
  const runtime = sites.filter((s) => s.latest?.runtime_origins.length).length
  const changed = sites.filter((s) => s.latest?.changed).length
  box.append(stat(summary.sites, 'sites indexed'), stat(scripts, 'scripts hashed in the last run'), stat(runtime, 'sites loading scripts at runtime'), stat(changed, 'changed since the previous run'), stat(ago(summary.lastRun), 'last indexer run'))

  const bar = el('div', null, 'stat')
  const states = el('div', null, 'bar')
  const colors = { match: '#4fb078', mismatch: '#e0624e', unknown: '#6f7bd6', pending: '#555' }
  for (const k of STATES) {
    const n = summary.states[k] ?? 0
    if (!n) continue
    const seg = el('i')
    seg.style.width = `${(n / summary.sites) * 100}%`
    seg.style.background = colors[k]
    seg.title = `${k}: ${n}`
    states.append(seg)
  }
  bar.append(states, el('span', STATES.map((k) => `${summary.states[k] ?? 0} ${k}`).join(' · ')))
  box.append(bar)

  const cats = $('cats')
  cats.replaceChildren()
  const max = Math.max(...Object.values(summary.categories))
  for (const [name, n] of Object.entries(summary.categories).sort((a, b) => b[1] - a[1])) {
    const row = el('div', null, 'cat')
    const track = el('div', null, 'track')
    const fill = el('div', null, 'fill')
    fill.style.width = `${(n / max) * 100}%`
    track.append(fill)
    row.append(el('span', name), track, el('span', String(n)))
    cats.append(row)
  }
}

function renderFilters() {
  const f = $('filters')
  f.replaceChildren()
  const cats = Object.keys(data.summary.categories).sort()
  for (const name of ['all', ...STATES, ...cats]) {
    const b = el('button', name, 'chip')
    b.setAttribute('aria-pressed', String(filter === name))
    b.onclick = () => {
      filter = name
      open = null
      render()
    }
    f.append(b)
  }
}

const visible = (s) => filter === 'all' || s.state === filter || s.category === filter

function card(s, maxScripts) {
  const b = el('button', null, 'site')
  b.setAttribute('aria-expanded', String(open === s.domain))
  const top = el('div', null, 'top')
  top.append(el('span', s.domain, 'dom'), el('span', s.state, `pill ${s.state}`))
  const meta = el('div', null, 'meta')
  meta.append(el('span', s.category, 'tag'))
  if (s.app) meta.append(el('span', `app ${s.app}`, 'tag'))
  const l = s.latest
  if (l) {
    meta.append(el('span', `${l.scripts} scripts`, 'tag'))
    if (l.runtime_origins.length) meta.append(el('span', `${l.runtime_origins.length} runtime`, 'tag warn'))
    if (l.changed) meta.append(el('span', 'changed', 'tag hot'))
    if (l.via === 'renderer') meta.append(el('span', 'via renderer', 'tag'))
    if (l.problems.some((p) => p.startsWith('UNREACHABLE'))) meta.append(el('span', 'unreachable', 'tag hot'))
  }
  const bar = el('div', null, 'scripts')
  const fill = el('i')
  fill.style.width = `${l ? Math.max(3, (l.scripts / maxScripts) * 100) : 0}%`
  bar.append(fill)
  const hist = el('div', null, 'hist')
  hist.title = l ? `last checked ${ago(l.observed_at)}` : 'not observed yet'
  for (const h of s.history.slice(0, 8)) hist.append(el('i', null, `${h.status}${h.changed ? ' chg' : ''}`))
  if (!s.history.length) hist.append(el('i', null, 'pending'))
  b.append(top, meta, bar, hist, el('span', l ? `checked ${ago(l.observed_at)}` : 'waiting for the first run', 'hint'))
  b.onclick = () => {
    open = open === s.domain ? null : s.domain
    render()
  }
  return b
}

function detail(s) {
  const d = el('div', null, 'detail')
  const l = s.latest
  d.append(el('strong', s.domain))
  if (!l) return d.append(el('p', 'No observation yet. The indexer runs every 30 minutes.')), d
  const list = (title, items) => {
    d.append(el('div', title, 'hint'))
    const ul = el('ul')
    for (const i of items) ul.append(el('li', i))
    d.append(ul)
  }
  list('Third-party script origins that appear only when the page runs', l.runtime_origins.length ? l.runtime_origins : ['none'])
  list('Problems in the last run', l.problems.length ? l.problems : ['none'])
  list('Recent runs (newest first)', s.history.map((h) => `${new Date(h.observed_at).toLocaleString()}: ${h.status}, ${h.scripts} scripts, hash ${h.hash}${h.changed ? ', CHANGED' : ''}`))
  const e = el('div')
  e.append(el('span', 'Arkiv entity ', 'hint'), el('code', l.entity, 'mono'))
  d.append(e)
  return d
}

function render() {
  renderSummary()
  renderFilters()
  const grid = $('grid')
  grid.replaceChildren()
  const sites = data.sites.filter(visible)
  const maxScripts = Math.max(1, ...data.sites.map((s) => s.latest?.scripts ?? 0))
  for (const s of sites) {
    grid.append(card(s, maxScripts))
    if (open === s.domain) grid.append(detail(s))
  }
  $('status').textContent = `${sites.length} of ${data.sites.length} shown. Updated ${new Date().toLocaleTimeString()}.`
}

async function load() {
  try {
    const res = await fetch(`${API_URL}/v1/observations`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    if (!body.summary) throw new Error('the API has no indexer wallet configured')
    data = body
    $('error').hidden = true
    render()
  } catch (err) {
    $('error').textContent = `Could not load the indexed sites: ${err.message}. The free API may be waking up; this page retries in 60 s.`
    $('error').hidden = false
  }
}

$('api').textContent = API_URL
$('refresh').onclick = load
load()
setInterval(load, 60_000)
