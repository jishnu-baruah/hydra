// Minimal ustar writer for Bee's /bzz collection upload. Regular files only.

export interface TarFile {
  path: string // relative, forward slashes, no leading slash
  data: Uint8Array
}

const BLOCK = 512

function field(buf: Buffer, offset: number, length: number, value: string) {
  buf.write(value, offset, Math.min(Buffer.byteLength(value), length), 'utf8')
}

const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, '0') + '\0'

function header(path: string, size: number): Buffer {
  let name = path
  let prefix = ''
  if (Buffer.byteLength(name) > 100) {
    const cut = path.lastIndexOf('/', path.length - 1)
    prefix = path.slice(0, cut)
    name = path.slice(cut + 1)
    if (cut < 0 || Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error(`path too long for tar: ${path.slice(0, 80)}...`)
    }
  }
  const h = Buffer.alloc(BLOCK)
  field(h, 0, 100, name)
  field(h, 100, 8, octal(0o644, 8))
  field(h, 108, 8, octal(0, 8))
  field(h, 116, 8, octal(0, 8))
  field(h, 124, 12, octal(size, 12))
  field(h, 136, 12, octal(0, 12))
  h.fill(' ', 148, 156) // checksum is computed with this field as spaces
  field(h, 156, 1, '0')
  field(h, 257, 6, 'ustar\0')
  field(h, 263, 2, '00')
  field(h, 345, 155, prefix)
  let sum = 0
  for (const b of h) sum += b
  field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ')
  return h
}

export function tar(files: TarFile[]): Buffer {
  const parts: Buffer[] = []
  for (const f of files) {
    parts.push(header(f.path, f.data.length), Buffer.from(f.data))
    const pad = (BLOCK - (f.data.length % BLOCK)) % BLOCK
    if (pad) parts.push(Buffer.alloc(pad))
  }
  parts.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}
