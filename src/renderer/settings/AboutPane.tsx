import { useState } from 'react'
import type { UpdateInfo } from '@shared/ipc'
import styles from './panes.module.css'

type UpdateState = { phase: 'idle' } | { phase: 'checking' } | { phase: 'latest' } | { phase: 'available'; info: UpdateInfo }

export function AboutPane() {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })

  const check = (): void => {
    setState({ phase: 'checking' })
    void window.tr.app.checkForUpdates().then((info) => setState(info ? { phase: 'available', info } : { phase: 'latest' }))
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>关于</h1>
      <div className={styles.aboutRow}>
        <span className={styles.aboutName}>Terminal Reborn</span>
        <span className={styles.version} data-testid="app-version">
          {window.tr.app.version}
        </span>
      </div>
      <div className={styles.aboutRow}>
        <button type="button" className={styles.button} onClick={check} disabled={state.phase === 'checking'}>
          检查更新
        </button>
        <span className={styles.status} role="status" aria-live="polite">
          {state.phase === 'checking' && '正在检查…'}
          {state.phase === 'latest' && '已是最新版本'}
          {state.phase === 'available' && (
            <>
              有新版本 {state.info.version}
              {' · '}
              <a className={styles.link} href={state.info.url} target="_blank" rel="noreferrer">
                查看发布说明
              </a>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
