// Photos from the phone (PRD F22, Figma 45G) become files the agent can read: their type is sniffed from the bytes
// (iOS sends HEIC, or no type at all), HEIC is turned into JPEG with macOS's own `sips` — Claude only turns png / jpg /
// gif / webp paths into images (PRD §6.16) — and they land in F19's attachments folder. Electron-free.
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REMOTE_LIMITS, type RemotePhoto } from '@shared/remote'

export type PhotoType = 'jpg' | 'png' | 'gif' | 'webp' | 'heic'

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

export function sniffPhoto(bytes: Uint8Array): PhotoType | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'gif'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && HEIC_BRANDS.has(b.toString('latin1', 8, 12))) return 'heic'
  return null
}

/** `sips -s format jpeg <from> --out <to>`. */
export function sipsToJpeg(from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', from, '--out', to], { timeout: 30_000 }, (error) => (error ? reject(error) : resolve()))
  })
}

export class PhotoError extends Error {}

/** Writes the photos into `dir`; returns their paths in order. Rejects with a PhotoError (user-facing) on a bad photo. */
export async function savePhotos(dir: string, photos: readonly RemotePhoto[], toJpeg: (from: string, to: string) => Promise<void> = sipsToJpeg): Promise<string[]> {
  if (photos.length === 0) return []
  await mkdir(dir, { recursive: true })
  const paths: string[] = []
  for (const photo of photos) {
    const bytes = Buffer.from(photo.data, 'base64')
    if (bytes.length === 0 || bytes.length > REMOTE_LIMITS.photoBytes) throw new PhotoError('照片太大')
    const type = sniffPhoto(bytes)
    if (!type) throw new PhotoError('不支持这种图片格式')
    const stem = join(dir, `phone-${Date.now()}-${randomBytes(3).toString('hex')}`)
    if (type !== 'heic') {
      await writeFile(`${stem}.${type}`, bytes)
      paths.push(`${stem}.${type}`)
      continue
    }
    await writeFile(`${stem}.heic`, bytes)
    try {
      await toJpeg(`${stem}.heic`, `${stem}.jpg`)
    } catch {
      throw new PhotoError('没能把 HEIC 照片转成 JPEG')
    } finally {
      await unlink(`${stem}.heic`).catch(() => undefined)
    }
    paths.push(`${stem}.jpg`)
  }
  return paths
}
