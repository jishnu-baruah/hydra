import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex')

// The form manifests and records use: "sha256-<hex>".
export const sha256Tag = (data: string | Uint8Array): string => `sha256-${sha256Hex(data)}`

export async function sha256File(path: string): Promise<string> {
  return sha256Hex(await readFile(path))
}
