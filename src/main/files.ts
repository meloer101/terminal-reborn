import { app, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC, type ImageExtension } from '@shared/ipc'

const IMAGE_EXTENSIONS = new Set<ImageExtension>(['png', 'jpg', 'gif', 'webp'])
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.filesSaveTempImage, async (_event, data: unknown, extension: unknown) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength > MAX_IMAGE_BYTES) throw new Error('invalid image data')
    if (!IMAGE_EXTENSIONS.has(extension as ImageExtension)) throw new Error('unsupported image type')
    const dir = join(app.getPath('temp'), 'wavi', 'attachments')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `paste-${Date.now()}-${randomBytes(3).toString('hex')}.${extension as string}`)
    await writeFile(file, Buffer.from(data))
    return file
  })
}
