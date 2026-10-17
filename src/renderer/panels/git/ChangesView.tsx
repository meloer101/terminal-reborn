// Git · 变更 (PRD F17 13B2 / F5): the worktree's files grouped 未提交 (working tree) and 已提交 (vs the base branch),
// each expandable to a unified diff. Every row has a fixed height, so long diffs render only the visible window.
// Inline review comments and merging come later (F5 comments, F4 merge).
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useRef } from 'react'
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitFileChange } from '@shared/git-graph/log'
import { changeItems, itemHeight, type ChangeItem } from './changes-model'
import { toggleFile, type RootGit } from './store'
import { offsetsOf, useViewport, visibleRange } from './virtual'
import styles from './GitView.module.css'

const STATUS_LABEL: Record<GitFileChange['status'], string> = { M: '已修改', A: '新增', D: '已删除', R: '重命名', U: '冲突' }
/** Items rendered beyond each edge of the viewport. */
const OVERSCAN = 20

export function ChangesView({ root, git }: { root: string; git: RootGit }) {
  const changes = git.changes
  const scroller = useRef<HTMLDivElement>(null)
  const items = useMemo(() => (changes ? changeItems(changes, git.expanded, git.diffs) : []), [changes, git.expanded, git.diffs])
  const offsets = useMemo(() => offsetsOf(items.map(itemHeight)), [items])
  const viewport = useViewport(scroller, Boolean(changes))

  if (changes === undefined) return <p className={styles.empty}>正在读取改动…</p>
  if (changes === null) return <p className={styles.empty}>{git.changesError ? `无法读取改动：${git.changesError}` : '不是 git 仓库'}</p>

  const [first, last] = visibleRange(offsets, viewport.top, viewport.height, OVERSCAN)
  const rendered = []
  for (let i = first; i < last; i++) {
    rendered.push(<Item key={itemKey(items[i]!, i)} root={root} item={items[i]!} top={offsets[i]!} />)
  }
  return (
    <>
      <div ref={scroller} className={styles.files} role="list" aria-label="改动的文件">
        <div className={styles.filesCanvas} style={{ height: offsets[items.length] }}>
          {rendered}
        </div>
      </div>
      <div className={styles.footer}>
        <span className={styles.spacer} />
        {/* Both wait for F4 (local merge) and F16 (PRs); disabled with a reason rather than hidden. */}
        <button type="button" className={styles.ghostButton} disabled title="即将支持">
          创建 PR
        </button>
        <button type="button" className={styles.primaryButton} disabled title="即将支持：合并在 F4 本地合并完成后可用">
          合并到 {changes.base ?? 'main'}
          <span className={styles.shortcut}>⌘M</span>
        </button>
      </div>
    </>
  )
}

function itemKey(item: ChangeItem, index: number): string {
  if (item.kind === 'group') return `group:${item.title}`
  if (item.kind === 'file') return `file:${item.key}`
  return `${item.kind}:${item.key}:${index}`
}

function Item({ root, item, top }: { root: string; item: ChangeItem; top: number }) {
  const style = { top }
  switch (item.kind) {
    case 'group':
      return (
        <div className={styles.groupHeader} style={style} role="presentation">
          <span className={styles.groupTitle}>{item.title}</span>
          <span className={styles.groupMeta}>{item.meta}</span>
        </div>
      )
    case 'file': {
      const { change, open } = item
      const Chevron = open ? ChevronDown : ChevronRight
      return (
        <div role="listitem" className={styles.fileItem} style={style} data-path={change.path} data-group={item.group}>
          <button
            type="button"
            className={styles.fileRow}
            aria-expanded={open}
            title={`${STATUS_LABEL[change.status]}${change.untracked ? '（未跟踪）' : ''}${change.oldPath ? ` · 原 ${change.oldPath}` : ''}`}
            onClick={() => toggleFile(root, item.key)}
          >
            <Chevron size={16} strokeWidth={1.75} className={styles.fileChevron} />
            <span className={styles.filePath}>{change.path}</span>
            <FileCounts change={change} />
          </button>
        </div>
      )
    }
    case 'diff':
      return <DiffLine row={item.row} top={top} owner={item.key} />
    case 'note':
      return (
        <p className={styles.diffNote} style={style} data-owner={item.key}>
          {item.text}
          {item.open && (
            <button type="button" className={styles.noteAction} onClick={() => void window.tr.worktree.open(root, item.open!)}>
              用默认编辑器打开
            </button>
          )}
        </p>
      )
  }
}

function FileCounts({ change }: { change: GitFileChange }) {
  if (change.nested) return <span className={styles.binary}>嵌套仓库</span>
  if (change.tooLarge) return <span className={styles.binary}>文件太大</span>
  if (change.added === null) return <span className={styles.binary}>二进制</span>
  return (
    <>
      <span className={styles.added}>+{change.added}</span>
      <span className={styles.removed}>−{change.removed ?? 0}</span>
    </>
  )
}

const MARKER: Record<DiffRow['kind'], string> = { hunk: '', context: '', add: '+', del: '−' }

/** Figma DiffLine (12:91): old · new gutters, marker, code. */
function DiffLine({ row, top, owner }: { row: DiffRow; top: number; owner: string }) {
  return (
    <div className={styles.diffLine} style={{ top }} data-kind={row.kind} data-owner={owner}>
      <span className={styles.gutter}>{row.old ?? ''}</span>
      <span className={styles.gutter}>{row.new ?? ''}</span>
      <span className={styles.marker}>{MARKER[row.kind]}</span>
      <span className={styles.code}>{row.text}</span>
    </div>
  )
}
