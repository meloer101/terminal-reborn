// A copy button in a GUI session's feed (PRD F23, Figma 54A / 54B): a message, a code block, a tool's output. It shows
// ✓ for a moment once the text is on the clipboard.
import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const DONE_MS = 1200

export function CopyButton({ text, label = '复制', className }: { text: string | (() => string); label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), DONE_MS)
    return () => clearTimeout(timer)
  }, [done])
  return (
    <button
      type="button"
      className={[styles.actionIcon, className].filter(Boolean).join(' ')}
      aria-label={done ? '已复制' : label}
      title={label}
      // The keyboard stays where it was (the composer).
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        void navigator.clipboard
          .writeText(typeof text === 'function' ? text() : text)
          .then(() => setDone(true))
          .catch(() => undefined)
      }}
    >
      {done ? <Check {...ICON} /> : <Copy {...ICON} />}
    </button>
  )
}
