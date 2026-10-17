// Read-only file preview (PRD F17, Figma 13F): line numbers and change marks; Esc / ← goes back to the tree.
import { ArrowLeft, Code, Ellipsis } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { SessionId } from '@shared/types'
import type { FilePreview as Preview, GitLetter, LineMark, LineMarkRange } from '@shared/worktree-files'
import { IconButton } from '../../ui/IconButton'
import { formatAccelerator } from '../../ui/menu-model'
import { ClosePanelButton } from '../PaneHeader'
import { openFileMenu, runFileAction, type FileTarget } from './actions'
import { FILE_SHORTCUTS, fileActionForKey } from './keys'
import { reveal, showPreview, useFiles } from './store'
import { parentOf } from './tree-model'
import { previewLines, MAX_PREVIEW_LINES } from './preview-model'
import styles from './FilesView.module.css'

interface Loaded {
  preview: Preview
  marks: LineMarkRange[]
}

interface Props {
  root: string
  path: string
  sessionId: SessionId
  letter: GitLetter | null
  /** Back to the tree (which then takes the keyboard). */
  onBack(): void
}

export function FilePreview({ root, path, sessionId, letter, onBack }: Props) {
  const revision = useFiles((s) => s.roots[root]?.previewRevision ?? 0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const target: FileTarget = { root, path, dir: false, sessionId }

  useEffect(() => {
    let cancelled = false
    const wantsMarks = letter === 'M' || letter === 'A'
    void Promise.all([window.tr.worktree.readFile(root, path), wantsMarks ? window.tr.worktree.lineMarks(root, path) : Promise.resolve([])])
      .then(([preview, marks]) => {
        if (cancelled) return
        setLoaded({ preview, marks })
        setError(null)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [root, path, letter, revision])

  useEffect(() => body.current?.focus({ preventScroll: true }), [path])

  const lines = useMemo(
    () => (loaded?.preview.kind === 'text' ? previewLines(loaded.preview.text, letter === 'U' ? 'all-added' : loaded.marks) : null),
    [loaded, letter]
  )

  const back = () => {
    reveal(root, path)
    showPreview(root, null)
    onBack()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || (e.key === 'ArrowLeft' && !e.metaKey && !e.altKey && (body.current?.scrollLeft ?? 0) === 0)) {
      e.preventDefault()
      e.stopPropagation()
      back()
      return
    }
    const action = fileActionForKey(e)
    if (!action || action === 'preview') return
    e.preventDefault()
    e.stopPropagation()
    runFileAction(action, target)
  }

  const dir = parentOf(path)
  const name = path.slice(dir ? dir.length + 1 : 0)
  const message = error
    ? '无法读取这个文件'
    : loaded?.preview.kind === 'binary'
      ? '二进制文件，无法预览'
      : loaded?.preview.kind === 'too-large'
        ? `文件超过 1 MB，用默认编辑器打开（${formatAccelerator(FILE_SHORTCUTS.open)}）`
        : loaded?.preview.kind === 'missing'
          ? '文件已删除'
          : null

  return (
    <>
      <div className={styles.previewHeader}>
        <IconButton label="返回目录树" title="返回目录树 · Esc" onClick={back}>
          <ArrowLeft size={16} strokeWidth={1.75} />
        </IconButton>
        <span className={styles.path} title={path}>
          {dir && (
            <span className={styles.pathDir}>
              <bdi dir="ltr">{dir}/</bdi>
            </span>
          )}
          <span className={styles.pathName}>{name}</span>
        </span>
        {letter && (
          <span className={styles.mark} data-mark={letter}>
            {letter}
          </span>
        )}
        <span className={styles.previewTools}>
          <IconButton label="用默认编辑器打开" title={`用默认编辑器打开 · ${formatAccelerator(FILE_SHORTCUTS.open)}`} onClick={() => runFileAction('open', target)}>
            <Code size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="更多" aria-haspopup="menu" onClick={(e) => void openFileMenu(target, e.currentTarget, { withPreview: false })}>
            <Ellipsis size={16} strokeWidth={1.75} />
          </IconButton>
          <ClosePanelButton />
        </span>
      </div>
      <div ref={body} className={styles.code} tabIndex={0} role="document" aria-label={`${path} 预览`} data-testid="file-preview" onKeyDown={onKeyDown}>
        {message ? (
          <p className={styles.empty}>{message}</p>
        ) : (
          lines && (
            <div className={styles.lines}>
              {lines.rows.map((line) => (
                <div key={line.number} className={styles.line} data-mark={line.mark ?? undefined}>
                  <span className={styles.changeMark} aria-label={line.mark ? MARK_LABEL[line.mark] : undefined} />
                  <span className={styles.lineNo}>{line.number}</span>
                  <span className={styles.lineText}>{line.text}</span>
                </div>
              ))}
              {lines.truncated && (
                <p className={styles.truncated}>
                  只显示前 {MAX_PREVIEW_LINES} 行，用默认编辑器打开查看全部（{formatAccelerator(FILE_SHORTCUTS.open)}）
                </p>
              )}
            </div>
          )
        )}
      </div>
    </>
  )
}

const MARK_LABEL: Record<LineMark, string> = { add: '新增的行', mod: '改动的行' }
