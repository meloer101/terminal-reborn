// 新建会话 (PRD F4, Figma 15 Section 170:7853): one row per choice, each with a default, so ⌘↵ alone starts a session.
// 项目 · 工作目录 (新 worktree / 当前目录, remembered per project) · 基于 · 智能体 · 高级 (分支名 · 文件夹 · 准备).
// No task description: the user types the first message in the terminal. Text appears only when something is limited
// or wrong (15E, 15F). Glass material from PRD §5; solid under "reduce transparency".
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, CircleAlert, GitBranch, GitFork, Globe } from 'lucide-react'
import {
  defaultBase,
  generateBranchName,
  groupBranches,
  initialWorkdir,
  type NewSessionInfo,
  type Workdir
} from '@shared/new-session'
import type { AgentKind, ProjectId } from '@shared/types'
import { Toggle } from '../settings/controls'
import { useWorkspace } from '../state/workspace'
import { runCreatePlan } from './creation'
import { branchProblemText, folderFor, isElsewhere, planCreate, prepareText, selectedBase, tilde } from './model'
import { closeNewSessionSheet, useNewSessionSheet } from './sheet-store'
import { SheetMenu, type SheetMenuSection } from './SheetMenu'
import styles from './NewSessionSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

const KINDS: ReadonlyArray<{ value: AgentKind; label: string }> = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'shell', label: '终端' }
]

const WORKDIRS: ReadonlyArray<{ value: Workdir; label: string }> = [
  { value: 'worktree', label: '新 worktree' },
  { value: 'current', label: '当前目录' }
]

/** A project's git state as main read it; 'error' when it could not be read at all. */
type LoadedInfo = NewSessionInfo | 'error'

export function NewSessionSheet() {
  const open = useNewSessionSheet((s) => s.open)
  const generation = useNewSessionSheet((s) => s.generation)
  return open ? <Sheet key={generation} /> : null
}

