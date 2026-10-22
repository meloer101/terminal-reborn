// 派出的会话 in the overview (PRD F21; no Figma frame yet — drawn like the 一题多解 section): one row per dispatcher
// with sessions still open, its name and each session it started as status glyph and name, then 比较 to put them
// side by side. Clicking a name goes to that session. Status is the glyph's shape plus text, never color alone.
import { useMemo } from 'react'
import { Split } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Session } from '@shared/types'
import { glyphStatus } from '../lifecycle/present'
import { GROUP_LABEL } from '../overview/model'
import { enterSession, showCompare } from '../overview/store'
import enterStyles from '../overview/EnterButton.module.css'
import { useWorkspace } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from '../attempts/AttemptGroups.module.css'
import local from './DispatchGroups.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

interface Group {
  parent: Session
  children: Session[]
}

export function DispatchGroups() {
  const { sessions, worktrees } = useWorkspace(useShallow((s) => ({ sessions: s.sessions, worktrees: s.worktrees })))
  const groups = useMemo((): Group[] => {
    const archived = new Set(worktrees.filter((w) => w.archived).map((w) => w.id))
    const open = sessions.filter((s) => !archived.has(s.worktreeId))
    return open.flatMap((parent) => {
      const children = open.filter((s) => s.dispatchedBy === parent.id)
      return children.length > 0 ? [{ parent, children }] : []
    })
  }, [sessions, worktrees])
  if (groups.length === 0) return null
  return (
    <section className={styles.section} aria-label="派出的会话" data-testid="dispatch-groups">
      <div className={styles.header}>
        <h2>派出的会话</h2>
        <span className={styles.count}>{groups.length}</span>
      </div>
      {groups.map((g) => (
        <div key={g.parent.id} className={styles.row} data-testid="dispatch-group" data-parent-id={g.parent.id}>
          <span className={styles.icon}>
            <Split {...ICON} />
          </span>
          <button type="button" className={`${styles.task} ${local.link}`} title={`前往「${g.parent.title}」`} onClick={() => enterSession(g.parent.id)}>
            {g.parent.title}
          </button>
          <span className={styles.members}>
            {g.children.map((child) => {
              const status = glyphStatus(child)
              const text = `${child.title} · ${GROUP_LABEL[status]}`
              return (
                <button
                  key={child.id}
                  type="button"
                  className={`${styles.member} ${local.link}`}
                  title={text}
                  aria-label={text}
                  data-member-id={child.id}
                  onClick={() => enterSession(child.id)}
                >
                  <StatusGlyph status={status} />
                  <span>{child.title}</span>
                </button>
              )
            })}
          </span>
          <span className={styles.spacer} />
          {g.children.length >= 2 && (
            <button
              type="button"
              className={enterStyles.enter}
              title="在浮层里并排看这几个会话的终端"
              onClick={() => showCompare(`dispatch:${g.parent.id}`, g.children.slice(0, 4).map((c) => c.id))}
            >
              比较
            </button>
          )}
        </div>
      ))}
    </section>
  )
}
