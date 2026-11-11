import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, ipcMain: { handle: () => {} } }))

const { dragTempFile } = await import('./files')

describe('dragTempFile', () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'tr-files-')))
  const lent = join(temp, 'TemporaryItems', 'NSIRD_screencaptureui_AbC')
  mkdirSync(lent, { recursive: true })
  writeFileSync(join(lent, 'shot.png'), 'png')
  mkdirSync(join(lent, 'folder'))
  writeFileSync(join(temp, 'secret.txt'), 'x')
  symlinkSync(join(temp, 'secret.txt'), join(lent, 'link.png'))

  it('takes a file macOS lent for a drag', async () => {
    expect(await dragTempFile(join(lent, 'shot.png'), temp)).toBe(join(lent, 'shot.png'))
  })

  it('leaves everything else alone: other folders, folders, links out, missing files, relative paths', async () => {
    expect(await dragTempFile(join(temp, 'secret.txt'), temp)).toBeNull()
    expect(await dragTempFile(join(lent, 'folder'), temp)).toBeNull()
    expect(await dragTempFile(join(lent, 'link.png'), temp)).toBeNull()
    expect(await dragTempFile(join(lent, 'gone.png'), temp)).toBeNull()
    expect(await dragTempFile(join(lent, '..', '..', 'secret.txt'), temp)).toBeNull()
    expect(await dragTempFile('shot.png', temp)).toBeNull()
  })
})

describe('keepInlineImage', () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'tr-sent-'))), 'attachments')
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

  it('writes a sent picture once, under a name its bytes pick, and finds it again', async () => {
    const { keepInlineImage } = await import('./files')
    const path = keepInlineImage({ mediaType: 'image/png', data: png }, dir)
    expect(path).toMatch(/\/sent-[0-9a-f]{32}\.png$/)
    expect(readFileSync(path!)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'))
    expect(keepInlineImage({ mediaType: 'image/png', data: png }, dir)).toBe(path)
    expect(keepInlineImage({ mediaType: 'image/jpeg', data: 'AAAA' }, dir)).toMatch(/\.jpg$/)
    expect(readdirSync(dir).filter((name) => name.endsWith('.partial'))).toEqual([])
  })

  it('keeps no file for a type the chat does not draw', async () => {
    const { keepInlineImage } = await import('./files')
    expect(keepInlineImage({ mediaType: 'image/heic', data: png }, dir)).toBeNull()
  })
})
