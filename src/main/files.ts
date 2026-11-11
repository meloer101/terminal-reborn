import { app, ipcMain } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, sep } from 'node:path'
import { IPC, type ImageExtension } from '@shared/ipc'
import type { InlineImage } from '@shared/transcript-chat'

const IMAGE_EXTENSIONS = new Set<ImageExtension>(['png', 'jpg', 'gif', 'webp'])
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

const attachmentsDir = (): string => join(app.getPath('temp'), 'wavi', 'attachments')

const SENT_EXTENSIONS: Readonly<Record<string, ImageExtension>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/**
 * A picture a GUI message carried inline, as a file the chat can draw (Figma 71A): `sent-<hash>.<ext>` in the
 * attachments folder, written the first time it is seen, so reading a conversation again finds the same file. Null for
 * a type the chat does not draw, or when it cannot be written. Synchronous: the chat item that names it is built in
 * the same step, and the renderer loads the file as soon as it gets the item.
 */
export function keepInlineImage(image: InlineImage, dir: string = attachmentsDir()): string | null {
  const extension = SENT_EXTENSIONS[image.mediaType]
  if (!extension || image.data.length === 0) return null
  const hash = createHash('sha256').update(image.data).digest('hex').slice(0, 32)
  const file = join(dir, `sent-${hash}.${extension}`)
  if (existsSync(file)) return file
  // Written under another name and renamed: a write cut short never stands in for the picture.
  const partial = `${file}.${randomBytes(3).toString('hex')}.partial`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(partial, Buffer.from(image.data, 'base64'))
    renameSync(partial, file)
    return file
  } catch (error) {
    rmSync(partial, { force: true })
    console.warn(`[gui] could not keep a sent picture at ${file}:`, error)
    return null
  }
}

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
