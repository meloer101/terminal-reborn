import { app, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { copyFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, sep } from 'node:path'
import { IPC, type ImageExtension } from '@shared/ipc'

const IMAGE_EXTENSIONS = new Set<ImageExtension>(['png', 'jpg', 'gif', 'webp'])
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

const attachmentsDir = (): string => join(app.getPath('temp'), 'wavi', 'attachments')

/**
 * macOS's folder for files handed over for one drag (`$TMPDIR/TemporaryItems/NSIRD_<app>_…/`): only the app that
 * took the drop may read them, so an agent under the pty daemon could not (renderer/terminal/attachments.ts).
 */
export async function dragTempFile(path: string, temp: string = tmpdir()): Promise<string | null> {
  if (path.length > 4096 || !isAbsolute(path) || path.includes('\0')) return null
  try {
    const real = await realpath(path)
    const root = join(await realpath(temp), 'TemporaryItems')
    const inside = real.startsWith(root + sep) && /^NSIRD_/.test(real.slice(root.length + 1))
    if (!inside) return null
    const stat = await lstat(real)
    return stat.isFile() && stat.size <= MAX_IMAGE_BYTES ? real : null
  } catch {
    return null
  }
}

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.filesKeepDropped, async (_event, path: unknown) => {
    if (typeof path !== 'string') throw new Error('invalid path')
    const source = await dragTempFile(path)
    if (!source) return path
    const dir = join(attachmentsDir(), `drop-${Date.now()}-${randomBytes(3).toString('hex')}`)
    await mkdir(dir, { recursive: true })
    const copy = join(dir, basename(source))
    await copyFile(source, copy)
    return copy
  })

  ipcMain.handle(IPC.filesSaveTempImage, async (_event, data: unknown, extension: unknown) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength > MAX_IMAGE_BYTES) throw new Error('invalid image data')
    if (!IMAGE_EXTENSIONS.has(extension as ImageExtension)) throw new Error('unsupported image type')
    const dir = attachmentsDir()
    await mkdir(dir, { recursive: true })
    const file = join(dir, `paste-${Date.now()}-${randomBytes(3).toString('hex')}.${extension as string}`)
    await writeFile(file, Buffer.from(data))
    return file
  })
}
