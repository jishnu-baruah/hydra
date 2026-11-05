// Uploads a build folder to Swarm through a Bee node as one collection; returns its reference.

import { tar, type TarFile } from './tar.ts'

export function swarmUploader(o: { beeUrl: string; batchId: string }) {
  return async (files: TarFile[]): Promise<string> => {
    const res = await fetch(new URL('/bzz', o.beeUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-tar',
        'Swarm-Postage-Batch-Id': o.batchId,
        'Swarm-Collection': 'true',
        'Swarm-Index-Document': 'index.html',
      },
      body: tar(files),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      throw new Error(`Swarm upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    }
    const { reference } = (await res.json()) as { reference?: string }
    if (typeof reference !== 'string' || !/^[0-9a-f]{64,128}$/.test(reference)) {
      throw new Error('Swarm upload returned no valid reference')
    }
    return reference
  }
}
