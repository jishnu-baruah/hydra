// Shared record contract for Arkiv. See docs/ARCHITECTURE.md before changing.
// Arkiv SDK 1.x: each record type is a named schema, so `.from(Schema)` filters on its type.
// Column names are lowercase snake_case, timestamps are u64 milliseconds, and the JSON payload
// goes in the `body` bytes column (128 KiB max).

import { ExpirationTime } from '@arkiv-network/sdk'
import { bytes, defineSchema, key, str, u64 } from '@arkiv-network/sdk/schema'
import { stringToBytes, type Hex } from 'viem'
import { fitStr } from './attr.ts'

export const AppSchema = defineSchema('hydra.app', {
  app: str().indexed(),
  domain: str().indexed(),
  publisher: str().indexed(),
  created_at: u64().indexed(),
  body: bytes(),
})

export const ReleaseSchema = defineSchema('hydra.release', {
  app: str().indexed(),
  publisher: str().indexed(), // wallet address that signed in for the API key
  version: str().indexed(),
  commit: str().indexed(),
  swarm_ref: str().indexed(),
  file_count: u64(),
  published_at: u64().indexed(),
  source: str(),
  body: bytes(),
})

export const FileSchema = defineSchema('hydra.file', {
  app: str().indexed(),
  sha256: str().indexed(),
  path: str(),
  release: key().indexed(),
})

export const ObservationSchema = defineSchema('hydra.observation', {
  domain: str().indexed(),
  app: str().optional(),
  status: str().indexed(),
  observed_at: u64().indexed(),
  scripts_hash: str().indexed(),
  body: bytes(),
})

// One alert channel of an app (T-A30). `body` is the channel's target and secret, sealed with the
// API's ALERT_KEY (AES-256-GCM), so the chain never holds a webhook URL or chat id in the clear.
export const AlertSubSchema = defineSchema('hydra.alert_sub', {
  app: str().indexed(),
  kind: str().indexed(),
  created_at: u64().indexed(),
  body: bytes(),
})

export const SCHEMAS = [AppSchema, ReleaseSchema, FileSchema, ObservationSchema, AlertSubSchema] as const

// "long" in ARCHITECTURE.md is the network maximum, about 182.5 days.
export const LONG = (): ExpirationTime => ExpirationTime.max()
export const OBSERVATION_TTL = (): ExpirationTime => ExpirationTime.fromDays(3)
// An app-name claim is a lease: it lives as long as an API key (30 days) unless a publish renews it
// to LONG, so names nobody publishes under free themselves.
export const LEASE = (): ExpirationTime => ExpirationTime.fromDays(30)

export type ObservationStatus = 'match' | 'mismatch' | 'unknown'

export interface Manifest {
  app: string
  version: string
  commit: string
  domains: string[]
  files: Record<string, string> // path -> "sha256-<hex>"
  scripts: Record<string, string> // external script URL -> "sha256-<hex>"
}

const MAX_BODY = 128 * 1024

function body(payload: unknown) {
  const raw = stringToBytes(JSON.stringify(payload))
  if (raw.length > MAX_BODY) {
    throw new Error(`payload is ${raw.length} bytes, over Arkiv's ${MAX_BODY}; trim it or store it on Swarm`)
  }
  return bytes(raw)
}

const ms = (t: number) => u64(BigInt(Math.trunc(t)))

export const appValues = (a: {
  app: string
  domain: string
  publisher: string
  createdAt: number
  payload: { name: string; domains: string[]; repo?: string }
}) => ({
  app: fitStr(a.app),
  domain: fitStr(a.domain),
  publisher: fitStr(a.publisher),
  created_at: ms(a.createdAt),
  body: body(a.payload),
})

export const releaseValues = (r: {
  app: string
  publisher: string
  version: string
  commit: string
  swarmRef: string
  fileCount: number
  publishedAt: number
  payload: unknown
}) => ({
  app: fitStr(r.app),
  publisher: r.publisher.toLowerCase(),
  version: fitStr(r.version),
  commit: fitStr(r.commit),
  swarm_ref: fitStr(r.swarmRef),
  file_count: u64(BigInt(r.fileCount)),
  published_at: ms(r.publishedAt),
  source: 'ci',
  body: body(r.payload),
})

export const fileValues = (f: { app: string; sha256: string; path: string; release: Hex }) => ({
  app: fitStr(f.app),
  sha256: fitStr(f.sha256),
  path: fitStr(f.path),
  release: key(f.release),
})

// Expiration: LONG.
export const alertSubValues = (a: { app: string; kind: string; createdAt: number; sealed: Uint8Array }) => {
  if (a.sealed.length > MAX_BODY) throw new Error(`sealed channel is ${a.sealed.length} bytes, over Arkiv's ${MAX_BODY}; shorten the target`)
  return {
    app: fitStr(a.app),
    kind: fitStr(a.kind),
    created_at: ms(a.createdAt),
    body: bytes(a.sealed),
  }
}

export const observationValues = (o: {
  domain: string
  app?: string
  status: ObservationStatus
  observedAt: number
  scriptsHash: string
  payload: { scripts: { url: string; sha256: string }[] }
}) => ({
  domain: fitStr(o.domain),
  ...(o.app ? { app: fitStr(o.app) } : {}),
  status: o.status,
  observed_at: ms(o.observedAt),
  scripts_hash: fitStr(o.scriptsHash),
  body: body(o.payload),
})
