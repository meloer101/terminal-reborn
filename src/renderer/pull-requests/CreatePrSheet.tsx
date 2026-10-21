// 创建 PR 面板 (PRD F16 v1.63, Figma 22A 364:13862): title, body (the repository's PR template, else the commit
// subjects) ending in the evidence block, base, draft, and one review line. ⌘↵ pushes and creates. With 推送前审阅 on,
// the review runs first; 跳过，直接创建 does not wait, and P0 / P1 findings are counted, never a reason not to create.
// Glass sheet material as 新建会话 (PRD §5).
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, CircleAlert, CircleX } from 'lucide-react'
import { evidenceBlock, EVIDENCE_START, reviewEvidence, withEvidence, type PrDraft } from '@shared/pull-requests'
import { checksText } from '@shared/turn-checks'
import { formatReviewStats } from '@shared/background-review'
import { cancelBackgroundReview, loadSavedReview, startBackgroundReview, useBackgroundReview } from '../review/background'
import { useSettings } from '../settings/useSettings'
import { useTurnCheckView } from '../turn-checks/TurnChecksTag'
import { StatusGlyph } from '../ui/StatusGlyph'
import { createPullRequest } from './actions'
import { closeCreatePr, useCreatePr, type CreatePrTarget } from './create-sheet'
import styles from './CreatePrSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const AGENT_NAME = { claude: 'Claude', codex: 'Codex' } as const

export function CreatePrSheet() {
  const target = useCreatePr((s) => s.target)
  const generation = useCreatePr((s) => s.generation)
  return target ? <Sheet key={generation} target={target} /> : null
}

function Sheet({ target }: { target: CreatePrTarget }) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<PrDraft | null>(null)
  const [title, setTitle] = useState(target.title)
  const [body, setBody] = useState('')
  const [asDraft, setAsDraft] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { settings, loaded } = useSettings()
  const review = useBackgroundReview((s) => s.byRoot[target.worktree])
  const checks = useTurnCheckView(target.agentSessionId ?? undefined)

  useEffect(() => {
    let live = true
    void window.tr.pr.draft({ root: target.root, worktree: target.worktree }).then((next) => {
      if (!live) return
      setDraft(next)
      if (next.ok) {
        setBody(next.body)
        setTitle((t) => t.trim() || next.branch)
      }
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

  // The evidence block follows the checks and the review until the user deletes it from the body.
  const reviewer = review ? AGENT_NAME[review.agent] : null
  const block =
    loaded && settings.pr.evidence
      ? evidenceBlock({
          checks: checks ? `这一轮的检查：${checksText(checks)}` : null,
          review: review?.phase === 'done' && reviewer ? reviewEvidence(reviewer, review.counts ?? {}) : null
        })
      : ''
  // `body` is what the user wrote; the block is added while it shows (edits inside it are regenerated).
  const [evidenceRemoved, setEvidenceRemoved] = useState(false)
  const shownBody = evidenceRemoved ? body : withEvidence(body, block)

  useEffect(() => sheetRef.current?.focus(), [])

  const running = review?.phase === 'running'
  const severe = review?.phase === 'done' ? (review.counts?.P0 ?? 0) + (review.counts?.P1 ?? 0) : 0
  const ready = draft?.ok === true && title.trim() !== '' && !creating

  const create = async (): Promise<void> => {
    if (!ready || !draft?.ok) return
    setCreating(true)
    setError(null)
    const failure = await createPullRequest(target.root, { path: target.worktree }, title, target.sessionId, { body: shownBody, draft: asDraft })
    if (failure) {
      setError(failure)
      setCreating(false)
      return
    }
    closeCreatePr()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    if (event.key === 'Escape' && !creating) {
      event.preventDefault()
      closeCreatePr()
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      if (!running) void create()
    }
  }
  const onScrim = (event: MouseEvent): void => {
    if (event.target === event.currentTarget && !creating) closeCreatePr()
  }

  return (
    <div className={styles.scrim} onMouseDown={onScrim} data-region="create-pr">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={draft === null || creating}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="create-pr-sheet"
      >
        <header className={styles.context}>
          <h2 id={titleId} className={styles.title}>
            创建 PR
          </h2>
          {draft?.ok && (
            <span className={styles.refs}>
              {draft.branch}  →  {draft.base}
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
                  {draft.fromTemplate ? '正文是仓库的 PR 模板' : '正文是相对基线的提交说明'}
                  {settings.pr.evidence ? '；末尾是这一轮的检查和 Wavi 审阅结果，可以直接删' : ''}
                </p>
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
            <div className={styles.field}>
              <span className={styles.label}>审阅</span>
              <div className={styles.control}>
                <ReviewRow target={target} base={draft.base} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className={styles.failure} role="alert">
            <CircleX {...ICON} />
            {error}
          </p>
        )}

        <footer className={styles.footer}>
          {draft?.ok && (
            <span className={styles.footerNote}>
              {severe > 0 ? `${severe} 个 P0 / P1 没处理` : draft.pushed ? '用你的 gh 账号创建 PR' : `会把分支推送到 ${draft.remote}，用你的 gh 账号创建 PR`}
            </span>
          )}
          <span className={styles.spacer} />
          <button type="button" className={styles.cancel} disabled={creating} onClick={closeCreatePr}>
            取消
          </button>
          {running && (
            <button type="button" className={styles.cancel} disabled={!ready} onClick={() => void create()}>
              跳过，直接创建
            </button>
          )}
          <button type="button" className={styles.primary} disabled={!ready || running} onClick={() => void create()}>
            {creating ? '正在创建…' : running ? '审阅完再创建' : '创建 PR'}
            <span className={styles.shortcut}>⌘↵</span>
          </button>
        </footer>
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
