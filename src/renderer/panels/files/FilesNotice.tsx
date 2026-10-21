// The one-line notice under the 文件 view's header (store · notice), in the tree and in the preview.
import { useFiles } from './store'
import styles from './FilesView.module.css'

export function FilesNotice({ root }: { root: string }) {
  const notice = useFiles((s) => s.roots[root]?.notice ?? null)
  if (!notice) return null
  return (
    <p className={styles.notice} role="status" data-testid="files-notice">
      {notice}
    </p>
  )
}
