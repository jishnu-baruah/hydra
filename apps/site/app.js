// Temporary onboarding page. Plain browser JS, no build step, no dependencies: the wallet is
// reached through window.ethereum and the API does the verification. Everything from the API or
// the chain is shown with textContent, never as HTML.

import { API_URL } from './config.js'

const $ = (id) => document.getElementById(id)
const state = { address: null, app: null }

const TEMPLATE = `name: hydra

on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci && npm run build # your build
      - name: Publish to Hydra
        env:
          HYDRA_API_URL: __HYDRA_API_URL__
          HYDRA_API_KEY: \${{ secrets.HYDRA_API_KEY }}
        run: |
          curl -fsSL "$HYDRA_API_URL/publish.mjs" -o hydra-publish.mjs
          node hydra-publish.mjs __BUILD_DIR__
`

function showError(msg) {
  $('error').textContent = msg
  $('error').hidden = !msg
}

async function api(path, init) {
  const res = await fetch(API_URL + path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body
}

function renderYaml() {
  const dir = $('build-dir').value.trim() || 'dist'
  $('yaml').textContent = TEMPLATE.replace('__HYDRA_API_URL__', API_URL).replace('__BUILD_DIR__', dir)
}

// Everything an agent needs in one paste: who, what, the key, and how to check it worked.
function renderHandoff(app, key) {
  $('handoff').textContent = `Set up Hydra in this repo so every push to main records the build on Arkiv.
Docs: ${location.origin}/llms.txt

App name: ${app} (reserved for your wallet; the key works only for this name)
HYDRA_API_KEY: ${key}
HYDRA_API_URL: ${API_URL}

1. Store the key as a GitHub Actions secret (never commit it or write it to a file):
   gh secret set HYDRA_API_KEY --body "${key}"
   (from inside the repo clone, or add -R <owner>/<repo>)
2. Add .github/workflows/hydra.yml from the docs template, with this repo's real install and build
   commands and its build output folder (the folder that contains index.html).
3. Commit and push to main, then watch the run: gh run watch
4. Confirm the release: curl ${API_URL}/v1/apps/${app}/releases
If a step fails, read the error section of the docs before retrying. A 401 or 403 means the key
cannot be used: ask the human for a new block from the Hydra site; never retry with the same key.`
}

$('connect').onclick = async () => {
  showError('')
  if (!window.ethereum) return showError('No browser wallet found. Install MetaMask or another wallet and reload.')
  try {
    const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })
    state.address = address
    $('address').textContent = `Connected: ${address}`
    $('address').hidden = false
    $('step-key').hidden = false
    $('app').focus()
  } catch (e) {
    showError(`Wallet connection was refused: ${e.message ?? e}`)
  }
}

$('sign').onclick = async () => {
  showError('')
  const app = $('app').value.trim()
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(app)) return showError('App name: 2 to 40 lowercase letters, digits and dashes.')
  try {
    const q = new URLSearchParams({ address: state.address, app })
    const { message, issuedAt } = await api(`/v1/auth/message?${q}`)
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [message, state.address] })
    const { apiKey } = await api('/v1/auth/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: state.address, app, issuedAt, signature }),
    })
    state.app = app
    $('key').textContent = apiKey
    $('key-box').hidden = false
    $('step-repo').hidden = false
    $('step-releases').hidden = false
    renderYaml()
    renderHandoff(app, apiKey)
    loadReleases()
  } catch (e) {
    showError(`Could not get a key: ${e.message ?? e}`)
  }
}

async function loadReleases() {
  if (!state.app) return
  try {
    const { releases } = await api(`/v1/apps/${encodeURIComponent(state.app)}/releases`)
    const list = $('releases')
    list.replaceChildren()
    $('releases-empty').hidden = releases.length > 0
    for (const r of releases) {
      const li = document.createElement('li')
      const when = r.published_at ? new Date(Number(r.published_at)).toLocaleString() : 'unknown time'
      const head = document.createElement('strong')
      head.textContent = `${r.version}`
      const meta = document.createElement('span')
      meta.textContent = ` · commit ${String(r.commit).slice(0, 7)} · ${r.file_count} files · ${when}`
      const swarm = document.createElement('span')
      swarm.className = 'hint'
      swarm.textContent = ` · swarm ${String(r.swarm_ref).slice(0, 12)}`
      li.append(head, meta, swarm)
      list.append(li)
    }
  } catch (e) {
    showError(`Could not load releases: ${e.message ?? e}`)
  }
}

$('refresh').onclick = loadReleases
$('build-dir').oninput = renderYaml

for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.onclick = async () => {
    await navigator.clipboard.writeText($(btn.dataset.copy).textContent)
    const label = btn.textContent
    btn.textContent = 'Copied'
    setTimeout(() => (btn.textContent = label), 1200)
  }
}

$('api').textContent = API_URL
