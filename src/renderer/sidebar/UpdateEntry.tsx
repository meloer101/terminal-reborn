// The sidebar's 更新 (Figma 36G / 36I, PRD v1.93): above 额度, it opens a small panel with the running version and
// 检查更新. A newer GitHub release turns the button into 下载 <version>, which opens the release page — Wavi never
// downloads or installs anything itself (PRD §7). Replaces settings' 关于 pane.
import { useCallback, useRef, useState } from 'react'
import { CircleArrowUp } from 'lucide-react'
import type { UpdateInfo } from '@shared/ipc'
import { Popover } from '../session-meta/Popover'
import { NavItem } from './NavItem'
import styles from './UpdateEntry.module.css'

type UpdateState = { phase: 'idle' } | { phase: 'checking' } | { phase: 'latest' } | { phase: 'available'; info: UpdateInfo }

export function UpdateEntry() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  const check = (): void => {
    setState({ phase: 'checking' })
    void window.tr.app
      .checkForUpdates()
      .then((info) => setState(info ? { phase: 'available', info } : { phase: 'latest' }))
      .catch(() => setState({ phase: 'idle' }))
  }

  return (
    <>
      <NavItem
        ref={anchor}
        icon={<CircleArrowUp size={16} strokeWidth={1.75} />}
        label="更新"
        selected={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <Popover anchor={anchor} label="更新" onClose={close} placement="above" className={styles.panel} testId="update-popover">
          <div className={styles.version}>
            <span className={styles.name}>Wavi</span>
            <span className={styles.number} data-testid="app-version">
              {window.tr.app.version}
            </span>
          </div>
          {state.phase !== 'idle' && (
            <p className={styles.status} role="status" aria-live="polite" data-new={state.phase === 'available'}>
              {state.phase === 'checking' && '正在检查…'}
              {state.phase === 'latest' && '已是最新版本'}
              {state.phase === 'available' && `有新版本 ${state.info.version}`}
            </p>
          )}
          {state.phase === 'available' ? (
            <a className={`${styles.button} ${styles.primary}`} href={state.info.url} target="_blank" rel="noreferrer">
              下载 {state.info.version}
            </a>
          ) : (
            <button type="button" className={styles.button} onClick={check} disabled={state.phase === 'checking'}>
              检查更新
            </button>
          )}
        </Popover>
      )}
    </>
  )
}
