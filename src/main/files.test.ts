import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
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
