import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => unknown>())
const workspaceDirs = vi.hoisted(() => new Set<string>())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler), on: () => {} },
  shell: { openPath: async () => '', showItemInFolder: () => {} }
}))
vi.mock('./workspace-store', () => ({ isWorkspaceDir: (path: string) => workspaceDirs.has(path) }))

const { IPC } = await import('@shared/ipc')
const { classifyChange, inGeneratedFolder, isInside, normalizeRelative, openAction, openWorktreeEntry, registerWorktreeFileHandlers, resolveFileLinks, walkFiles, watchesRecursively } =
  await import('./worktree-files')

describe('normalizeRelative', () => {
  it('accepts plain relative paths and the root', () => {
    expect(normalizeRelative('')).toBe('')
    expect(normalizeRelative('.')).toBe('')
    expect(normalizeRelative('src/components/')).toBe('src/components')
    expect(normalizeRelative('src/./a/../b.ts')).toBe('src/b.ts')
  })

  it('rejects anything that leaves the root or is not a string path', () => {
    expect(normalizeRelative('..')).toBeNull()
    expect(normalizeRelative('../x')).toBeNull()
    expect(normalizeRelative('src/../../x')).toBeNull()
    expect(normalizeRelative('/etc/passwd')).toBeNull()
    expect(normalizeRelative('a\0b')).toBeNull()
    expect(normalizeRelative(42)).toBeNull()
    expect(normalizeRelative('x'.repeat(5000))).toBeNull()
  })
})

describe('isInside', () => {
  it('compares resolved paths', () => {
    expect(isInside('/code/app', '/code/app')).toBe(true)
    expect(isInside('/code/app', '/code/app/src/a.ts')).toBe(true)
    expect(isInside('/code/app', '/code/app-other/a.ts')).toBe(false)
    expect(isInside('/code/app', '/code')).toBe(false)
    expect(isInside('/code/app', '/etc/passwd')).toBe(false)
  })

  it('allows names that merely start with two dots', () => {
    expect(isInside('/code/app', '/code/app/..hidden')).toBe(true)
  })
})

describe('classifyChange', () => {
  it('maps a changed file to the folder whose listing it affects', () => {
    expect(classifyChange('src/components/Nav.tsx')).toEqual({ dir: 'src/components', git: false, code: true })
    expect(classifyChange('README.md')).toEqual({ dir: '', git: false, code: true })
  })

  it('still lists dependency and cache folders, but not as code', () => {
    expect(classifyChange('node_modules/react/index.js')).toEqual({ dir: 'node_modules/react', git: false, code: false })
    expect(classifyChange('.next/cache/webpack/a.pack')).toEqual({ dir: '.next/cache/webpack', git: false, code: false })
  })

  it('keeps only git bookkeeping that changes the status', () => {
    expect(classifyChange('.git/index')).toEqual({ dir: '', git: true, code: false })
    expect(classifyChange('.git/HEAD')).toEqual({ dir: '', git: true, code: false })
    expect(classifyChange('.git/refs/heads/main')).toEqual({ dir: '', git: true, code: false })
    expect(classifyChange('.git/objects/ab/cdef')).toBeNull()
    expect(classifyChange('.git/logs/HEAD')).toBeNull()
  })
})

describe('inGeneratedFolder', () => {
  it('matches dependency folders at any depth', () => {
    expect(inGeneratedFolder('node_modules/a/b.js')).toBe(true)
    expect(inGeneratedFolder('packages/web/node_modules/a/b.js')).toBe(true)
    expect(inGeneratedFolder('pkg/__pycache__/m.cpython-312.pyc')).toBe(true)
  })

  it('matches build caches only at the top, where the name is unambiguous', () => {
    expect(inGeneratedFolder('.next/server/app.js')).toBe(true)
    expect(inGeneratedFolder('target/debug/app')).toBe(true)
    expect(inGeneratedFolder('src/target/aim.ts')).toBe(false)
    expect(inGeneratedFolder('docs/.cache/notes.md')).toBe(false)
  })

  it('never matches a file named like a folder, or source', () => {
    expect(inGeneratedFolder('node_modules')).toBe(false)
    expect(inGeneratedFolder('target')).toBe(false)
    expect(inGeneratedFolder('src/node_modules_shim.ts')).toBe(false)
    expect(inGeneratedFolder('src/index.ts')).toBe(false)
  })
})

