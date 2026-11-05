// HTTP routes. Dependencies are injected so tests run without a network or keys.
//
//   GET  /health
//   GET  /publish.mjs                  the CI publish script
//   GET  /v1/auth/message?address=&app= the exact message to sign
//   POST /v1/auth/key                  { address, app, issuedAt, signature } -> { apiKey }
//   POST /v1/releases                  Authorization: Bearer <apiKey>
//   GET  /v1/apps/:app/releases
//   GET  /v1/files/:sha256

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { rootCause, WriteNotVerifiedError } from '@hydra/core'
import { APP_NAME, checkInput, keyFromSignature, signInMessage } from './auth.ts'
import { verifyKey } from './keys.ts'
import { claimApp, ownedError, publish, type PublishDeps } from './publish.ts'

export interface ApiDeps {
  secret: string
  corsOrigin?: string
  publishScript?: () => Promise<string>
  publish?: PublishDeps // undefined: no funded Arkiv wallet configured
  ownerOf?: (app: string) => Promise<string | null> // lowercased owner, or null if unclaimed
  allowedAddresses?: Set<string> // lowercased; when set, only these may get keys and publish
  publishesPerHour?: number // per address; default 30
  claimsPerHour?: number // new app names reserved per address; default 5
  releasesFor?: (app: string) => Promise<unknown>
  filesByHash?: (sha256: string) => Promise<unknown>
  health?: Record<string, unknown>
}

const SMALL = 16 * 1024
const LARGE = 25 * 1024 * 1024

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, `body over ${limit} bytes`)
    chunks.push(chunk as Buffer)
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v
  } catch {
    throw new HttpError(400, 'body must be a JSON object')
  }
}

export function createApi(deps: ApiDeps) {
  // Every publish spends the server wallet's gas and the postage batch, so access is limited:
  // an optional allowlist, app names owned by their first publisher, and a per-address rate.
  // A key reserves its app name on Arkiv at once (one write), so key requests are limited too.
  const allowed = (address: string) => !deps.allowedAddresses || deps.allowedAddresses.has(address.toLowerCase())
  const limiter = (perHour: number) => {
    const recent = new Map<string, number[]>()
    return (address: string, now = Date.now()) => {
      const key = address.toLowerCase()
      const times = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000)
      if (times.length >= perHour) return false
      recent.set(key, [...times, now])
      return true
    }
  }
  const takeSlot = limiter(deps.publishesPerHour ?? 30)
  const takeClaim = limiter(deps.claimsPerHour ?? 5)

  const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': deps.corsOrigin ?? '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  return createServer(async (req, res) => {
    const started = Date.now()
    const url = new URL(req.url ?? '/', 'http://local')
    const path = url.pathname
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '')

      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true, arkivWrites: Boolean(deps.publish), swarm: Boolean(deps.publish?.swarm), ...deps.health })
      }

      if (req.method === 'GET' && path === '/publish.mjs' && deps.publishScript) {
        return send(res, 200, await deps.publishScript(), 'text/javascript; charset=utf-8')
      }

      if (req.method === 'GET' && path === '/v1/auth/message') {
        const input = checkInput(url.searchParams.get('address'), url.searchParams.get('app'))
        if (!input.ok) return send(res, input.status, { error: input.error })
        const issuedAt = new Date().toISOString()
        return send(res, 200, { message: signInMessage(input.value.address, input.value.app, issuedAt), issuedAt, ...input.value })
      }

      if (req.method === 'POST' && path === '/v1/auth/key') {
        const out = await keyFromSignature(deps.secret, await readJson(req, SMALL))
        if (!out.ok) return send(res, out.status, { error: out.error })
        if (!allowed(out.value.address)) return send(res, 403, { error: 'this test server only issues keys to allowlisted addresses' })
        const { address, app } = out.value
        const owner = deps.ownerOf ? await deps.ownerOf(app) : null
        if (owner && owner !== address.toLowerCase()) return send(res, 403, { error: ownedError(app, owner) })
        // Unclaimed: reserve the name now, so nobody can take it between key and first publish.
        let claimTx: string | null = null
        if (!owner && deps.ownerOf && deps.publish) {
          if (!takeClaim(address)) return send(res, 429, { error: 'too many new app names for this address; try again within the hour' })
          claimTx = (await claimApp(deps.publish, app, address, Date.now())).txHash
        }
        return send(res, 200, { ...out.value, claimTx })
      }

      if (req.method === 'POST' && path === '/v1/releases') {
        const auth = req.headers.authorization ?? ''
        const claims = verifyKey(deps.secret, auth.startsWith('Bearer ') ? auth.slice(7) : undefined)
        if (!claims) return send(res, 401, { error: 'missing or invalid API key; get one from the Hydra site' })
        if (!allowed(claims.address)) return send(res, 403, { error: 'this address is no longer allowlisted' })
        if (!deps.publish) return send(res, 503, { error: 'publishing is not configured on this server (no funded Arkiv wallet)' })
        const body = await readJson(req, LARGE)
        if (!takeSlot(claims.address)) return send(res, 429, { error: 'publish limit reached for this address; try again within the hour' })
        const out = await publish(claims, body, { ...deps.publish, ownerOf: deps.ownerOf })
        return out.ok ? send(res, 201, out.value) : send(res, out.status, { error: out.error })
      }

      const appRoute = /^\/v1\/apps\/([^/]+)\/releases$/.exec(path)
      if (req.method === 'GET' && appRoute && deps.releasesFor) {
        const app = decodeURIComponent(appRoute[1])
        if (!APP_NAME.test(app)) return send(res, 400, { error: 'invalid app name' })
        return send(res, 200, { app, releases: await deps.releasesFor(app) })
      }

      const fileRoute = /^\/v1\/files\/(sha256-[0-9a-f]{64})$/.exec(path)
      if (req.method === 'GET' && fileRoute && deps.filesByHash) {
        return send(res, 200, { sha256: fileRoute[1], files: await deps.filesByHash(fileRoute[1]) })
      }

      return send(res, 404, { error: 'not found' })
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message })
      if (err instanceof WriteNotVerifiedError) {
        return send(res, 502, { error: err.message, phase: err.phase, txHash: err.txHash ?? null })
      }
      return send(res, 500, { error: rootCause(err) })
    } finally {
      // No headers, bodies or keys: method, path, status and time only.
      console.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`)
    }
  })
}
