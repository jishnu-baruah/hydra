// POST /v1/releases: hash the uploaded build, store it on Swarm, record it on Arkiv.
// The server computes every file hash itself; the client's word is only taken for external
// script hashes, which it fetched at build time.

import {
  FileSchema,
  LONG,
  MAX_BATCH,
  ReleaseSchema,
  fileValues,
  releaseValues,
  sha256Tag,
  type CreateSpec,
  type Manifest,
} from '@hydra/core'
import type { Hex } from 'viem'
import type { Result } from './auth.ts'
import type { KeyClaims } from './keys.ts'
import type { TarFile } from './tar.ts'

export interface PublishDeps {
  createOne: (spec: CreateSpec) => Promise<{ entityKey: Hex; txHash: Hex }>
  createMany: (specs: CreateSpec[]) => Promise<{ createdEntities: Hex[]; txHash: Hex }>
  swarm?: (files: TarFile[]) => Promise<string>
  now?: () => number
}

export const MAX_FILES = 2000
export const MAX_INDEXED_FILES = 200 // file records are written for code files, up to this many
const CODE = /\.(html?|m?js|css|wasm)$/i
const SHA = /^sha256-[0-9a-f]{64}$/

interface Body {
  version?: unknown
  commit?: unknown
  ciRunUrl?: unknown
  domains?: unknown
  files?: unknown
  scripts?: unknown
}

function validPath(p: string) {
  return (
    p.startsWith('/') &&
    p.length <= 300 &&
    !p.includes('\\') &&
    !p.includes('\0') &&
    !p.split('/').some((seg) => seg === '..' || seg === '.')
  )
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined
}

export async function publish(
  claims: KeyClaims,
  body: Body,
  deps: PublishDeps,
): Promise<Result<Record<string, unknown>>> {
  const bad = (error: string): Result<never> => ({ ok: false, status: 400, error })
  const now = (deps.now ?? Date.now)()

  if (!body.files || typeof body.files !== 'object' || Array.isArray(body.files)) {
    return bad('files must be an object of "/path": "<base64>"')
  }
  const entries = Object.entries(body.files as Record<string, unknown>)
  if (entries.length === 0 || entries.length > MAX_FILES) return bad(`files must hold 1 to ${MAX_FILES} entries`)
  if (!entries.some(([p]) => p === '/index.html')) return bad('the build must contain /index.html')

  const files: TarFile[] = []
  const hashes: Record<string, string> = {}
  for (const [p, b64] of entries) {
    if (!validPath(p)) return bad(`invalid path: ${p.slice(0, 80)}`)
    if (typeof b64 !== 'string') return bad(`file ${p} must be base64`)
    const data = Buffer.from(b64, 'base64')
    files.push({ path: p.slice(1), data })
    hashes[p] = sha256Tag(data)
  }

  const scripts: Record<string, string> = {}
  for (const [url, h] of Object.entries((body.scripts ?? {}) as Record<string, unknown>)) {
    if (!/^https:\/\//.test(url) || url.length > 2000 || typeof h !== 'string' || !SHA.test(h)) {
      return bad('scripts must map https URLs to "sha256-<hex>"')
    }
    scripts[url] = h
  }

  const commit = str(body.commit, 100) ?? 'unknown'
  const version = str(body.version, 100) ?? `${new Date(now).toISOString().slice(0, 10)}.${commit.slice(0, 7)}`
  const domains = Array.isArray(body.domains) ? body.domains.filter((d) => typeof d === 'string').slice(0, 20) : []
  const ciRunUrl = str(body.ciRunUrl, 500)

  const manifest: Manifest = { app: claims.app, version, commit, domains, files: hashes, scripts }
  const manifestJson = JSON.stringify(manifest, null, 2)

  const swarmRef = deps.swarm
    ? await deps.swarm([...files, { path: 'hydra-manifest.json', data: Buffer.from(manifestJson) }])
    : 'pending'

  // The full manifest rides in the release payload when it fits; otherwise Swarm holds it.
  const payload = manifestJson.length <= 100_000 ? { manifest, ci_run_url: ciRunUrl } : { ci_run_url: ciRunUrl, manifest_on_swarm: true }
  const release = await deps.createOne({
    schema: ReleaseSchema,
    values: releaseValues({
      app: claims.app,
      publisher: claims.address,
      version,
      commit,
      swarmRef,
      fileCount: entries.length,
      publishedAt: now,
      payload,
    }),
    expiration: LONG(),
  })

  const indexed = Object.entries(hashes).filter(([p]) => CODE.test(p)).slice(0, MAX_INDEXED_FILES)
  const fileTxs: Hex[] = []
  for (let i = 0; i < indexed.length; i += MAX_BATCH) {
    const specs = indexed.slice(i, i + MAX_BATCH).map(([path, sha256]) => ({
      schema: FileSchema,
      values: fileValues({ app: claims.app, sha256, path, release: release.entityKey }),
      expiration: LONG(),
    }))
    fileTxs.push((await deps.createMany(specs)).txHash)
  }

  return {
    ok: true,
    value: {
      app: claims.app,
      publisher: claims.address,
      version,
      commit,
      swarmRef,
      release: release.entityKey,
      releaseTx: release.txHash,
      filesIndexed: indexed.length,
      fileTxs,
    },
  }
}
