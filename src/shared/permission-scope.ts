// What "allow always" on a permission request would allow (phase 2b · B12), read from Claude's
// `permission_suggestions` (PermissionUpdate objects). Pure: main describes the suggestions it will hand
// back, the renderer turns the description into the option label ("允许，本会话不再询问 prisma").

export interface PermissionRule {
  /** Tool the rule covers ("Bash", "Edit", "WebFetch", …). */
  tool: string
  /** The rule's content when it is narrower than the whole tool: "pnpm prisma:*", "domain:example.com", a path. */
  content?: string
}

export interface AllowAlwaysScope {
  /** Where the rule is kept: this agent session only, or the project's own settings. */
  scope: 'session' | 'project'
  rules: PermissionRule[]
  /** Directories added to the session's working set. */
  directories: string[]
}

const MAX_ITEMS = 8
const MAX_TEXT = 300

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' && v.length <= MAX_TEXT ? v.trim() : null)

/**
 * Describes the suggestions that "allow always" would apply. The broadest destination wins: anything
 * saved outside the session (`localSettings`, `projectSettings`) makes it a project rule. Returns null when
 * nothing describable is offered (the UI then falls back to a generic label).
 */
export function describeAllowAlways(suggestions: readonly unknown[]): AllowAlwaysScope | null {
  const rules: PermissionRule[] = []
  const directories: string[] = []
  let scope: AllowAlwaysScope['scope'] = 'session'
  for (const s of suggestions) {
    if (!isRec(s)) continue
    let used = false
    if ((s.type === 'addRules' || s.type === 'replaceRules') && (s.behavior === undefined || s.behavior === 'allow')) {
      for (const r of Array.isArray(s.rules) ? s.rules : []) {
        const tool = isRec(r) ? text(r.toolName) : null
        if (!tool || !isRec(r)) continue
        const content = text(r.ruleContent)
        rules.push(content ? { tool, content } : { tool })
        used = true
      }
    } else if (s.type === 'addDirectories') {
      for (const d of Array.isArray(s.directories) ? s.directories : []) {
        const dir = text(d)
        if (dir) {
          directories.push(dir)
          used = true
        }
      }
    }
    if (used && s.destination !== undefined && s.destination !== 'session' && s.destination !== 'cliArg') scope = 'project'
  }
  if (rules.length === 0 && directories.length === 0) return null
  return { scope, rules: rules.slice(0, MAX_ITEMS), directories: directories.slice(0, MAX_ITEMS) }
}
