// 浏览器 view (PRD F17, Figma 13A / 13E): a page per worktree for checking what the agents' dev servers serve.
// Toolbar on top, the session's listening ports below it, the page in a bg/inset well, console counts at the bottom.
// Mounted with key = worktree, so local state (a notice) never carries over to another worktree.
import { Globe, Smartphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatErrorsForAgent, localPortOf, type ListeningPort } from '@shared/browser'
import type { AgentKind, SessionId } from '@shared/types'
import { submitPrompt } from '../../session-io'
import { IconButton } from '../../ui/IconButton'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { BrowserBar } from './BrowserBar'
import { usePageSlot } from './page-slot'
import { listenForBrowser, loadPage, useBrowser } from './store'
import { browserLayout, consoleLine, emptyHint, portText, sendLabel } from './view-model'
import styles from './BrowserView.module.css'

/** Mirrors MOBILE_WIDTH in main (src/main/browser/host.ts). */
const MOBILE_WIDTH = 375
const NO_PORTS: ListeningPort[] = []

export function BrowserView({ worktree, sessionId, kind }: { worktree: string; sessionId: SessionId; kind: AgentKind }) {
  const page = useBrowser((s) => s.pages[worktree])
  const ports = useBrowser((s) => s.ports[sessionId]) ?? NO_PORTS
  const [notice, setNotice] = useState<string | null>(null)
  const slot = useRef<HTMLDivElement>(null)
  const layout = browserLayout(page, ports)
  const mobile = page?.mobile ?? false
  const snapshot = usePageSlot(slot, worktree, layout.well === 'page', mobile ? 'mobile' : 'desktop')

  useEffect(() => {
    listenForBrowser()
    void loadPage(worktree)
  }, [worktree])

  useEffect(() => {
    window.tr.browser.watchPorts(sessionId)
    return () => window.tr.browser.unwatchPorts(sessionId)
  }, [sessionId])

  const current = page ? localPortOf(page.url) : null
  const open = (port: number) => {
    setNotice(null)
    window.tr.browser.navigate(worktree, `http://localhost:${port}/`)
  }

  return (
    <>
      <BrowserBar worktree={worktree} page={page} onError={setNotice} />
      {notice ? (
        <div className={styles.row} role="alert">
          <StatusGlyph status="error" />
          <span className={styles.noticeText}>{notice}</span>
        </div>
      ) : (
        layout.ports && (
          <div className={styles.row} role="group" aria-label="端口">
            {ports.length > 0 && <span className={styles.rowLabel}>端口</span>}
            {ports.map((p) => (
              <button
                key={p.port}
                type="button"
                className={styles.port}
                data-selected={p.port === current}
                title={`打开 http://localhost:${p.port}`}
                onClick={() => open(p.port)}
              >
                {portText(p)}
              </button>
            ))}
            <span className={styles.spacer} />
            {page?.url && (
              <IconButton
                label={mobile ? '退出手机视口' : '手机视口 375'}
                active={mobile}
                aria-pressed={mobile}
                onClick={() => window.tr.browser.setMobile(worktree, !mobile)}
              >
                <Smartphone size={16} strokeWidth={1.75} />
              </IconButton>
            )}
          </div>
        )
      )}
      <div className={styles.wellArea}>
        {layout.well === 'empty' && (
          <div className={styles.empty} data-testid="browser-empty">
            <Globe size={16} strokeWidth={1.75} aria-hidden />
            <p className={styles.emptyTitle}>这个会话还没有打开网页</p>
            <p className={styles.emptyHint}>{emptyHint(ports)}</p>
          </div>
        )}
        {layout.well === 'error' && page?.loadError && (
          <div className={styles.well} data-filled="false">
            <div className={styles.empty} role="status">
              <p className={styles.emptyTitle}>{page.loadError}</p>
              <p className={styles.emptyHint}>确认服务已经启动，然后点刷新。</p>
            </div>
          </div>
        )}
        {layout.well === 'page' && (
          <div className={styles.well} data-mobile={mobile}>
            <div
              ref={slot}
              className={styles.page}
              style={mobile ? { width: MOBILE_WIDTH } : undefined}
              data-testid="browser-page"
              aria-label={page?.title || '网页'}
              role="region"
            >
              {snapshot && <img className={styles.snapshot} src={snapshot} alt="" />}
            </div>
          </div>
        )}
      </div>
      {layout.console && page && <ConsoleRow worktree={worktree} sessionId={sessionId} kind={kind} onNotice={setNotice} />}
    </>
  )
}

function ConsoleRow({
  worktree,
  sessionId,
  kind,
  onNotice
}: {
  worktree: string
  sessionId: SessionId
  kind: AgentKind
  onNotice: (message: string | null) => void
}) {
  const page = useBrowser((s) => s.pages[worktree])
  const [sent, setSent] = useState(false)
  useEffect(() => {
    if (!sent) return
    const timer = setTimeout(() => setSent(false), 2000)
    return () => clearTimeout(timer)
  }, [sent])
  if (!page) return null
  const line = consoleLine(page.console, page.loading)
  const label = sendLabel(kind)

  const send = () => {
    const text = formatErrorsForAgent(page.console, page.url)
    submitPrompt(sessionId, text).then(
      () => setSent(true),
      (error: unknown) => onNotice(error instanceof Error ? error.message : '没有发出去')
    )
  }

  return (
    <div className={styles.console} data-testid="browser-console">
      {line.errors && (
        <>
          <StatusGlyph status="error" />
          <span className={styles.errors}>{line.errors}</span>
        </>
      )}
      {line.rest && <span className={styles.consoleRest}>{line.rest}</span>}
      <span className={styles.spacer} />
      {label && page.console.errors > 0 && (
        <button type="button" className={styles.ghost} onClick={send} disabled={sent}>
          {sent ? '已发送' : label}
        </button>
      )}
    </div>
  )
}
