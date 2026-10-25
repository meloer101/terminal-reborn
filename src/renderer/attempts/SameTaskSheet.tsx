// 同任务多解 (PRD F4 v1.68, Figma 26D–26F): the task of a session, sent to 2–4 new worktrees off its branch, each
// running an installed agent. 汇报给 is the session itself: it is not one of the parts, it gets their report once they
// have all stopped and carries on (attempts/report.ts). 任务 starts from text selected in its terminal, the plan its
// agent waits on or what the user said in it, and can be edited; 份数 lists agents with − n ＋ and 加一个智能体 adds
// any installed one. No explanatory captions: the labels, the values and the button say what happens.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, GitBranch, GitFork, Globe, Minus, Plus } from 'lucide-react'
import {
  addAgentRow,
  attemptButtonLabel,
  attemptKinds,
  defaultRows,
  MAX_ATTEMPT_PROMPT,
  MAX_ATTEMPTS,
  planAttempts,
  sourceLabel,
  stepRow,
  type AttemptRow,
  type TaskSource
} from '@shared/attempt-groups'
import { AGENT_SPECS, agentName, CLI_AGENTS, type CliAgent } from '@shared/agents'
import { generateBranchName, groupBranches, type NewSessionInfo } from '@shared/new-session'
import type { AgentAvailability, AgentVersions } from '@shared/ipc'
import { useWorkspace } from '../state/workspace'
import { Field, SelectButton } from '../new-session/NewSessionSheet'
import { isElsewhere } from '../new-session/model'
import { SheetMenu, type SheetMenuSection } from '../new-session/SheetMenu'
import sheet from '../new-session/NewSessionSheet.module.css'
import { runAttemptPlan } from './actions'
import { closeSameTask, useSameTaskSheet } from './same-task-store'
import styles from './SameTaskSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function SameTaskSheet() {
  const sessionId = useSameTaskSheet((s) => s.sessionId)
  const generation = useSameTaskSheet((s) => s.generation)
  return sessionId ? <Dialog key={generation} /> : null
}

type Menu = 'source' | 'base' | 'agent'

