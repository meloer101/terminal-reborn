// CLAUDE.md: colors, spacing, radii and type only via the variables in tokens.css. The styles from before this check
// still break it in places (BASELINE): a file may get better, never worse, and a new file starts clean.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const TOKENS = join(__dirname, 'tokens.css')

/** Spacing and radius properties: a literal length there belongs in a token. */
const SPACING = /^\s*(?:margin|padding|gap|row-gap|column-gap|border(?:-[a-z]+)*-radius)(?:-[a-z]+)?\s*:\s*(.+)$/
/** A non-zero px length (0px and the 0 of `0 4px` do not count). */
const LITERAL_PX = /(?<![\w.-])(?:[1-9]\d*(?:\.\d+)?|0?\.\d+)px\b/g
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') && path !== TOKENS ? [path] : []
  })
}

/** Literal px in spacing / radius declarations and hex colors, per file (comments left out). */
export function violations(css: string): number {
  let count = 0
  // One declaration at a time, however the rule is laid out.
  for (const declaration of css.replace(/\/\*[\s\S]*?\*\//g, '').split(/[;{}]/)) {
    const spacing = SPACING.exec(declaration)
    if (spacing) count += spacing[1]!.match(LITERAL_PX)?.length ?? 0
    count += declaration.match(HEX_COLOR)?.length ?? 0
  }
  return count
}

/** Counts when this check was added (2026-11-06): lower one when you fix a file, never raise it. */
const BASELINE: Record<string, number> = {
  'attempts/AfterMerge.module.css': 1,
  'attempts/AttemptGroups.module.css': 1,
  'dispatch/DispatchStrip.module.css': 1,
  'gui/Chat.module.css': 14,
  'overview/Overview.module.css': 3,
  'overview/SessionOverlay.module.css': 3,
  'panels/files/FilesView.module.css': 1,
  'panels/files/MarkdownView.module.css': 1,
  'panels/git/GitView.module.css': 4,
  'panels/merge/MergeSheet.module.css': 1,
  'panels/worktree/WorktreeView.module.css': 1,
  'review/ReviewBlock.module.css': 1,
  'session-header/SessionHeader.module.css': 1,
  'session-meta/SessionMeta.module.css': 10,
  'settings/AppearancePane.module.css': 5,
  'settings/PhonePane.module.css': 2,
  'settings/PreviewTerminal.module.css': 2,
  'settings/UsagePane.module.css': 3,
  'settings/WorktreePane.module.css': 2,
  'settings/controls.module.css': 15,
  'sidebar/SelectionDrop.module.css': 4,
  'sidebar/UpdateEntry.module.css': 1,
  'split/SplitArea.module.css': 4,
  'ui/Segmented.module.css': 1
}

describe('styles use the tokens (CLAUDE.md Conventions)', () => {
  it('counts literal px in spacing and radius, and hex colors', () => {
    expect(violations('.a { padding: 8px 0; margin: 0 var(--space-2); color: #fff; }\n.b { gap: 0px; border-top-left-radius: 2.5px; }')).toBe(3)
    expect(violations('.a {\n  padding: 8px 0;\n  color: #fff;\n  gap: 0px;\n  border-top-left-radius: 2.5px;\n  /* #000 */\n}')).toBe(3)
  })

  it('has no file worse than when the check was added, and new files start clean', () => {
    const counts = Object.fromEntries(cssFiles(ROOT).map((path) => [relative(ROOT, path), violations(readFileSync(path, 'utf8'))]))
    const worse = Object.entries(counts).filter(([file, count]) => count > (BASELINE[file] ?? 0))
    expect(worse, 'use the variables in src/renderer/styles/tokens.css').toEqual([])
  })
})