describe('resolveFileLinks', () => {
  const outside = mkdtempSync(join(tmpdir(), 'tr-links-out-'))
  writeFileSync(join(outside, 'secret.txt'), 'x')
  const root = mkdtempSync(join(tmpdir(), 'tr-links-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'app.ts'), 'x')
  writeFileSync(join(root, 'README.md'), 'x')
  symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'))

  it('keeps existing files inside the worktree, as relative paths', async () => {
    expect(await resolveFileLinks(root, ['src/app.ts', './README.md', 'src/../README.md'])).toEqual(['src/app.ts', 'README.md', 'README.md'])
  })

  it('accepts absolute paths inside the root, under its real path too', async () => {
    expect(await resolveFileLinks(root, [join(root, 'src', 'app.ts'), join(realpathSync(root), 'README.md')])).toEqual(['src/app.ts', 'README.md'])
  })

  it('refuses folders, missing files, paths outside and symlinks leading out', async () => {
    expect(
      await resolveFileLinks(root, ['src', 'nope.ts', '../x.ts', join(outside, 'secret.txt'), 'escape.txt', '/etc/hosts', '', 42])
    ).toEqual([null, null, null, null, null, null, null, null])
  })

  it('rejects a bad payload', async () => {
    await expect(resolveFileLinks(root, 'src/app.ts')).rejects.toThrow()
    await expect(resolveFileLinks(root, Array.from({ length: 65 }, () => 'a.ts'))).rejects.toThrow()
    await expect(resolveFileLinks('relative/root', ['a.ts'])).rejects.toThrow()
  })
})

describe('a root that contains Desktop, Documents and Downloads (the home directory)', () => {
  // A stand-in home: a note, a project, and the three protected folders with a file each.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tr-home-')))
  const desktop = join(home, 'Desktop')
  const documents = join(home, 'Documents')
  const downloads = join(home, 'Downloads')
  for (const dir of [desktop, documents, downloads, join(home, 'code', 'app')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(home, 'notes.txt'), 'x')
  writeFileSync(join(home, 'code', 'app', 'main.ts'), 'x')
  writeFileSync(join(desktop, 'todo.txt'), 'x')
  writeFileSync(join(documents, 'cv.txt'), 'x')
  writeFileSync(join(downloads, 'a.zip'), 'x')
  mkdirSync(join(desktop, 'nested'))
  writeFileSync(join(desktop, 'nested', 'deep.txt'), 'x')
  const folders = [desktop, documents, downloads]

  it('is walked without entering any of them', async () => {
    expect((await walkFiles(home, folders)).sort()).toEqual(['code/app/main.ts', 'notes.txt'])
  })

  it('is watched for its own entries only, not recursively', () => {
    expect(watchesRecursively(home, folders)).toBe(false)
    expect(watchesRecursively(join(home, 'code', 'app'), folders)).toBe(true)
  })

  it('does not resolve a path printed under them, but still resolves the rest', async () => {
    expect(
      await resolveFileLinks(home, ['notes.txt', 'code/app/main.ts', 'Desktop/todo.txt', join(desktop, 'nested', 'deep.txt'), join(documents, 'cv.txt'), 'Downloads/../Downloads/a.zip'], folders)
    ).toEqual(['notes.txt', 'code/app/main.ts', null, null, null, null])
  })

  it('leaves a project inside Desktop alone: the user chose that folder', async () => {
    expect((await walkFiles(desktop, folders)).sort()).toEqual(['nested/deep.txt', 'todo.txt'])
    expect(watchesRecursively(desktop, folders)).toBe(true)
    expect(await resolveFileLinks(desktop, ['todo.txt', 'nested/deep.txt'], folders)).toEqual(['todo.txt', 'nested/deep.txt'])
  })
})

describe('the IPC handlers take only the workspace’s own folders as a root', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tr-wt-ipc-')))
  writeFileSync(join(root, 'a.txt'), 'a\n')
  workspaceDirs.add(root)
  registerWorktreeFileHandlers()
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!({}, ...args))

  it('lists, reads and resolves inside a workspace folder', async () => {
    expect(await invoke(IPC.worktreeListDir, root, '')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'a.txt' })]))
    expect(await invoke(IPC.worktreeResolveLinks, root, ['a.txt'])).toEqual(['a.txt'])
  })

  it('refuses any other folder, however real (/, a folder above the workspace)', async () => {
    for (const other of ['/', tmpdir()]) {
      await expect(invoke(IPC.worktreeListDir, other, '')).rejects.toThrow(/not a workspace folder/)
      await expect(invoke(IPC.worktreeReadFile, other, 'etc/hosts')).rejects.toThrow(/not a workspace folder/)
      await expect(invoke(IPC.worktreeOpen, other, 'x')).rejects.toThrow(/not a workspace folder/)
    }
  })
})

describe('用默认编辑器打开 never runs what it opens', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tr-wt-open-')))
  const file = (name: string, text: string, mode = 0o644) => {
    writeFileSync(join(dir, name), text)
    chmodSync(join(dir, name), mode)
    return join(dir, name)
  }
  mkdirSync(join(dir, 'Tool.app'))
  mkdirSync(join(dir, 'src'))

  it('opens plain files and folders as before', async () => {
    expect(await openAction(file('notes.md', '# hi\n'))).toBe('open')
    expect(await openAction(join(dir, 'src'))).toBe('open')
  })

  it('opens scripts that would run as text, and shows bundles and binaries in Finder', async () => {
    expect(await openAction(file('deploy.command', 'rm -rf build\n'))).toBe('text')
    expect(await openAction(file('build.sh', 'make\n', 0o755))).toBe('text')
    expect(await openAction(file('tool', 'bin\0ary', 0o755))).toBe('reveal')
    expect(await openAction(join(dir, 'Tool.app'))).toBe('reveal')
  })

  it('hands each case to its opener', async () => {
    const calls: string[] = []
    const openers = { openPath: async (p: string) => (calls.push(`open ${p}`), ''), openText: async (p: string) => (calls.push(`text ${p}`), ''), reveal: (p: string) => void calls.push(`reveal ${p}`) }
    await openWorktreeEntry(join(dir, 'deploy.command'), openers)
    await openWorktreeEntry(join(dir, 'Tool.app'), openers)
    await openWorktreeEntry(join(dir, 'notes.md'), openers)
    expect(calls).toEqual([`text ${join(dir, 'deploy.command')}`, `reveal ${join(dir, 'Tool.app')}`, `open ${join(dir, 'notes.md')}`])
  })
})
