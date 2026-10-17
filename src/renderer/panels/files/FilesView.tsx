// 文件 view (PRD F17, Figma 13D / 13G): the active worktree's tree with git state, a filter, and the read-only preview.
import { Ellipsis, FolderOpen, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { indexStatus } from '@shared/worktree-files'
import type { SessionId } from '@shared/types'
import { IconButton } from '../../ui/IconButton'
import { popupMenu } from '../../ui/menu'
import { PaneHeader } from '../PaneHeader'
import { FilePreview } from './FilePreview'
import { FileTree } from './FileTree'
import { collapseAll, filesOf, listenForChanges, openRoot, refreshAll, setChangedOnly, setFilter, useFiles } from './store'
import { baseName, filterPaths, pathRows, treeRows, type TreeRow } from './tree-model'
import styles from './FilesView.module.css'

/** The filter lists at most this many matches. */
const MAX_MATCHES = 500

export function FilesView({ root, sessionId }: { root: string; sessionId: SessionId }) {
  const files = useFiles((s) => s.roots[root]) ?? filesOf(root)
  const treeRef = useRef<HTMLDivElement>(null)
  // Leaving the preview hands the keyboard back to the tree, once it is shown again.
  const returning = useRef(false)
  useEffect(() => {
    if (files.preview !== null || !returning.current) return
    returning.current = false
    treeRef.current?.focus()
  }, [files.preview])

  useEffect(() => {
    listenForChanges()
    openRoot(root)
    window.tr.worktree.watch(root)
    return () => window.tr.worktree.unwatch(root)
  }, [root])

  const status = useMemo(() => indexStatus(files.status), [files.status])
  const query = files.filter.trim()
  const rows = useMemo((): TreeRow[] => {
    if (files.changedOnly) {
      const changed = Object.keys(files.status?.changes ?? {})
      return pathRows(query ? filterPaths(changed, query, MAX_MATCHES) : changed, status, files.collapsed)
    }
    if (query) return pathRows(filterPaths(files.allFiles ?? [], query, MAX_MATCHES), status, files.collapsed)
    return treeRows(files, status)
  }, [files, query, status])

  if (files.preview !== null) return (
      <FilePreview
        root={root}
        path={files.preview}
        sessionId={sessionId}
        letter={status.letter(files.preview)}
        onBack={() => {
          returning.current = true
        }}
      />
    )

  const onFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape' && files.filter) {
      e.preventDefault()
      e.stopPropagation()
      setFilter(root, '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      treeRef.current?.focus()
    }
  }

  const rootError = files.errors['']
  const empty = rootError
    ? '无法读取这个文件夹'
    : files.changedOnly
      ? files.status === null
        ? '不是 git 仓库'
        : query
          ? '没有匹配的改动'
          : '没有改动'
      : query
        ? files.allFiles === null
          ? '正在查找…'
          : '没有匹配的文件'
        : files.children[''] && files.children[''].length === 0
          ? '文件夹是空的'
          : null

  return (
    <>
      <PaneHeader title="文件" context={baseName(root)}>
        <IconButton label="在 Finder 中打开" onClick={() => window.tr.worktree.reveal(root, '')}>
          <FolderOpen size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="更多"
          aria-haspopup="menu"
          onClick={(e) => {
            void popupMenu(
              [
                { type: 'item', id: 'refresh', label: '刷新' },
                { type: 'item', id: 'collapse', label: '全部折叠' }
              ],
              e.currentTarget
            ).then((choice) => {
              if (choice === 'refresh') refreshAll(root)
              else if (choice === 'collapse') collapseAll(root)
            })
          }}
        >
          <Ellipsis size={16} strokeWidth={1.75} />
        </IconButton>
      </PaneHeader>
      <div className={styles.filterRow}>
        <label className={styles.search}>
          <Search size={16} strokeWidth={1.75} className={styles.searchIcon} aria-hidden />
          <input
            className={styles.input}
            type="search"
            aria-label="筛选文件名"
            placeholder="筛选文件名"
            spellCheck={false}
            value={files.filter}
            onChange={(e) => setFilter(root, e.target.value)}
            onKeyDown={onFilterKeyDown}
          />
          <button
            type="button"
            className={styles.segment}
            aria-pressed={files.changedOnly}
            disabled={files.status === null && !files.changedOnly}
            title={files.changedOnly ? '显示全部文件' : '只显示有改动的文件'}
            onClick={() => setChangedOnly(root, !files.changedOnly)}
          >
            有改动 {status.count}
          </button>
        </label>
      </div>
      {empty && rows.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <FileTree ref={treeRef} root={root} sessionId={sessionId} rows={rows} selected={files.selected} />
      )}
    </>
  )
}
