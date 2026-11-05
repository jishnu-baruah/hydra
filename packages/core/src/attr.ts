import { MAX_STRING_BYTES } from '@arkiv-network/sdk/schema'
import { sha256Tag } from './hash.ts'

// Arkiv `str` values hold at most 128 UTF-8 bytes. A longer value (a script URL, a deep path) is
// replaced by its sha256 tag, which is 71 bytes; the full value stays in the record's payload.
export function fitStr(value: string): string {
  return Buffer.byteLength(value, 'utf8') <= MAX_STRING_BYTES ? value : sha256Tag(value)
}
