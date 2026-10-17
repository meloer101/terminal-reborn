import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff'

const DIFF = `diff --git a/src/nav.ts b/src/nav.ts
index 1111111..2222222 100644
--- a/src/nav.ts
+++ b/src/nav.ts
@@ -24,4 +24,5 @@ export function MobileNav() {
   const ref = useRef(null)
-  const [offset, setOffset] = useState(0)
+  const [hidden, setHidden] = useState(false)
+  const max = 1

   return ref
\\ No newline at end of file
`

describe('parseUnifiedDiff', () => {
  it('numbers both sides and keeps hunk headers', () => {
    const { rows, binary, truncated } = parseUnifiedDiff(DIFF)
    expect(binary).toBe(false)
    expect(truncated).toBe(0)
    expect(rows).toEqual([
      { kind: 'hunk', old: null, new: null, text: '@@ -24,4 +24,5 @@ export function MobileNav() {' },
      { kind: 'context', old: 24, new: 24, text: '  const ref = useRef(null)' },
      { kind: 'del', old: 25, new: null, text: '  const [offset, setOffset] = useState(0)' },
      { kind: 'add', old: null, new: 25, text: '  const [hidden, setHidden] = useState(false)' },
      { kind: 'add', old: null, new: 26, text: '  const max = 1' },
      { kind: 'context', old: 26, new: 27, text: '' },
      { kind: 'context', old: 27, new: 28, text: '  return ref' }
    ])
  })

  it('does not read the next file header as removed lines', () => {
    const two = `${DIFF}diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n`
    const { rows } = parseUnifiedDiff(two)
    expect(rows.slice(-3).map((r) => r.kind)).toEqual(['hunk', 'del', 'add'])
    expect(rows.filter((r) => r.text.startsWith('-- a/'))).toEqual([])
  })

  it('reports binary files', () => {
    const { rows, binary } = parseUnifiedDiff('diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n')
    expect(binary).toBe(true)
    expect(rows).toEqual([])
  })

  it('caps the rows and counts what it left out', () => {
    const body = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join('\n')
    const { rows, truncated } = parseUnifiedDiff(`@@ -0,0 +1,50 @@\n${body}\n`, 10)
    expect(rows).toHaveLength(10)
    expect(truncated).toBe(41)
  })

  it('handles an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual({ rows: [], binary: false, truncated: 0 })
  })
})
