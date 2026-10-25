// 创建 PR 面板 (PRD F16 v1.63, Figma 22A 364:13862): title, body (the repository's PR template, else the commit
// subjects) ending in the evidence block, base, draft, and one review line. ⌘↵ pushes and creates. With 推送前审阅 on,
// the review runs first; 跳过，直接创建 does not wait, and P0 / P1 findings are counted, never a reason not to create.
// v1.68: uncommitted work starts the sheet with 提交 — the files (all ticked) and the message, shown before anything
// is written — and a branch whose PR is open gets 提交并推送 / 推送 instead of the PR fields. Each step says where
// it is; a commit that went in is not made again when a later step fails. AI 写 fills the commit message, or the PR
// title and body, from a headless run of the user's own Claude / Codex (src/main/pr-writer.ts); the tooltip names the
// CLI, model and quota, and 设置 · 自动化 · PR picks them (and whether it writes as the sheet opens).
// Glass sheet material as 新建会话 (PRD §5).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, CircleAlert, CircleX, Sparkles } from 'lucide-react'
import { evidenceBlock, EVIDENCE_START, reviewEvidence, withEvidence, type PrDraft, type ShipFile } from '@shared/pull-requests'
import { writerFor, writerTooltip, type WriterKind } from '@shared/ship-writer'
import { checksText } from '@shared/turn-checks'
import { formatReviewStats } from '@shared/background-review'
import { cancelBackgroundReview, loadSavedReview, startBackgroundReview, useBackgroundReview } from '../review/background'
import { useSettings } from '../settings/useSettings'
import { useTurnCheckView } from '../turn-checks/TurnChecksTag'
import { StatusGlyph } from '../ui/StatusGlyph'
import { commitChanges, createPullRequest, pushToPullRequest } from './actions'
import { closeCreatePr, useCreatePr, type CreatePrTarget } from './create-sheet'
import { autoBody, shipBlocker, shipButtonLabel } from './ship-model'
import { usePullRequests } from './store'
import styles from './CreatePrSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const AGENT_NAME = { claude: 'Claude', codex: 'Codex' } as const
const STATUS_LABEL: Record<ShipFile['status'], string> = { M: '已修改', A: '新增', D: '已删除', R: '重命名', U: '冲突' }
const PHASE_NOTE = { committing: '正在提交（会跑仓库的 git hook）…', pushing: '正在推送…', creating: '正在推送并创建 PR…' } as const

export function CreatePrSheet() {
  const target = useCreatePr((s) => s.target)
  const generation = useCreatePr((s) => s.generation)
  return target ? <Sheet key={generation} target={target} /> : null
}