function Dialog() {
  const sessionId = useSameTaskSheet((s) => s.sessionId)
  const sources = useSameTaskSheet((s) => s.sources)
  const session = useWorkspace((s) => s.sessions.find((x) => x.id === sessionId))
  const worktree = useWorkspace((s) => s.worktrees.find((w) => w.id === session?.worktreeId))
  const project = useWorkspace((s) => s.projects.find((p) => p.id === worktree?.projectId))

  const [info, setInfo] = useState<NewSessionInfo | 'error' | null>(null)
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [versions, setVersions] = useState<AgentVersions>({})
  const [source, setSource] = useState<TaskSource | null>(sources[0]?.source ?? null)
  const [task, setTask] = useState(sources[0]?.text ?? '')
  const [baseChoice, setBaseChoice] = useState<string | null>(null)
  const [rowsChoice, setRows] = useState<AttemptRow[] | null>(null)
  const [menu, setMenu] = useState<{ kind: Menu; anchor: HTMLElement } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const taskRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!project) return
    let live = true
    window.tr.gitWorktrees
      .newSessionInfo(project.rootPath)
      .then((next) => live && setInfo(next))
      .catch(() => live && setInfo('error'))
    return () => {
      live = false
    }
  }, [project])

  useEffect(() => {
    let live = true
    void window.tr.app
      .detectAgents()
      .then((next) => live && setFound(next))
      .catch(() => {})
    void window.tr.app
      .agentVersions()
      .then((next) => live && setVersions(next))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // The task when there is one to start from; otherwise the empty box takes the keyboard.
  useEffect(() => (sources.length > 0 ? ref.current : taskRef.current)?.focus(), [sources.length])

  const repo = info !== null && info !== 'error' && info.repo ? info : null
  const installed = useMemo(() => (found ? CLI_AGENTS.filter((id) => found[id] === true) : []), [found])
  const origin: CliAgent | null = session && session.kind !== 'shell' ? session.kind : null
  const rows = useMemo(() => rowsChoice ?? (found ? defaultRows(origin, installed) : []), [rowsChoice, found, origin, installed])
  const total = attemptKinds(rows).length
  // The session's own branch: the parts start from it, and the one merged goes back into it.
  const own = worktree && repo ? (worktree.isMain ? repo.currentBranch : worktree.branch) : null
  const base = baseChoice ?? own
  const stem = useMemo(() => {
    if (!repo) return ''
    if (base && base === own && !worktree?.isMain) return base
    return generateBranchName(repo.prefix, new Set(repo.branches.filter((b) => !b.remote).map((b) => b.name)))
  }, [repo, base, own, worktree?.isMain])
  const plan =
    project && repo && base
      ? planAttempts({
          root: project.rootPath,
          base,
          stem,
          rows,
          prompt: task,
          prepare: repo.includeCount > 0 || repo.hasSetup,
          branches: repo.branches,
          worktreesDir: repo.worktreesDir,
          takenFolders: repo.takenFolders
        })
      : null

  const send = (): void => {
    if (!session || !project || !base || !plan?.members) return
    closeSameTask(false)
    runAttemptPlan(project.id, base, task.trim(), plan.members, { id: session.id, title: session.title })
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSameTask(true)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      send()
    }
  }

  const onScrimMouseDown = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) closeSameTask(true)
  }

  const closeMenu = useCallback((refocus: boolean) => {
    setMenu((open) => {
      if (refocus) open?.anchor.focus()
      return null
    })
  }, [])
  const toggleMenu = (kind: Menu, anchor: HTMLElement): void => setMenu(menu?.kind === kind ? null : { kind, anchor })

  const originName = origin ? agentName(origin) : ''
  const sourceSections = useCallback(
    (): SheetMenuSection[] => [
      { items: sources.map((s) => ({ value: s.source, label: sourceLabel(s.source, s.text, originName), icon: s.source === source ? <Check {...ICON} /> : null })) }
    ],
    [sources, source, originName]
  )

  const branchSections = useCallback(
    (query: string): SheetMenuSection[] => {
      if (!repo) return []
      const groups = groupBranches(repo.branches, repo.defaultBranch, query)
      const icon = (name: string, remote: boolean, other: boolean) =>
        name === base ? <Check {...ICON} /> : remote ? <Globe {...ICON} /> : other ? <GitFork {...ICON} /> : <GitBranch {...ICON} />
      return [
        {
          title: '本地分支',
          items: groups.local.map((b) => ({ value: b.name, label: b.name, icon: icon(b.name, false, isElsewhere(b)), meta: b.name === own ? '原会话' : undefined }))
        },
        { title: '远程分支', items: groups.remote.map((b) => ({ value: b.name, label: b.name, icon: icon(b.name, true, false) })) }
      ]
    },
    [repo, base, own]
  )

  const agentSections = useCallback(
    (query: string): SheetMenuSection[] => {
      const q = query.trim().toLowerCase()
      const items = installed
        .filter((id) => q === '' || agentName(id).toLowerCase().includes(q) || AGENT_SPECS[id].binary.includes(q))
        .map((id) => {
          const count = rows.find((r) => r.kind === id)?.count ?? 0
          return { value: id, label: agentName(id), icon: count > 0 ? <Check {...ICON} /> : null, meta: count > 0 ? `已有 ${count} 份` : (versions[id] ?? undefined) }
        })
      return [{ title: '已安装', items }]
    },
    [installed, rows, versions]
  )

  if (!session) return null
  const baseValue = info === null ? '…' : !repo ? '不是 git 仓库' : base ? (base === own ? `${base}（原会话）` : base) : '没有分支'

  return (
    <div className={sheet.scrim} onMouseDown={onScrimMouseDown} data-region="same-task">
      <div
        ref={ref}
        className={`${sheet.sheet} ${styles.sheet}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="same-task-sheet"
      >
        <header className={sheet.context}>
          <h2 id={titleId} className={sheet.title}>
            同任务多解
          </h2>
        </header>

        <div className={sheet.fields}>
          <Field label="汇报给">
            <span className={styles.value} title={session.title}>
              {[session.title, originName].filter(Boolean).join(' · ')}
            </span>
          </Field>

          <Field label="任务" error={plan?.problem === 'prompt-too-long' ? `最多 ${MAX_ATTEMPT_PROMPT} 个字` : null}>
            {sources.length > 0 && source && (
              <SelectButton
                label="任务来自"
                value={sourceLabel(source, sources.find((s) => s.source === source)?.text ?? '', originName)}
                expanded={menu?.kind === 'source'}
                onClick={(anchor) => toggleMenu('source', anchor)}
              />
            )}
            <textarea
              ref={taskRef}
              className={styles.textarea}
              aria-label="任务"
              value={task}
              spellCheck={false}
              placeholder="写要交给每一份的任务"
              onChange={(event) => setTask(event.currentTarget.value)}
            />
          </Field>

          <Field label="基于">
            <SelectButton label="基于" value={baseValue} disabled={!repo} expanded={menu?.kind === 'base'} onClick={(anchor) => toggleMenu('base', anchor)} />
          </Field>

          <Field label="份数">
            <div className={styles.rows}>
              {rows.map((row) => (
                <div key={row.kind} className={styles.row} role="group" aria-label={`${agentName(row.kind)} 份数`}>
                  <span className={styles.name}>{agentName(row.kind)}</span>
                  <button type="button" className={styles.step} aria-label={`${agentName(row.kind)} 少一份`} onClick={() => setRows(stepRow(rows, row.kind, -1))}>
                    <Minus {...ICON} />
                  </button>
                  <span className={styles.count} aria-live="polite">
                    {row.count}
                  </span>
                  <button type="button" className={styles.step} aria-label={`${agentName(row.kind)} 多一份`} disabled={total >= MAX_ATTEMPTS} onClick={() => setRows(stepRow(rows, row.kind, 1))}>
                    <Plus {...ICON} />
                  </button>
                </div>
              ))}
              <span>
                <button
                  type="button"
                  className={styles.add}
                  aria-haspopup="listbox"
                  aria-expanded={menu?.kind === 'agent'}
                  disabled={total >= MAX_ATTEMPTS || installed.length === 0}
                  onClick={(event) => toggleMenu('agent', event.currentTarget)}
                >
                  <Plus {...ICON} />
                  加一个智能体
                </button>
              </span>
            </div>
          </Field>
        </div>

        <footer className={sheet.footer}>
          <button type="button" className={sheet.cancel} onClick={() => closeSameTask(true)}>
            取消
          </button>
          <button type="button" className={sheet.primary} disabled={!plan?.members} onClick={send}>
            {attemptButtonLabel(total)}
            <span className={sheet.shortcut}>⌘↵</span>
          </button>
        </footer>
      </div>

      {menu?.kind === 'source' && (
        <SheetMenu
          anchor={menu.anchor}
          label="任务来自"
          sections={sourceSections}
          selected={source}
          onPick={(value) => {
            const picked = sources.find((s) => s.source === value)
            if (picked) {
              setSource(picked.source)
              setTask(picked.text)
            }
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'base' && (
        <SheetMenu
          anchor={menu.anchor}
          label="基于"
          sections={branchSections}
          selected={base}
          search="搜索分支"
          onPick={(name) => {
            setBaseChoice(name)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'agent' && (
        <SheetMenu
          anchor={menu.anchor}
          label="加一个智能体"
          sections={agentSections}
          selected={null}
          search="搜索智能体"
          empty="没有匹配的智能体"
          onPick={(value) => {
            if ((CLI_AGENTS as readonly string[]).includes(value)) setRows(addAgentRow(rows, value as CliAgent))
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
