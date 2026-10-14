import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { loadSettingsFile, SettingsWriter, type SettingsFs } from './settings-file'

const PATH = '/data/settings.json'

/** An in-memory fs with injectable failures. */
function memoryFs(files: Record<string, string> = {}, failWrites: Array<Error | null> = []) {
  const state = { files: { ...files }, renames: [] as Array<[string, string]> }
  const fs: SettingsFs = {
    readFileSync: (path) => {
      const text = state.files[path]
      if (text === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return text
    },
    renameSync: (from, to) => {
      state.renames.push([from, to])
      state.files[to] = state.files[from] ?? ''
      delete state.files[from]
    },
    writeFile: (path, data) => {
      const failure = failWrites.shift()
      if (failure) return Promise.reject(failure)
      state.files[path] = data
      return Promise.resolve()
    },
    rename: (from, to) => {
      state.files[to] = state.files[from] ?? ''
      delete state.files[from]
      return Promise.resolve()
    }
  }
  return { fs, state }
}

describe('loadSettingsFile', () => {
  const log = vi.fn()

  it('returns defaults without a backup when the file does not exist', () => {
    const { fs, state } = memoryFs()
    const result = loadSettingsFile(PATH, fs, () => 1, log)
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.backupPath).toBeUndefined()
    expect(state.renames).toEqual([])
  })

  it('reads and sanitizes a valid file', () => {
    const { fs } = memoryFs({ [PATH]: JSON.stringify({ version: 1, appearance: { fontSize: 15 } }) })
    expect(loadSettingsFile(PATH, fs, () => 1, log).settings.appearance.fontSize).toBe(15)
  })

  it('backs a corrupt file up as settings.json.bad-<ts> before falling back to defaults', () => {
    const { fs, state } = memoryFs({ [PATH]: '{"appearance": {' })
    const result = loadSettingsFile(PATH, fs, () => 1234, log)
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.backupPath).toBe(`${PATH}.bad-1234`)
    expect(state.files[`${PATH}.bad-1234`]).toBe('{"appearance": {')
    expect(state.files[PATH]).toBeUndefined()
  })

  it.each(['null', '[1,2]', '"text"', '42'])('treats valid JSON that is not an object (%s) as corrupt', (text) => {
    const { fs, state } = memoryFs({ [PATH]: text })
    const result = loadSettingsFile(PATH, fs, () => 9, log)
    expect(result.backupPath).toBe(`${PATH}.bad-9`)
    expect(state.files[`${PATH}.bad-9`]).toBe(text)
  })

  it('still returns defaults when the backup itself fails', () => {
    const { fs } = memoryFs({ [PATH]: 'garbage' })
    fs.renameSync = () => {
      throw new Error('EACCES')
    }
    const result = loadSettingsFile(PATH, fs, () => 9, log)
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.backupPath).toBeUndefined()
  })
})

describe('SettingsWriter', () => {
  const quiet = vi.fn()
  const a = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, fontSize: 12 } }
  const b = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, fontSize: 18 } }

  it('writes via a temp file and rename', async () => {
    const { fs, state } = memoryFs()
    await new SettingsWriter(PATH, vi.fn(), fs, quiet).write(a)
    expect(JSON.parse(state.files[PATH] ?? '')).toEqual(a)
    expect(state.files[`${PATH}.tmp`]).toBeUndefined()
  })

  it('keeps writing after a failure, in order, and reports each failure', async () => {
    const { fs, state } = memoryFs({}, [new Error('ENOSPC: no space left'), null, new Error('EIO')])
    const errors: string[] = []
    const writer = new SettingsWriter(PATH, (e) => errors.push(e.message), fs, quiet)

    const first = writer.write(a) // fails
    const second = writer.write(b) // must still happen
    await Promise.all([first, second])
    expect(JSON.parse(state.files[PATH] ?? '')).toEqual(b)
    expect(errors).toEqual(['ENOSPC: no space left'])

    await writer.write(a) // fails again, still not stuck
    await writer.write(b)
    expect(errors).toEqual(['ENOSPC: no space left', 'EIO'])
    expect(JSON.parse(state.files[PATH] ?? '')).toEqual(b)
  })

  it('never rejects, even when the failure is not an Error', async () => {
    const { fs } = memoryFs()
    fs.writeFile = () => Promise.reject('plain string')
    const errors: Error[] = []
    await expect(new SettingsWriter(PATH, (e) => errors.push(e), fs, quiet).write(a)).resolves.toBeUndefined()
    expect(errors[0]?.message).toBe('plain string')
  })

  it('a failing rename is reported like a failing write', async () => {
    const { fs } = memoryFs()
    fs.rename = () => Promise.reject(new Error('EXDEV'))
    const errors: string[] = []
    await new SettingsWriter(PATH, (e) => errors.push(e.message), fs, quiet).write(a)
    expect(errors).toEqual(['EXDEV'])
  })
})
