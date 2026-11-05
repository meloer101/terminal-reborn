import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PhotoError, savePhotos, sniffPhoto } from './photos'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(8)])

describe('sniffPhoto', () => {
  it('knows the photo types an iPhone sends, by their bytes', () => {
    expect(sniffPhoto(JPEG)).toBe('jpg')
    expect(sniffPhoto(PNG)).toBe('png')
    expect(sniffPhoto(Buffer.from('GIF89a……', 'latin1'))).toBe('gif')
    expect(sniffPhoto(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP', 'latin1')]))).toBe('webp')
    expect(sniffPhoto(HEIC)).toBe('heic')
    expect(sniffPhoto(Buffer.from('%PDF-1.7'))).toBeNull()
  })
})

describe('savePhotos', () => {
  it('writes JPEG and PNG as they are and turns HEIC into JPEG', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'photos-'))
    const converted: string[] = []
    const paths = await savePhotos(
      dir,
      [
        { name: 'a.jpg', data: JPEG.toString('base64') },
        { name: 'IMG_1.HEIC', data: HEIC.toString('base64') },
        { name: 'b', data: PNG.toString('base64') }
      ],
      async (from, to) => {
        converted.push(from)
        writeFileSync(to, JPEG)
      }
    )
    expect(paths.map((p) => p.slice(-4))).toEqual(['.jpg', '.jpg', '.png'])
    expect(readFileSync(paths[1]!)).toEqual(JPEG)
    expect(converted).toHaveLength(1)
    // The HEIC itself is not left behind.
    expect(existsSync(converted[0]!)).toBe(false)
  })

  it('refuses a file that is no photo, and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'photos-'))
    await expect(savePhotos(dir, [{ name: 'x.pdf', data: Buffer.from('%PDF-1.7').toString('base64') }])).rejects.toBeInstanceOf(PhotoError)
  })
})
