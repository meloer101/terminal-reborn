// The project in an empty GUI session's welcome line (Figma 65H / 65I): its name on a grey block without a border.
// Hovered, the block darkens, ⇅ shows at its end and the projects before and after it peek above and below; the wheel
// (or ↑↓ when it has the keyboard) steps through them in the sidebar's order. Only the name moves while stepping: the
// session moves (its agent restarts there) once the wheel has been still for a moment, so a trackpad swipe through
// several projects restarts the agent once.
import { useEffect, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { wheelSteps } from './model'
import styles from './Chat.module.css'

/** How long the wheel stays still before the session moves to the project shown. */
const SETTLE_MS = 400

export interface ProjectChoice {
  projectId: string
  name: string
  worktreeId: string
}

export function ProjectChip({ choices, current, onPick }: { choices: readonly ProjectChoice[]; current: string; onPick(choice: ProjectChoice): void }) {
  const at = Math.max(0, choices.findIndex((c) => c.projectId === current))
  // What the wheel has stepped to, from where the session was (it moved, or the list changed: back to where it is).
  const [view, setView] = useState({ from: at, shown: at })
  if (view.from !== at) setView({ from: at, shown: at })
  const shown = view.from === at ? view.shown : at
  const setShown = (next: number) => setView({ from: at, shown: next })
  const [hover, setHover] = useState(false)
  const rest = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const n = choices.length
  const choice = choices[shown] ?? choices[at]
  if (!choice) return null
  const switchable = n > 1
  const step = (by: number): void => {
    if (!switchable || by === 0) return
    const next = (((shown + by) % n) + n) % n
    setShown(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      if (next !== at) onPick(choices[next]!)
    }, SETTLE_MS)
  }
  const before = choices[(shown - 1 + n) % n]
  const after = choices[(shown + 1) % n]

  return (
    <span
      className={styles.projectChip}
      data-testid="gui-project"
      data-switchable={switchable || undefined}
      tabIndex={switchable ? 0 : undefined}
      aria-label={switchable ? `项目 ${choice.name}` : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onWheel={(e) => {
        if (!switchable) return
        const next = wheelSteps(rest.current, e.deltaY)
        rest.current = next.rest
        step(next.steps)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        step(e.key === 'ArrowDown' ? 1 : -1)
      }}
    >
      <span className={styles.projectName}>{choice.name}</span>
      {switchable && hover && (
        <>
          <ChevronsUpDown size={16} strokeWidth={1.75} aria-hidden />
          {n > 2 && before && (
            <span className={styles.projectPeek} data-at="before" aria-hidden>
              {before.name}
            </span>
          )}
          {after && (
            <span className={styles.projectPeek} data-at="after" aria-hidden>
              {after.name}
            </span>
          )}
        </>
      )}
    </span>
  )
}
