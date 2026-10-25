// 新建会话 (PRD F4, Figma 15 Section 170:7853): one row per choice, each with a default, so ⌘↵ alone starts a session.
// 项目 · 工作目录 (新 worktree / 当前目录, remembered per project) · 基于 · 智能体 · 高级 (分支名 · 文件夹 · 准备).
// No task description: the user types the first message in the terminal. Text appears only when something is limited
// or wrong (15E, 15F). Glass material from PRD §5; solid under "reduce transparency".
// 智能体 (Figma 24A, PRD F4 v1.68): a pop-up menu — 已安装 (Claude Code and Codex always, the other CLIs when found, each
// with its version) and 其他 (终端, 多个智能体一起做); remembered per project; the hint says how many are not installed.
// 多个 (一题多解, PRD F4 v1.59; no Figma frame yet): 份数 per agent and the one 任务 they all get; 创建 N 个并发送
// makes N worktrees off 基于 and sends the task to each — the button and the note under the task say exactly that.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, CircleAlert, GitBranch, GitFork, Globe, Minus, Plus } from 'lucide-react'
import {
  defaultBase,
  generateBranchName,
  groupBranches,
  initialWorkdir,
  type NewSessionInfo,
  type Workdir
} from '@shared/new-session'
import {
  AGENT_NAME,
  attemptBranchesText,
  attemptButtonLabel,
  attemptKinds,
  attemptSendNote,
  MAX_ATTEMPT_PROMPT,
  planAttempts,
  stepCount,
  type AttemptAgent,
  type AttemptCounts,
  type AttemptPlanProblem
} from '@shared/attempt-groups'
import { AGENT_SPECS, agentName, CLI_AGENTS } from '@shared/agents'
import type { AgentAvailability, AgentVersions } from '@shared/ipc'
import type { AgentKind, ProjectId } from '@shared/types'
import { runAttemptPlan } from '../attempts/actions'
import { Toggle } from '../settings/controls'
import { Segmented } from '../ui/Segmented'
import { useWorkspace } from '../state/workspace'
import { runCreatePlan } from './creation'
import { branchProblemText, folderFor, isElsewhere, planCreate, prepareText, selectedBase, tilde } from './model'
import { closeNewSessionSheet, useNewSessionSheet } from './sheet-store'
import { SheetMenu, type SheetMenuSection } from './SheetMenu'
import styles from './NewSessionSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** 多个 = 一题多解: several agents, one task. */
type KindChoice = AgentKind | 'multi'

const MULTI_LABEL = '多个智能体一起做'

const isKindChoice = (value: string): value is KindChoice => value === 'multi' || value === 'shell' || (CLI_AGENTS as readonly string[]).includes(value)

