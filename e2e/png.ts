// Tiny PNG codec for e2e: decode Playwright screenshots (8-bit RGB/RGBA, non-interlaced) to inspect
// pixels, and encode a synthetic wallpaper to use as a background image.
import { deflateSync, inflateSync } from 'node:zlib'

export interface Raster {
  width: number
  height: number
  /** RGBA, row-major. */
  data: Uint8Array
}

export function decodePng(buffer: Buffer): Raster {
  let offset = 8
  let width = 0
  let height = 0
  let channels = 4
  const idat: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]
      const colorType = body[9]
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) throw new Error('unsupported PNG')
      channels = colorType === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? (line[i - channels] ?? 0) : 0
      const up = prev[i] ?? 0
      const upLeft = i >= channels ? (prev[i - channels] ?? 0) : 0
      let add = 0
      if (filter === 1) add = left
      else if (filter === 2) add = up
      else if (filter === 3) add = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      line[i] = ((line[i] ?? 0) + add) & 255
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = line[x * channels] ?? 0
      out[o + 1] = line[x * channels + 1] ?? 0
      out[o + 2] = line[x * channels + 2] ?? 0
      out[o + 3] = channels === 4 ? (line[x * channels + 3] ?? 255) : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

/** Encodes RGB pixels produced by `pixel(x, y)` as a PNG. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      raw[row + 1 + x * 3] = r
      raw[row + 2 + x * 3] = g
      raw[row + 3 + x * 3] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
