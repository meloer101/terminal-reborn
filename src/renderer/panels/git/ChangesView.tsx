// Git · 变更 (PRD F17 13B2 / F5): the worktree's files grouped 未提交 (working tree) and 已提交 (vs the base branch),
// each expandable to a unified diff. Inline review comments and merging come later (F5 comments, F4 merge).
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitFileChange } from '@shared/git-graph/log'
import { changeKey, toggleFile, type ChangeGroup, type DiffState, type RootGit } from './store'
import styles from './GitView.module.css'

const STATUS_LABEL: Record<GitFileChange['status'], string> = { M: '已修改', A: '新增', D: '已删除', R: '重命名', U: '冲突' }

export function ChangesView({ root, git }: { root: string; git: RootGit }) {
  const changes = git.changes
  if (changes === undefined) return <p className={styles.empty}>正在读取改动…</p>
  if (changes === null) return <p className={styles.empty}>不是 git 仓库</p>

  const commitMeta = changes.base ? `${changes.ahead} 个提交 · 对比 ${changes.base}` : '没有可对比的基线分支'
  const mergeTarget = changes.base ?? 'main'
  return (
    <>
      <div className={styles.files} role="list" aria-label="改动的文件">
        <GroupHeader title="未提交" meta={changes.uncommitted.length > 0 ? `${changes.uncommitted.length} 个文件` : '没有改动'} />
        {changes.uncommitted.map((change) => (
          <FileEntry key={change.path} root={root} git={git} group="uncommitted" change={change} />
        ))}
        <GroupHeader title="已提交" meta={commitMeta} />
        {changes.committed.map((change) => (
          <FileEntry key={change.path} root={root} git={git} group="committed" change={change} />
        ))}
      </div>
      <div className={styles.footer}>
        <span className={styles.spacer} />
        {/* Both wait for F4 (local merge) and F16 (PRs); disabled with a reason rather than hidden. */}
        <button type="button" className={styles.ghostButton} disabled title="即将支持">
          创建 PR
        </button>
        <button type="button" className={styles.primaryButton} disabled title="即将支持：合并在 F4 本地合并完成后可用">
          合并到 {mergeTarget}
          <span className={styles.shortcut}>⌘M</span>
        </button>
      </div>
    </>
  )
}

function GroupHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className={styles.groupHeader} role="presentation">
      <span className={styles.groupTitle}>{title}</span>
      <span className={styles.groupMeta}>{meta}</span>
    </div>
  )
}

function FileEntry({ root, git, group, change }: { root: string; git: RootGit; group: ChangeGroup; change: GitFileChange }) {
  const key = changeKey(group, change.path)
  const open = git.expanded.has(key)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div role="listitem" data-path={change.path} data-group={group}>
      <button
        type="button"
        className={styles.fileRow}
        aria-expanded={open}
        title={`${STATUS_LABEL[change.status]}${change.untracked ? '（未跟踪）' : ''}${change.oldPath ? ` · 原 ${change.oldPath}` : ''}`}
        onClick={() => toggleFile(root, key)}
      >
        <Chevron size={16} strokeWidth={1.75} className={styles.fileChevron} />
        <span className={styles.filePath}>{change.path}</span>
        {change.added === null ? (
          <span className={styles.binary}>二进制</span>
        ) : (
          <>
            <span className={styles.added}>+{change.added}</span>
            <span className={styles.removed}>−{change.removed ?? 0}</span>
          </>
        )}
      </button>
      {open && <FileDiff state={git.diffs[key]} />}
    </div>
  )
}

function FileDiff({ state }: { state: DiffState | undefined }) {
  if (!state || state.kind === 'loading') return <p className={styles.diffNote}>正在读取 diff…</p>
  if (state.kind === 'error') return <p className={styles.diffNote}>无法读取 diff</p>
  const { rows, binary, truncated } = state.diff
  if (binary) return <p className={styles.diffNote}>二进制文件，不显示 diff</p>
  if (rows.length === 0) return <p className={styles.diffNote}>没有文本改动</p>
  return (
    <div className={styles.diff}>
      {rows.map((row, i) => (
        <DiffLine key={i} row={row} />
      ))}
      {truncated > 0 && <p className={styles.diffNote}>还有 {truncated} 行没有显示</p>}
    </div>
  )
}

const MARKER: Record<DiffRow['kind'], string> = { hunk: '', context: '', add: '+', del: '−' }

/** Figma DiffLine (12:91): old · new gutters, marker, code. */
function DiffLine({ row }: { row: DiffRow }) {
  return (
    <div className={styles.diffLine} data-kind={row.kind}>
      <span className={styles.gutter}>{row.old ?? ''}</span>
      <span className={styles.gutter}>{row.new ?? ''}</span>
      <span className={styles.marker}>{MARKER[row.kind]}</span>
      <span className={styles.code}>{row.text}</span>
    </div>
  )
}
