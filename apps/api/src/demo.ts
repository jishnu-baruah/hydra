// Hack and Fix for the stage (T-A27): deploy the demo site to its one Vercel project through Vercel's
// deployment API, either as published or with one harmless line added to app.js. The live watcher
// (T-A25) then sees the flip. Only this project and these fixed files can be deployed.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DEMO_FILES = ['index.html', 'app.js', '.well-known/hydra.txt', 'vercel.json']
export const TAMPER = '\nconsole.warn("injected by the staged demo hijack")\n'

export type DemoKind = 'hack' | 'fix'
export interface DemoProject {
  name: string
  projectId: string
  teamId: string
}

export async function readDemoFiles(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of DEMO_FILES) out[f] = await readFile(join(dir, f), 'utf8')
  return out
}

export function demoPayload(kind: DemoKind, files: Record<string, string>, p: DemoProject) {
  return {
    name: p.name,
    project: p.projectId,
    target: 'production',
    files: DEMO_FILES.map((file) => ({ file, data: kind === 'hack' && file === 'app.js' ? files[file] + TAMPER : files[file] })),
    projectSettings: { framework: null },
  }
}

// Creates the deployment and returns at once (Vercel builds it in about 10 s). Errors never carry the token.
export async function deployDemo(
  kind: DemoKind,
  o: { token: string; project: DemoProject; files: Record<string, string>; fetch?: typeof fetch },
): Promise<{ id: string; url: string; state: string }> {
  let res: Response
  try {
    res = await (o.fetch ?? fetch)(`https://api.vercel.com/v13/deployments?teamId=${o.project.teamId}&forceNew=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(demoPayload(kind, o.files, o.project)),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error('could not reach the Vercel API; check the network and retry')
  }
  const j = (await res.json().catch(() => ({}))) as { id?: string; url?: string; readyState?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(`Vercel answered HTTP ${res.status}: ${j.error?.message ?? 'no message'}. Check VERCEL_TOKEN can deploy the demo project`)
  return { id: String(j.id), url: String(j.url), state: String(j.readyState) }
}
