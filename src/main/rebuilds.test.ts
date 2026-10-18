import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareBuilds, readBuildSignature } from './rebuilds'

describe('compareBuilds', () => {
  const base = { renderer: 'r1', backend: 'b1' }

  it('reloads on a new renderer bundle only', () => {
    expect(compareBuilds(base, { renderer: 'r2', backend: 'b1' })).toEqual({ reloadRenderer: true, restartApp: false })
  })

  it('restarts on a new main or preload build, which also covers the renderer', () => {
    expect(compareBuilds(base, { renderer: 'r2', backend: 'b2' })).toEqual({ reloadRenderer: false, restartApp: true })
  })

  it('does nothing for the same build written again', () => {
    expect(compareBuilds(base, { ...base })).toEqual({ reloadRenderer: false, restartApp: false })
  })

  it('waits while a part is missing (mid-build)', () => {
    expect(compareBuilds(base, { renderer: null, backend: 'b2' })).toEqual({ reloadRenderer: false, restartApp: false })
    expect(compareBuilds(base, { renderer: 'r2', backend: null })).toEqual({ reloadRenderer: false, restartApp: false })
  })

  it('has nothing to compare against when the first read was incomplete', () => {
    expect(compareBuilds({ renderer: null, backend: null }, base)).toEqual({ reloadRenderer: false, restartApp: false })
  })
})

describe('readBuildSignature', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function writeOut(files: Record<string, string>): void {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
  }

  it('changes the backend part with any main or preload file, the renderer part with index.html', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tr-rebuilds-'))
    writeOut({ 'main/index.js': 'a', 'main/chunks/x.js': 'x', 'preload/index.js': 'p', 'renderer/index.html': '<a1>' })
    const first = await readBuildSignature(dir)
    expect(first.renderer).toBe('<a1>')
    expect(first.backend).not.toBeNull()

    writeOut({ 'main/chunks/x.js': 'y' })
    const second = await readBuildSignature(dir)
    expect(second.renderer).toBe(first.renderer)
    expect(second.backend).not.toBe(first.backend)
  })

  it('reports missing parts as null', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tr-rebuilds-'))
    writeOut({ 'main/index.js': 'a' })
    expect(await readBuildSignature(dir)).toEqual({ renderer: null, backend: null })
  })
})