function Sheet() {
  const projects = useWorkspace((s) => s.projects)
  const remembered = useWorkspace((s) => s.newSessionWorkdir)
  const [projectId, setProjectId] = useState<ProjectId | null>(() => useNewSessionSheet.getState().projectId ?? projects[0]?.id ?? null)
  const project = projects.find((p) => p.id === projectId) ?? null

  const [infos, setInfos] = useState<Record<ProjectId, LoadedInfo>>({})
  const loaded = projectId ? infos[projectId] : undefined
  const info = loaded && loaded !== 'error' ? loaded : null
  const notRepo = loaded === 'error' || info?.repo === false

  const [workdirChoice, setWorkdirChoice] = useState<Workdir | null>(null)
  const [baseChoice, setBaseChoice] = useState<string | null>(null)
  const [branchInput, setBranchInput] = useState<string | null>(null)
  const [kind, setKind] = useState<AgentKind>('claude')
  const [prepareChoice, setPrepareChoice] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [menu, setMenu] = useState<{ kind: 'project' | 'base'; anchor: HTMLElement } | null>(null)

  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!project || infos[project.id]) return
    let cancelled = false
    window.tr.gitWorktrees
      .newSessionInfo(project.rootPath)
      .then((next) => !cancelled && setInfos((all) => ({ ...all, [project.id]: next })))
      .catch(() => !cancelled && setInfos((all) => ({ ...all, [project.id]: 'error' })))
    return () => {
      cancelled = true
    }
  }, [project, infos])

  useEffect(() => sheetRef.current?.focus(), [])

  // A generated name per project, made once its branches are known (and kept while the sheet is open).
  const generated = useMemo(
    () => (info?.repo ? generateBranchName(info.prefix, new Set(info.branches.filter((b) => !b.remote).map((b) => b.name))) : ''),
    [info]
  )

  const workdir: Workdir = notRepo ? 'current' : (workdirChoice ?? initialWorkdir(remembered, projectId ?? '', true))
  const base = baseChoice ?? (info ? defaultBase(info) : null)
  const branch = branchInput ?? generated
  const prepare = prepareChoice && (info?.includeCount ?? 0) > 0
  const form = { workdir, base, branch, prepare }
  const result = project ? planCreate(project.rootPath, info, form) : null
  const baseBranch = info ? selectedBase(info, form) : null
  const elsewhere = workdir === 'worktree' && isElsewhere(baseBranch) ? baseBranch : null
  const branchProblem = result?.problem === 'exists' || result?.problem === 'invalid' || result?.problem === 'empty' ? result.problem : null
  const showAdvanced = !!info?.repo && workdir === 'worktree' && !elsewhere
  const advancedOpen = advanced || branchProblem !== null

  const chooseProject = (id: ProjectId): void => {
    setProjectId(id)
    setWorkdirChoice(null)
    setBaseChoice(null)
    setBranchInput(null)
    setPrepareChoice(true)
  }

  const create = (): void => {
    if (!project || !result?.plan) return
    closeNewSessionSheet(false)
    // A choice made before the git state arrived still counts; only a folder known not to be a repo is not remembered.
    runCreatePlan(project.id, result.plan, kind, workdir, !notRepo)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // The menus handle (and stop) their own Esc / Enter first.
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeNewSessionSheet(true)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      create()
    }
  }

  const onScrimMouseDown = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) closeNewSessionSheet(true)
  }

  const closeMenu = useCallback((refocus: boolean) => {
    setMenu((open) => {
      if (refocus) open?.anchor.focus()
      return null
    })
  }, [])

  const toggleMenu = (kind: 'project' | 'base', anchor: HTMLElement): void => setMenu(menu?.kind === kind ? null : { kind, anchor })

  const projectSections = useCallback(
    (): SheetMenuSection[] => [
      { items: projects.map((p) => ({ value: p.id, label: p.name, icon: p.id === projectId ? <Check {...ICON} /> : null })) }
    ],
    [projects, projectId]
  )

  const branchSections = useCallback(
    (query: string): SheetMenuSection[] => {
      if (!info) return []
      const groups = groupBranches(info.branches, info.defaultBranch, query)
      const icon = (name: string, remote: boolean, other: boolean) =>
        name === base ? <Check {...ICON} /> : remote ? <Globe {...ICON} /> : other ? <GitFork {...ICON} /> : <GitBranch {...ICON} />
      return [
        {
          title: '本地分支',
          items: groups.local.map((b) => ({
            value: b.name,
            label: b.name,
            icon: icon(b.name, false, isElsewhere(b)),
            meta: isElsewhere(b) ? '已在 worktree 里' : b.name === info.defaultBranch ? '项目默认' : undefined
          }))
        },
        { title: '远程分支', items: groups.remote.map((b) => ({ value: b.name, label: b.name, icon: icon(b.name, true, false) })) }
      ]
    },
    [info, base]
  )

  const hasElsewhere = info?.branches.some(isElsewhere) ?? false
  const home = window.tr.homeDir
  const prepText = info ? prepareText(info) : null
  const folderPath = info ? `${info.worktreesDir}/${folderFor(info, branch)}` : ''

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown} data-region="new-session">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="new-session-sheet"
      >
        <header className={styles.context}>
          <h2 id={titleId} className={styles.title}>
            新建会话
          </h2>
        </header>

        <div className={styles.fields}>
          <Field label="项目">
            <SelectButton
              label="项目"
              value={project?.name ?? '—'}
              expanded={menu?.kind === 'project'}
              onClick={(anchor) => toggleMenu('project', anchor)}
            />
          </Field>

          <Field label="工作目录" note={notRepo ? notRepoText(loaded) : null}>
            <Segmented
              label="工作目录"
              value={workdir}
              options={WORKDIRS.map((o) => ({ ...o, disabled: o.value === 'worktree' && notRepo }))}
              onChange={setWorkdirChoice}
            />
          </Field>

          {!notRepo && (
            <Field
              label="基于"
              disabled={workdir === 'current'}
              note={elsewhere ? `已在 worktree 里：会在 ${tilde(elsewhere.worktreePath, home)} 里再开一个会话` : null}
            >
              <SelectButton
                label="基于"
                value={workdir === 'current' ? `${info?.currentBranch ?? 'HEAD'}（当前分支）` : (base ?? (info ? '没有分支' : '…'))}
                disabled={workdir === 'current' || !info}
                expanded={menu?.kind === 'base'}
                onClick={(anchor) => toggleMenu('base', anchor)}
              />
            </Field>
          )}

          <Field label="智能体">
            <Segmented label="智能体" value={kind} options={KINDS} onChange={setKind} />
          </Field>

          {showAdvanced && (
            <button
              type="button"
              className={styles.advanced}
              aria-expanded={advancedOpen}
              onClick={() => setAdvanced(!advancedOpen)}
              disabled={branchProblem !== null}
            >
              <span className={styles.label}>高级</span>
              {!advancedOpen && <span className={styles.advancedBranch}>{branch}</span>}
              <span className={styles.spacer} />
              {advancedOpen ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
            </button>
          )}

          {showAdvanced && advancedOpen && (
            <>
              <Field label="分支名" error={branchProblemText(branchProblem, branch)}>
                <input
                  className={styles.input}
                  data-invalid={branchProblem !== null}
                  aria-invalid={branchProblem !== null}
                  aria-label="分支名"
                  value={branch}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setBranchInput(event.currentTarget.value)}
                />
              </Field>
              <Field label="文件夹">
                <span className={styles.path} title={folderPath}>
                  {tilde(folderPath, home)}
                </span>
              </Field>
              <Field label="准备">
                <div className={styles.prep}>
                  <span className={styles.prepText}>{prepText ?? '没有 .worktreeinclude 要复制的文件'}</span>
                  {prepText && <Toggle checked={prepare} onChange={setPrepareChoice} label="准备：复制被忽略的文件" />}
                </div>
              </Field>
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => closeNewSessionSheet(true)}>
            取消
          </button>
          <button type="button" className={styles.primary} disabled={!result?.plan} onClick={create}>
            创建
            <span className={styles.shortcut}>⌘↵</span>
          </button>
        </footer>
      </div>

      {menu?.kind === 'project' && (
        <SheetMenu
          anchor={menu.anchor}
          label="项目"
          sections={projectSections}
          selected={projectId}
          empty="没有项目"
          onPick={(id) => {
            chooseProject(id)
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
          hint={hasElsewhere ? '已在 worktree 里的分支：会改为在那个 worktree 里再开一个会话' : null}
          onPick={(name) => {
            setBaseChoice(name)
            closeMenu(true)
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}

function notRepoText(loaded: LoadedInfo | undefined): string {
  return loaded === 'error' ? '读不出这个文件夹的 git 状态，只能在当前目录里开' : '这个文件夹不是 git 仓库，只能在当前目录里开'
}

function Field({
  label,
  children,
  note,
  error,
  disabled = false
}: {
  label: string
  children: ReactNode
  note?: string | null
  error?: string | null
  disabled?: boolean
}) {
  return (
    <div className={styles.field} role="group" aria-label={label} data-disabled={disabled}>
      <span className={styles.labelBox}>
        <span className={styles.label}>{label}</span>
      </span>
      <div className={styles.control}>
        {children}
        {error && (
          <p className={styles.error} role="alert">
            <CircleAlert size={14} strokeWidth={1.75} aria-hidden />
            {error}
          </p>
        )}
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </div>
  )
}

function SelectButton({
  label,
  value,
  expanded,
  disabled = false,
  onClick
}: {
  label: string
  value: string
  expanded: boolean
  disabled?: boolean
  onClick: (anchor: HTMLElement) => void
}) {
  return (
    <button
      type="button"
      className={styles.select}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={expanded}
      disabled={disabled}
      onClick={(event) => onClick(event.currentTarget)}
      onKeyDown={(event) => {
        if (!expanded && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          onClick(event.currentTarget)
        }
      }}
    >
      <span className={styles.selectValue}>{value}</span>
      <ChevronDown {...ICON} />
    </button>
  )
}

/** Borderless segmented radio group (Figma Segment). Arrow keys move the choice; nothing here is saved until 创建. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  onChange: (value: T) => void
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  const move = (event: KeyboardEvent, delta: number): void => {
    const enabled = options.filter((o) => !o.disabled)
    const from = enabled.findIndex((o) => o.value === value)
    const next = enabled[(from + delta + enabled.length) % enabled.length]
    if (!next) return
    event.preventDefault()
    onChange(next.value)
    refs.current.get(next.value)?.focus()
  }
  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1)
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1)
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          ref={(node) => {
            if (node) refs.current.set(option.value, node)
            else refs.current.delete(option.value)
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={option.disabled}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
