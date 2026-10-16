import { describe, expect, it } from 'vitest'
import { describeAllowAlways } from './permission-scope'

describe('describeAllowAlways', () => {
  it('reads Bash rules kept for the session', () => {
    expect(
      describeAllowAlways([
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'pnpm prisma:*' }], behavior: 'allow', destination: 'session' }
      ])
    ).toEqual({ scope: 'session', rules: [{ tool: 'Bash', content: 'pnpm prisma:*' }], directories: [] })
  })

  it('a rule saved to the project settings makes the whole scope the project', () => {
    expect(
      describeAllowAlways([
        { type: 'addDirectories', directories: ['/repo/lib'], destination: 'session' },
        { type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'allow', destination: 'localSettings' }
      ])
    ).toEqual({ scope: 'project', rules: [{ tool: 'Edit' }], directories: ['/repo/lib'] })
  })

  it('ignores deny rules, mode switches and malformed entries; null when nothing is left', () => {
    expect(
      describeAllowAlways([
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }], behavior: 'deny', destination: 'projectSettings' },
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
        { type: 'addRules', rules: [{ ruleContent: 'no tool' }, 'x'], behavior: 'allow', destination: 'projectSettings' },
        null,
        'addRules'
      ])
    ).toBeNull()
    expect(describeAllowAlways([])).toBeNull()
  })
})
