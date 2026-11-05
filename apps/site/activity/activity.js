// Temp activity view: GET /v1/activity, grouped by app and listed newest first. Everything from the
// API is chain data, so it is shown with textContent only; links are built only for GitHub run URLs.

import { API_URL } from '../config.js'

const $ = (id) => document.getElementById(id)
let events = []
let head = null
let filter = new URLSearchParams(location.search).get('app')

const el = (tag, text, cls) => {
  const e = document.createElement(tag)
  if (text != null) e.textContent = text
  if (cls) e.className = cls
  return e
}
const short = (s, n = 10) => (String(s).length > n + 4 ? `${String(s).slice(0, n)}...` : String(s))

// Arkiv records expire at a block; turn that into a date with the chain's head and block time.
function lifetime(e) {
  if (!head || !e.expires_at) return 'expiry unknown'
  const days = ((e.expires_at - head.block) * head.blockSeconds) / 86400
  const when = new Date((head.time + (e.expires_at - head.block) * head.blockSeconds) * 1000).toLocaleDateString()
  if (e.kind === 'app') return `name lease ends ${when} (${Math.round(days)} days) unless a publish renews it`
  return `expires ${when} (${Math.round(days)} days)`
}

function detail(e) {
  const d = el('div')
  if (e.kind === 'app') d.append(el('span', `${e.app} claimed by `), el('span', e.publisher, 'mono'))
  if (e.kind === 'file') d.append(el('span', `${e.app} `), el('span', `${e.path} ${short(e.sha256, 18)}`, 'mono'))
  if (e.kind === 'release') {
    d.append(el('strong', `${e.app} ${e.version}`), el('span', ` commit ${String(e.commit).slice(0, 7)}, ${e.file_count} files, swarm ${short(e.swarm_ref, 8)}`))
    if (e.ci_run_url) {
      const a = el('a', ' CI run')
      a.href = e.ci_run_url
      a.target = '_blank'
      a.rel = 'noopener'
      d.append(a)
    }
  }
  d.append(el('div', `entity ${e.$key} · ${lifetime(e)}`, 'mono hint'))
  return d
}

function render() {
  const byApp = new Map()
  for (const e of events) {
    const a = byApp.get(e.app) ?? { releases: 0, files: 0, owner: null, block: 0 }
    if (e.kind === 'release') a.releases++
    if (e.kind === 'file') a.files++
    if (e.kind === 'app') a.owner = e.publisher
    a.block = Math.max(a.block, e.block)
    byApp.set(e.app, a)
  }
  const apps = $('apps')
  apps.replaceChildren()
  for (const [name, a] of [...byApp].sort((x, y) => y[1].block - x[1].block)) {
    const b = el('button', null, 'app')
    b.setAttribute('aria-pressed', String(filter === name))
    b.append(el('strong', name), el('span', `${a.releases} releases, ${a.files} files`, 'hint'))
    b.onclick = () => {
      filter = filter === name ? null : name
      history.replaceState(null, '', filter ? `?app=${encodeURIComponent(filter)}` : location.pathname)
      render()
    }
    apps.append(b)
  }
  const shown = filter ? events.filter((e) => e.app === filter) : events
  $('events-title').textContent = filter ? `Events for ${filter}` : 'All events'
  const list = $('events')
  list.replaceChildren()
  for (const e of shown) {
    const li = el('li')
    li.append(el('span', `block ${e.block}`, 'mono hint'), el('span', e.kind, `kind ${e.kind}`), detail(e))
    list.append(li)
  }
  $('status').textContent = `${byApp.size} apps, ${events.length} events. Click an app to filter. Updated ${new Date().toLocaleTimeString()}.`
}

async function load() {
  try {
    const res = await fetch(`${API_URL}/v1/activity`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    events = Array.isArray(body.events) ? body.events : []
    head = body.head ?? null
    $('error').hidden = true
    render()
  } catch (err) {
    $('error').textContent = `Could not load activity: ${err.message}. The free API may be waking up; it refreshes again in 30 s.`
    $('error').hidden = false
  }
}

$('api').textContent = API_URL
$('refresh').onclick = load
load()
setInterval(load, 30_000)
