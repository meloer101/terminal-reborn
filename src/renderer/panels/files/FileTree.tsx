// The tree itself: FileTreeRow (Figma 130:259) rows with keyboard navigation, double-click preview and the context menu.
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type Ref } from 'react'
import type { SessionId } from '@shared/types'
import { pointerAnchor } from '../../ui/menu'
import { openFileMenu, runFileAction, type FileTarget } from './actions'
import { fileActionForKey } from './keys'
import { select, showPreview, toggleDir } from './store'
import { stepRow, type TreeRow } from './tree-model'
import styles from './FilesView.module.css'

const MARK_LABEL: Record<NonNullable<TreeRow['mark']>, string> = {
  M: '已修改',
  A: '新增',
  D: '已删除',
  U: '未跟踪',
  '•': '包含改动'
}

interface Props {
  ref?: Ref<HTMLDivElement>
  root: string
  sessionId: SessionId
  rows: TreeRow[]
  selected: string | null
}

export function FileTree({ ref, root, sessionId, rows, selected }: Props) {
  const id = useId()
  const list = useRef<HTMLDivElement | null>(null)
  const index = selected === null ? -1 : rows.findIndex((r) => r.path === selected)
  const target = (row: TreeRow): FileTarget => ({ root, path: row.path, dir: row.dir, sessionId })

  // Keep the keyboard's row in view.
  useEffect(() => {
    if (index < 0) return
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const activate = (row: TreeRow) => {
    if (row.dir) toggleDir(root, row.path)
    else showPreview(root, row.path)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[index]
    const move = (to: number | null) => {
      e.preventDefault()
      if (to !== null && rows[to]) select(root, rows[to].path)
    }
    if (e.key === 'ArrowDown' && !e.metaKey) return move(stepRow(rows, index, 'down'))
    if (e.key === 'ArrowUp' && !e.metaKey) return move(stepRow(rows, index, 'up'))
    if (e.key === 'ArrowRight' && row) {
      if (row.dir && !row.expanded) {
        e.preventDefault()
        return toggleDir(root, row.path)
      }
      return move(stepRow(rows, index, 'right'))
    }
    if (e.key === 'ArrowLeft' && row) {
      if (row.dir && row.expanded) {
        e.preventDefault()
        return toggleDir(root, row.path)
      }
      return move(stepRow(rows, index, 'left'))
    }
    if (!row) return
    const action = fileActionForKey(e)
    if (!action) return
    e.preventDefault()
    e.stopPropagation()
    if (action === 'preview') activate(row)
    else runFileAction(action, target(row))
  }

  const onClick = (e: MouseEvent, row: TreeRow) => {
    select(root, row.path)
    // A folder opens on the first click; the second click of a double-click must not shut it again.
    if (row.dir && e.detail === 1) toggleDir(root, row.path)
  }

  const onContextMenu = (e: MouseEvent<HTMLDivElement>, row: TreeRow) => {
    e.preventDefault()
    select(root, row.path)
    void openFileMenu(target(row), pointerAnchor(e))
  }

  return (
    <div
      ref={(el) => {
        list.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      className={styles.tree}
      role="tree"
      aria-label="文件"
      tabIndex={0}
      aria-activedescendant={index >= 0 ? `${id}-${index}` : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (index < 0 && rows[0]) select(root, rows[0].path)
      }}
    >
      {rows.map((row, i) => (
        <div
          key={row.path}
          id={`${id}-${i}`}
          className={styles.row}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={row.dir ? row.expanded : undefined}
          aria-selected={i === index}
          aria-busy={row.loading || undefined}
          data-index={i}
          data-path={row.path}
          data-ignored={row.ignored}
          style={{ paddingLeft: `calc(var(--space-8) + ${row.depth} * var(--space-16))` }}
          onClick={(e) => onClick(e, row)}
          onDoubleClick={() => {
            if (!row.dir) showPreview(root, row.path)
          }}
          onContextMenu={(e) => onContextMenu(e, row)}
        >
          <span className={styles.chevron} aria-hidden>
            {row.dir && (row.expanded ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />)}
          </span>
          <span className={styles.icon} aria-hidden>
            {row.dir ? (
              row.expanded ? (
                <FolderOpen size={16} strokeWidth={1.75} />
              ) : (
                <Folder size={16} strokeWidth={1.75} />
              )
            ) : (
              <File size={16} strokeWidth={1.75} />
            )}
          </span>
          <span className={styles.name}>{row.name}</span>
          {row.mark && (
            <span className={styles.mark} data-mark={row.mark} title={MARK_LABEL[row.mark]} aria-label={MARK_LABEL[row.mark]}>
              {row.mark}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

