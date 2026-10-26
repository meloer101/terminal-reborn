import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TERMINAL_TOKENS, type TerminalTone } from '@shared/terminal-tokens'

const css = readFileSync(resolve(__dirname, '../renderer/styles/tokens.css'), 'utf8')

/** The `--term-*` declarations of the block opened by `selector`. */
function termVars(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  expect(start, `${selector} in tokens.css`).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  const vars: Record<string, string> = {}
  for (const match of body.matchAll(/(--term-[a-z-]+):\s*([^;]+);/g)) vars[match[1] as string] = (match[2] as string).trim()
  return vars
}

describe('TERMINAL_TOKENS', () => {
  const blocks: Record<TerminalTone, string> = { dark: ":root[data-theme='dark']", light: ":root[data-theme='light']" }
  for (const tone of ['dark', 'light'] as const) {
    it(`${tone} matches tokens.css`, () => {
      const vars = termVars(blocks[tone])
      for (const [name, value] of Object.entries(TERMINAL_TOKENS[tone])) {
        expect(vars[name], name).toBe(value)
      }
    })
  }
})