/** 已安装: Claude Code and Codex always (a missing one says so in the terminal), every other CLI only when it is on PATH. */
export function listedAgents(found: AgentAvailability | null): AgentKind[] {
  return CLI_AGENTS.filter((id) => id === 'claude' || id === 'codex' || found?.[id] === true)
}

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
  const rememberedAgents = useWorkspace((s) => s.newSessionAgent)
  const [kindChoice, setKindChoice] = useState<KindChoice | null>(null)
  const kind: KindChoice = kindChoice ?? (projectId ? rememberedAgents[projectId] : undefined) ?? 'claude'
  const setKind = setKindChoice
  const [counts, setCounts] = useState<AttemptCounts>({ claude: 2, codex: 0 })
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [versions, setVersions] = useState<AgentVersions>({})
  const codexInstalled = found?.codex !== false
  const [task, setTask] = useState('')
  const taskRef = useRef<HTMLTextAreaElement>(null)
  const [prepareChoice, setPrepareChoice] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [menu, setMenu] = useState<{ kind: 'project' | 'base' | 'agent'; anchor: HTMLElement } | null>(null)

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

  // 多个 starts as Claude ×2 · Codex ×1 when Codex is there (the comparison worth making), else Claude ×2.
  useEffect(() => {
    let cancelled = false
    void window.tr.app
      .detectAgents()
      .then((next) => {
        if (cancelled) return
        setFound(next)
        if (next.codex) setCounts((c) => (c.claude === 2 && c.codex === 0 ? { claude: 2, codex: 1 } : c))
      })
      .catch(() => {})
    void window.tr.app
      .agentVersions()
      .then((next) => !cancelled && setVersions(next))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // A generated name per project, made once its branches are known (and kept while the sheet is open).
  const generated = useMemo(
    () => (info?.repo ? generateBranchName(info.prefix, new Set(info.branches.filter((b) => !b.remote).map((b) => b.name))) : ''),
    [info]
  )

  const multi = kind === 'multi' && !notRepo
  const workdir: Workdir = notRepo ? 'current' : multi ? 'worktree' : (workdirChoice ?? initialWorkdir(remembered, projectId ?? '', true))
  const base = baseChoice ?? (info ? defaultBase(info) : null)
  const branch = branchInput ?? generated
  const prepare = prepareChoice && ((info?.includeCount ?? 0) > 0 || info?.hasSetup === true)
  const form = { workdir, base, branch, prepare }
  const result = project ? planCreate(project.rootPath, info, form) : null
  const baseBranch = info ? selectedBase(info, form) : null
  // 多个 makes new branches off 基于 even when it is out in a worktree.
  const elsewhere = !multi && workdir === 'worktree' && isElsewhere(baseBranch) ? baseBranch : null
  const kinds = attemptKinds(counts)
  const attempts =
    multi && project && info && baseBranch
      ? planAttempts({
          root: project.rootPath,
          base: baseBranch.name,
          stem: branch,
          counts,
          prompt: task,
          prepare,
          branches: info.branches,
          worktreesDir: info.worktreesDir,
          takenFolders: info.takenFolders
        })
      : null
  const problem = multi ? (attempts?.problem ?? null) : (result?.problem ?? null)
  const branchProblem = problem === 'exists' || problem === 'invalid' || problem === 'empty' ? problem : null
  const showAdvanced = !!info?.repo && workdir === 'worktree' && !elsewhere
  const canCreate = multi ? attempts?.members != null : !!result?.plan
  const sendNote = multi ? attemptSendNote(kinds, baseBranch?.name ?? null) : null
  const advancedOpen = advanced || branchProblem !== null

  const chooseProject = (id: ProjectId): void => {
    setProjectId(id)
    setWorkdirChoice(null)
    setBaseChoice(null)
    setBranchInput(null)
    setPrepareChoice(true)
    setKindChoice(null)
  }

  const create = (): void => {
    if (multi) {
      if (!project || !baseBranch || !attempts?.members) return
      closeNewSessionSheet(false)
      useWorkspace.getState().rememberWorkdir(project.id, 'worktree')
      runAttemptPlan(project.id, baseBranch.name, task, attempts.members)
      return
    }
    if (!project || !result?.plan || kind === 'multi') return
    closeNewSessionSheet(false)
    // A choice made before the git state arrived still counts; only a folder known not to be a repo is not remembered.
    runCreatePlan(project.id, result.plan, kind, workdir, !notRepo)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // The menus handle (and stop) their own Esc / Enter first; an input method composing (分支名) owns them too.
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
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

  const toggleMenu = (kind: 'project' | 'base' | 'agent', anchor: HTMLElement): void => setMenu(menu?.kind === kind ? null : { kind, anchor })

  const agentSections = useCallback(
    (query: string): SheetMenuSection[] => {
      const q = query.trim().toLowerCase()
      const matches = (label: string): boolean => q === '' || label.toLowerCase().includes(q)
      const check = (value: KindChoice) => (value === kind ? <Check {...ICON} /> : null)
      const installed = listedAgents(found)
        .filter((id) => matches(agentName(id)) || (id !== 'shell' && matches(AGENT_SPECS[id].binary)))
        .map((id) => ({
          value: id,
          label: agentName(id),
          icon: check(id),
          meta: id !== 'shell' && found && found[id] === false ? '没装' : (id !== 'shell' ? (versions[id] ?? undefined) : undefined)
        }))
      const others = [
        { value: 'shell', label: '终端', icon: check('shell') },
        ...(notRepo ? [] : [{ value: 'multi', label: `${MULTI_LABEL}…`, icon: check('multi'), meta: '一题多解' }])
      ].filter((item) => matches(item.label))
      return [
        { title: '已安装', items: installed },
        { title: '其他', items: others }
      ]
    },
    [found, versions, kind, notRepo]
  )
  const missingAgents = found ? CLI_AGENTS.filter((id) => !found[id]).length : 0

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
              options={WORKDIRS.map((o) => ({ ...o, disabled: (o.value === 'worktree' && notRepo) || (o.value === 'current' && multi) }))}
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

          <Field label="智能体" note={kind === 'multi' && notRepo ? '多个 agent 各用一个新 worktree，这个文件夹不是 git 仓库' : null}>
            <SelectButton
              label="智能体"
              value={kind === 'multi' ? MULTI_LABEL : agentName(kind)}
              expanded={menu?.kind === 'agent'}
              onClick={(anchor) => toggleMenu('agent', anchor)}
            />
          </Field>

          {multi && (
            <>
              <Field label="份数" error={countProblemText(problem)}>
                <div className={styles.counts}>
                  {(['claude', 'codex'] as const).map((agent) => (
                    <Counter
                      key={agent}
                      agent={agent}
                      value={counts[agent]}
                      disabledReason={agent === 'codex' && !codexInstalled ? '没有找到 codex 命令' : null}
                      onStep={(delta) => setCounts((c) => stepCount(c, agent, delta))}
                    />
                  ))}
                </div>
              </Field>
              <Field label="任务" note={sendNote} error={problem === 'prompt-too-long' ? `最多 ${MAX_ATTEMPT_PROMPT} 个字` : null}>
                <textarea
                  ref={taskRef}
                  className={styles.textarea}
                  aria-label="任务"
                  value={task}
                  rows={3}
                  spellCheck={false}
                  placeholder="发给每个 agent 的同一段话"
                  onChange={(event) => setTask(event.currentTarget.value)}
                />
              </Field>
            </>
          )}

          {showAdvanced && (
            <button
              type="button"
              className={styles.advanced}
              aria-expanded={advancedOpen}
              onClick={() => setAdvanced(!advancedOpen)}
              disabled={branchProblem !== null}
            >
              <span className={styles.label}>高级</span>
              {!advancedOpen && <span className={styles.advancedBranch}>{multi ? attemptBranchesText(branch, kinds.length) : branch}</span>}
              <span className={styles.spacer} />
              {advancedOpen ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
            </button>
          )}

          {showAdvanced && advancedOpen && (
            <>
              <Field
                label="分支名"
                error={multi ? attemptBranchProblemText(branchProblem, branch, kinds.length) : branchProblemText(branchProblem, branch)}
                note={multi && !branchProblem ? `每份一个分支：${attemptBranchesText(branch, kinds.length)}` : null}
              >
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
                  {multi && attempts?.members
                    ? `${tilde(attempts.members[0]?.path ?? '', home)} 等 ${attempts.members.length} 个`
                    : tilde(folderPath, home)}
                </span>
              </Field>
              <Field label="准备">
                <div className={styles.prep}>
                  <span className={styles.prepText}>{prepText ?? '没有 .worktreeinclude 要复制的文件，也没有 setup 脚本'}</span>
                  {prepText && <Toggle checked={prepare} onChange={setPrepareChoice} label="准备：复制被忽略的文件、运行 setup 脚本" />}
                </div>
              </Field>
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => closeNewSessionSheet(true)}>
            取消
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!canCreate}
            title={multi ? (problem === 'prompt-empty' ? '先写要发给每个 agent 的任务' : (sendNote ?? undefined)) : undefined}
            onClick={create}
          >
            {multi ? attemptButtonLabel(kinds.length) : '创建'}
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
      {menu?.kind === 'agent' && (
        <SheetMenu
          anchor={menu.anchor}
          label="智能体"
          sections={agentSections}
          selected={kind}
          search="搜索智能体"
          empty="没有匹配的智能体"
          align="selected"
          hint={missingAgents > 0 ? `还有 ${missingAgents} 家没装：在设置 · 智能体里看怎么装 · 按项目记住上次的选择` : '按项目记住上次的选择'}
          onPick={(value) => {
            if (!isKindChoice(value)) return
            setKind(value)
            closeMenu(true)
            if (value === 'multi') requestAnimationFrame(() => taskRef.current?.focus())
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

function countProblemText(problem: AttemptPlanProblem | string | null): string | null {
  return problem === 'too-few' ? '一共至少 2 份' : problem === 'too-many' ? '一共最多 4 份（总览里最多并排 4 个）' : null
}

function attemptBranchProblemText(problem: 'exists' | 'invalid' | 'empty' | null, stem: string, count: number): string | null {
  if (problem === 'exists') return `${attemptBranchesText(stem, count)} 里有分支已经存在，换个名字`
  return branchProblemText(problem, stem)
}

/** 份数: `Claude Code − 2 +`. */
function Counter({
  agent,
  value,
  disabledReason,
  onStep
}: {
  agent: AttemptAgent
  value: number
  disabledReason: string | null
  onStep: (delta: 1 | -1) => void
}) {
  const name = AGENT_NAME[agent]
  const disabled = disabledReason !== null
  return (
    <span className={styles.counter} role="group" aria-label={`${name} 份数`} title={disabledReason ?? undefined} data-disabled={disabled}>
      <span className={styles.counterName}>{name}</span>
      <button type="button" className={styles.step} aria-label={`${name} 少一份`} disabled={value === 0} onClick={() => onStep(-1)}>
        <Minus size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <span className={styles.countValue} aria-live="polite">
        {value}
      </span>
      <button type="button" className={styles.step} aria-label={`${name} 多一份`} disabled={disabled} onClick={() => onStep(1)}>
        <Plus size={14} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
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
