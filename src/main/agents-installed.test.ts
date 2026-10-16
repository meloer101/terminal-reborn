import { describe, expect, it } from 'vitest'
import { findOnPath, pathFromEnvOutput } from './agents-installed'

describe('pathFromEnvOutput', () => {
  it('takes the last PATH= line and ignores rc-file noise', () => {
    expect(pathFromEnvOutput('Welcome!\nPATH=/usr/bin\nHOME=/Users/a\nPATH=/opt/bin:/usr/bin\n')).toBe('/opt/bin:/usr/bin')
    expect(pathFromEnvOutput('HOME=/Users/a\n')).toBeNull()
    expect(pathFromEnvOutput('PATH=\n')).toBeNull()
  })
})

describe('findOnPath', () => {
  it('looks for each agent in the absolute PATH entries only', () => {
    const files = new Set(['/Users/a/.volta/bin/claude', 'bin/codex'])
    expect(findOnPath('/usr/bin:/Users/a/.volta/bin:bin', (p) => files.has(p))).toEqual({ claude: true, codex: false })
    expect(findOnPath('', () => true)).toEqual({ claude: false, codex: false })
  })
})
