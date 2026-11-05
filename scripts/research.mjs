#!/usr/bin/env node
// Runs the filebus-research kit from its own folder, so its bus/, cache and reports never land in
// this repo, and its keys stay in the kit's gitignored .env. Node builtins only.
//
//   node scripts/research.mjs research "<question>" --mode fast|deep [--tier 2]
//   node scripts/research.mjs plan "<goal>"       decompose into the kit's own TASKS.md
//   node scripts/research.mjs swarm               run workers on the kit's open tasks
//   node scripts/research.mjs board summary       the kit's board, not this repo's
//
// Kit location: $HYDRA_RESEARCH_KIT, else ../filebus-research next to this repo.

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ENTRY = {
  research: 'research.mjs',
  plan: 'orchestrator.mjs',
  swarm: 'swarm.mjs',
  board: 'scripts/board.mjs',
}

const [cmd, ...args] = process.argv.slice(2)
const entry = ENTRY[cmd]
if (!entry) {
  console.error(`usage: node scripts/research.mjs <${Object.keys(ENTRY).join('|')}> [args]`)
  process.exit(2)
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kit = resolve(process.env.HYDRA_RESEARCH_KIT ?? resolve(repo, '../filebus-research'))
const script = resolve(kit, entry)
if (!existsSync(script)) {
  console.error(
    `research kit not found at ${kit}. Clone jishnu-baruah/filebus-research next to this repo, ` +
      'or set HYDRA_RESEARCH_KIT to its folder.',
  )
  process.exit(1)
}
if (!existsSync(resolve(kit, '.env'))) {
  console.error(`no .env in ${kit}. Copy its .env.example to .env and add your API keys there.`)
  process.exit(1)
}

process.loadEnvFile(resolve(kit, '.env'))
process.chdir(kit)
process.argv = [process.argv[0], script, ...args]
await import(pathToFileURL(script).href)