function Sheet({ target }: { target: CreatePrTarget }) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const push = target.mode === 'push'
  const [draft, setDraft] = useState<PrDraft | null>(null)
  const [title, setTitle] = useState(target.title)
  // null: the body follows the commit subjects (and the commit about to be made) until the user edits it.
  const [body, setBody] = useState<string | null>(null)
  const [asDraft, setAsDraft] = useState(false)
  const [message, setMessage] = useState(target.title)
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  // A commit that went in stays made: retrying after a failed push or PR only does the rest.
  const [committed, setCommitted] = useState<{ commit: string; subject: string } | null>(null)
  const [error, setError] = useState<{ text: string; output?: string } | null>(null)
  const phase = usePullRequests((s) => s.busy[target.worktree])
  const working = phase === 'committing' || phase === 'pushing' || phase === 'creating'
  const { settings, loaded } = useSettings()
  const review = useBackgroundReview((s) => s.byRoot[target.worktree])
  const checks = useTurnCheckView(target.agentSessionId ?? undefined)

  useEffect(() => {
    let live = true
    void window.tr.pr.draft({ root: target.root, worktree: target.worktree }).then((next) => {
      if (!live) return
      setDraft(next)
      if (next.ok) setTitle((t) => t.trim() || next.branch)
    })
    return () => {
      live = false
    }
  }, [target.root, target.worktree])

  useEffect(() => loadSavedReview(target.worktree), [target.worktree])
  // 推送前审阅: creating a PR pushes, so it reviews first (main skips a diff it already reviewed).
  const base = draft?.ok ? draft.base : null
  const autoReview = loaded && settings.review.mode === 'builtin' && settings.review.beforePush && target.agent !== null
  useEffect(() => {
    if (!autoReview || !base || !target.agent) return
    void startBackgroundReview(target.worktree, target.agent, 'push', base).catch(() => {})
  }, [autoReview, base, target.agent, target.worktree])

  const files = draft?.ok && !committed ? draft.files : []
  const ticked = files.filter((f) => !unticked.has(f.path))
  const conflicts = files.some((f) => f.status === 'U')
  const pendingMessage = ticked.length > 0 ? message : null

  // The evidence block follows the checks and the review until the user deletes it from the body.
  const reviewer = review ? AGENT_NAME[review.agent] : null
  const block =
    loaded && settings.pr.evidence
      ? evidenceBlock({
          checks: checks ? `这一轮的检查：${checksText(checks)}` : null,
          review: review?.phase === 'done' && reviewer ? reviewEvidence(reviewer, review.counts ?? {}) : null
        })
      : ''
  const startBody = draft?.ok ? (draft.fromTemplate ? draft.body : autoBody([...draft.subjects, ...(committed ? [committed.subject] : [])], pendingMessage)) : ''
  const written = body ?? startBody
  // `written` is what the user wrote (or the start); the block is added while it shows (edits inside it are regenerated).
  const [evidenceRemoved, setEvidenceRemoved] = useState(false)
  const shownBody = evidenceRemoved ? written : withEvidence(written, block)

  useEffect(() => sheetRef.current?.focus(), [])

  // AI 写: one run per kind; closing the sheet stops them.
  const writer = writerFor(settings.pr, target.agent)
  const [writing, setWriting] = useState<ReadonlySet<WriterKind>>(new Set())
  const [writeError, setWriteError] = useState<Partial<Record<WriterKind, string>>>({})
  const [aiBody, setAiBody] = useState(false)
  const write = async (kind: WriterKind): Promise<void> => {
    if (!draft?.ok || writing.has(kind)) return
    setWriting((w) => new Set([...w, kind]))
    setWriteError((e) => ({ ...e, [kind]: undefined }))
    const result = await window.tr.pr
      .write({
        root: target.root,
        worktree: target.worktree,
        kind,
        agent: writer.agent,
        paths: ticked.map((f) => f.path),
        ...(kind === 'pr' && ticked.length > 0 ? { pendingMessage: message } : {})
      })
      .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }))
    setWriting((w) => new Set([...w].filter((k) => k !== kind)))
    if (!result.ok) {
      if (result.message !== '已取消') setWriteError((e) => ({ ...e, [kind]: result.message }))
      return
    }
    if (result.kind === 'commit') setMessage(result.message)
    else {
      setTitle(result.title)
      setBody(result.body)
      setAiBody(true)
    }
  }
  useEffect(() => () => window.tr.pr.cancelWrite(target.worktree), [target.worktree])
  // 打开面板时自动写 (off by default): once, as soon as the sheet knows what there is to write about.
  const wroteOnOpen = useRef(false)
  useEffect(() => {
    if (!loaded || !settings.pr.writeOnOpen || !draft?.ok || wroteOnOpen.current) return
    wroteOnOpen.current = true
    const kinds: WriterKind[] = [...(draft.files.length > 0 ? (['commit'] as const) : []), ...(push ? [] : (['pr'] as const))]
    // After this render: write() sets state.
    queueMicrotask(() => kinds.forEach((kind) => void write(kind)))
  }, [loaded, draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const running = review?.phase === 'running'
  const severe = review?.phase === 'done' ? (review.counts?.P0 ?? 0) + (review.counts?.P1 ?? 0) : 0
  const blocker = draft?.ok
    ? conflicts
      ? '有没解决的冲突：先解决再提交'
      : shipBlocker({
          mode: target.mode,
          ticked: ticked.length,
          message,
          title,
          ahead: draft.subjects.length + (committed ? 1 : 0),
          unpushed: draft.unpushed === null ? null : draft.unpushed + (committed ? 1 : 0),
          remoteAhead: draft.remoteAhead,
          remote: draft.remote
        })
    : null
  const ready = draft?.ok === true && blocker === null && !working

  const ship = async (): Promise<void> => {
    if (!ready || !draft?.ok) return
    setError(null)
    if (ticked.length > 0) {
      const made = await commitChanges(
        target.root,
        target.worktree,
        message,
        ticked.map((f) => f.path)
      )
      if (!made.ok) {
        setError({ text: made.message, ...(made.output ? { output: made.output } : {}) })
        return
      }
      setCommitted({ commit: made.commit, subject: made.subject })
    }
    const failure =
      push && target.openPr
        ? await pushToPullRequest(target.root, target.worktree, target.sessionId, target.openPr.url)
        : await createPullRequest(target.root, { path: target.worktree }, title, target.sessionId, { body: shownBody, draft: asDraft })
    if (failure) {
      setError({ text: failure })
      return
    }
    closeCreatePr()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    if (event.key === 'Escape' && !working) {
      event.preventDefault()
      closeCreatePr()
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      if (!running) void ship()
    }
  }
  const onScrim = (event: MouseEvent): void => {
    if (event.target === event.currentTarget && !working) closeCreatePr()
  }

  const committing = ticked.length > 0
  const heading = shipButtonLabel(target.mode, files.length > 0)
  const note = (() => {
    if (!draft?.ok) return null
    if (working) return PHASE_NOTE[phase]
    if (blocker) return blocker
    if (severe > 0) return `${severe} 个 P0 / P1 没处理`
    const where = push ? `PR #${target.openPr?.number ?? ''}` : null
    const pushes = !draft.pushed ? `会把分支推送到 ${draft.remote}` : push ? `推送到 ${where}` : null
    return [committing ? '先提交勾选的文件' : null, pushes, push ? null : '用你的 gh 账号创建 PR'].filter(Boolean).join('，')
  })()

  return (
    <div className={styles.scrim} onMouseDown={onScrim} data-region="create-pr">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={draft === null || working}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="create-pr-sheet"
      >
        <header className={styles.context}>
          <h2 id={titleId} className={styles.title}>
            {heading}
          </h2>
          {draft?.ok && (
            <span className={styles.refs}>
              {draft.branch}  →  {push && target.openPr ? `PR #${target.openPr.number}` : draft.base}
            </span>
          )}
        </header>

        {draft === null && <p className={styles.muted}>正在读取分支…</p>}
        {draft && !draft.ok && (
          <p className={styles.failure} role="alert">
            <CircleX {...ICON} />
            {draft.message}
          </p>
        )}
        {draft?.ok && (
          <div className={styles.fields}>
            {committed && (
              <div className={styles.field}>
                <span className={styles.label}>提交</span>
                <div className={styles.control}>
                  <p className={styles.reviewRow} data-tone="ok">
                    <Check {...ICON} />
                    <span className={styles.reviewText} title={committed.subject}>
                      已提交 {committed.subject}
                    </span>
                    <span className={styles.reviewMeta}>{committed.commit}</span>
                  </p>
                </div>
              </div>
            )}
            {files.length > 0 && (
              <>
                <div className={styles.field} data-top>
                  <span className={styles.label}>提交</span>
                  <div className={styles.control}>
                    <FileList files={files} unticked={unticked} onChange={setUnticked} disabled={working} />
                    <p className={styles.note}>
                      agent 还没提交的改动；没勾选的留在工作区
                      {draft.filesOmitted > 0 ? `，另有 ${draft.filesOmitted} 个文件没列出、不会提交` : ''}
                    </p>
                  </div>
                </div>
                <div className={styles.field} data-top>
                  <span className={styles.label}>说明</span>
                  <div className={styles.control}>
                    <textarea
                      className={styles.message}
                      aria-label="提交说明"
                      value={message}
                      spellCheck={false}
                      disabled={working || writing.has('commit')}
                      onChange={(e) => setMessage(e.currentTarget.value)}
                    />
                    <WriteAction
                      busy={writing.has('commit')}
                      error={writeError.commit}
                      disabled={working || ticked.length === 0}
                      tooltip={ticked.length === 0 ? '勾选要提交的文件' : writerTooltip(writer.agent, writer.model)}
                      onWrite={() => void write('commit')}
                      onCancel={() => window.tr.pr.cancelWrite(target.worktree)}
                    />
                  </div>
                </div>
              </>
            )}
            {!push && (
              <>
                <div className={styles.field}>
                  <span className={styles.label}>标题</span>
                  <div className={styles.control}>
                    <input className={styles.input} aria-label="标题" value={title} spellCheck={false} onChange={(e) => setTitle(e.currentTarget.value)} />
                  </div>
                </div>
                <div className={styles.field} data-top>
                  <span className={styles.label}>正文</span>
                  <div className={styles.control}>
                    <textarea
                      className={styles.body}
                      aria-label="正文"
                      value={shownBody}
                      spellCheck={false}
                      onChange={(e) => {
                        const next = e.currentTarget.value
                        if (!evidenceRemoved && shownBody.includes(EVIDENCE_START) && !next.includes(EVIDENCE_START)) {
                          setEvidenceRemoved(true)
                          setBody(next)
                        } else setBody(evidenceRemoved ? next : withEvidence(next, ''))
                      }}
                    />
                    <p className={styles.note}>
                      {aiBody ? `标题和正文是 ${AGENT_NAME[writer.agent]} 写的，可以直接改` : draft.fromTemplate ? '正文是仓库的 PR 模板' : '正文是相对基线的提交说明'}
                      {settings.pr.evidence ? '；末尾是这一轮的检查和 Wavi 审阅结果，可以直接删' : ''}
                    </p>
                    <WriteAction
                      busy={writing.has('pr')}
                      error={writeError.pr}
                      disabled={working}
                      label="AI 写标题和正文"
                      tooltip={writerTooltip(writer.agent, writer.model)}
                      onWrite={() => void write('pr')}
                      onCancel={() => window.tr.pr.cancelWrite(target.worktree)}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>基线</span>
                  <div className={styles.control}>
                    <span className={styles.value}>{draft.base}</span>
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>草稿</span>
                  <div className={styles.control}>
                    <button type="button" role="checkbox" aria-checked={asDraft} className={styles.checkbox} onClick={() => setAsDraft((d) => !d)}>
                      <span className={styles.box} aria-hidden>
                        {asDraft && <Check size={12} strokeWidth={2.5} />}
                      </span>
                      创建为草稿
                    </button>
                  </div>
                </div>
              </>
            )}
            <div className={styles.field}>
              <span className={styles.label}>审阅</span>
              <div className={styles.control}>
                <ReviewRow target={target} base={draft.base} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className={styles.failureBlock} role="alert">
            <p className={styles.failure}>
              <CircleX {...ICON} />
              {error.text}
            </p>
            {error.output && <pre className={styles.output}>{error.output}</pre>}
          </div>
        )}

        <footer className={styles.footer}>
          {note && (
            <span className={styles.footerNote} title={note}>
              {note}
            </span>
          )}
          <span className={styles.spacer} />
          <button type="button" className={styles.cancel} disabled={working} onClick={closeCreatePr}>
            取消
          </button>
          {running && (
            <button type="button" className={styles.cancel} disabled={!ready} onClick={() => void ship()}>
              {push ? '跳过，直接推送' : '跳过，直接创建'}
            </button>
          )}
          <button type="button" className={styles.primary} disabled={!ready || running} onClick={() => void ship()}>
            {working ? PHASE_NOTE[phase].replace(/（.*）/, '') : running ? (push ? '审阅完再推送' : '审阅完再创建') : shipButtonLabel(target.mode, committing)}
            <span className={styles.shortcut}>⌘↵</span>
          </button>
        </footer>
      </div>
    </div>
  )
}

/** AI 写 under a field: the button (its tooltip says who writes, with what model, on whose quota), progress, or the error. */
function WriteAction({
  busy,
  error,
  disabled,
  tooltip,
  label = 'AI 写',
  onWrite,
  onCancel
}: {
  busy: boolean
  error: string | undefined
  disabled: boolean
  tooltip: string
  label?: string
  onWrite: () => void
  onCancel: () => void
}) {
  return (
    <p className={styles.writeRow}>
      {busy ? (
        <>
          <StatusGlyph status="running" />
          <span className={styles.writeText}>正在写…</span>
          <button type="button" className={styles.inlineAction} onClick={onCancel}>
            取消
          </button>
        </>
      ) : (
        <>
          <button type="button" className={styles.inlineAction} data-icon disabled={disabled} title={tooltip} onClick={onWrite}>
            <Sparkles size={16} strokeWidth={1.75} aria-hidden />
            {label}
          </button>
          {error && (
            <span className={styles.writeError} title={error}>
              {error}
            </span>
          )}
        </>
      )}
    </p>
  )
}

/** 提交's files, all ticked to start with; a header row ticks or unticks them all. */
function FileList({
  files,
  unticked,
  onChange,
  disabled
}: {
  files: readonly ShipFile[]
  unticked: ReadonlySet<string>
  onChange: (next: ReadonlySet<string>) => void
  disabled: boolean
}) {
  const all = unticked.size === 0
  const none = files.every((f) => unticked.has(f.path))
  const toggle = (path: string): void => {
    const next = new Set(unticked)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onChange(next)
  }
  return (
    <div className={styles.files}>
      <button
        type="button"
        role="checkbox"
        aria-checked={all ? true : none ? false : 'mixed'}
        className={styles.fileRow}
        disabled={disabled}
        onClick={() => onChange(all ? new Set(files.map((f) => f.path)) : new Set())}
      >
        <span className={styles.box} aria-hidden>
          {all && <Check size={12} strokeWidth={2.5} />}
          {!all && !none && <span className={styles.dash} />}
        </span>
        <span className={styles.filePath}>全部 {files.length} 个文件</span>
      </button>
      <div className={styles.fileScroll} role="group" aria-label="要提交的文件">
        {files.map((file) => {
          const on = !unticked.has(file.path)
          return (
            <button
              key={file.path}
              type="button"
              role="checkbox"
              aria-checked={on}
              className={styles.fileRow}
              disabled={disabled}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              onClick={() => toggle(file.path)}
            >
              <span className={styles.box} aria-hidden>
                {on && <Check size={12} strokeWidth={2.5} />}
              </span>
              <span className={styles.fileStatus} data-status={file.status}>
                {STATUS_LABEL[file.status]}
              </span>
              <span className={styles.filePath}>{file.path}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ReviewRow({ target, base }: { target: CreatePrTarget; base: string }) {
  const review = useBackgroundReview((s) => s.byRoot[target.worktree])
  const { settings } = useSettings()
  const canReview = settings.review.mode === 'builtin' && target.agent !== null
  if (!review || review.phase === 'cancelled' || review.phase === 'skipped') {
    return (
      <p className={styles.reviewRow}>
        <span className={styles.reviewText}>{review?.message || '还没有审阅'}</span>
        {canReview && target.agent && (
          <button type="button" className={styles.inlineAction} onClick={() => void startBackgroundReview(target.worktree, target.agent!, 'manual', base).catch(() => {})}>
            先审阅
          </button>
        )}
      </p>
    )
  }
  if (review.phase === 'running') {
    return (
      <p className={styles.reviewRow} data-tone="working">
        <StatusGlyph status="running" />
        <span className={styles.reviewText}>{review.message || '正在审阅…'}</span>
        <button type="button" className={styles.inlineAction} onClick={() => cancelBackgroundReview(target.worktree)}>
          取消
        </button>
      </p>
    )
  }
  if (review.phase === 'failed') {
    return (
      <p className={styles.reviewRow} data-tone="error">
        <CircleX {...ICON} />
        <span className={styles.reviewText}>审阅失败：{review.message}</span>
      </p>
    )
  }
  const counts = review.counts ?? {}
  const severe = (counts.P0 ?? 0) + (counts.P1 ?? 0)
  return (
    <p className={styles.reviewRow} data-tone={severe > 0 ? 'warn' : 'ok'}>
      {severe > 0 ? <CircleAlert {...ICON} /> : <Check {...ICON} />}
      <span className={styles.reviewText} title={review.message}>
        {reviewEvidence(AGENT_NAME[review.agent], counts).replace(/^Wavi 审阅（(\w+)）：/, '$1 审阅：')}
      </span>
      <span className={styles.reviewMeta}>{formatReviewStats(review.durationMs, review.costUsd)}</span>
    </p>
  )
}
