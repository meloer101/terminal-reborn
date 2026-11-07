// One file's change as the chat draws it (PRD F23, Figma 59J / 59I): a 1px border/subtle frame, the added and removed
// lines tinted, hunks apart by a ⋯ line; with its path · +N −M on a header row where the file is not named next to it
// (a change to several files, a permission card). Used by the feed's tool rows (Feed) and the permission card (Cards).
import type { FileDiff } from '@shared/transcript-chat'
import styles from './Chat.module.css'

export function DiffBlock({ diff, header, className }: { diff: FileDiff; header: boolean; className?: string }) {
  return (
    <div className={className ? `${styles.fileBlock} ${className}` : styles.fileBlock} data-testid="gui-diff">
      {header && (
        <div className={styles.fileHeader}>
          <span className={styles.filePath} title={diff.path}>
            {diff.path}
          </span>
          {diff.added > 0 && <span className={styles.added}>+{diff.added}</span>}
          {diff.removed > 0 && <span className={styles.removed}>−{diff.removed}</span>}
        </div>
      )}
      {(diff.hunks.length > 0 || diff.truncated) && (
        <pre className={styles.fileLines}>
          <span className={styles.fileRows}>
            {diff.hunks.map((hunk, h) => (
              <span key={h}>
                {h > 0 && <span className={styles.hunkGap}>⋯{'\n'}</span>}
                {hunk.lines.map((line, i) => (
                  <span key={i} className={styles.diffLine} data-kind={line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'}>
                    <span className={styles.diffSign}>{line[0] === '+' || line[0] === '-' ? line[0] : ' '}</span>
                    {line.slice(1)}
                    {'\n'}
                  </span>
                ))}
              </span>
            ))}
            {diff.truncated && <span className={styles.hunkGap}>…</span>}
          </span>
        </pre>
      )}
    </div>
  )
}

/** A change's lines as text, for copying: each file's, a blank line apart. */
export const diffText = (files: readonly FileDiff[]): string => files.map((f) => f.hunks.flatMap((h) => h.lines).join('\n')).join('\n\n')
