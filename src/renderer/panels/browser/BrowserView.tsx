// 浏览器 view (PRD F17, Figma 13A / 13E): a page per worktree for checking what the agents' dev servers serve.
// Toolbar on top, the worktree's listening ports below it, the page in a bg/inset well, console counts at the bottom.
// Mounted with key = worktree.
import { Globe } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { formatErrorsForAgent, mergePorts, portUrl, type ListeningPort } from '@shared/browser'
import type { AgentKind, SessionId } from '@shared/types'
import { insertIntoTerminal } from '../../session-io'
import { useWorkspace } from '../../state/workspace'
import { getSurface } from '../../terminal/registry'
import { popupMenu } from '../../ui/menu'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { BrowserBar } from './BrowserBar'
import { usePageSlot } from './page-slot'
import { listenForBrowser, loadPage, setNotice, useBrowser } from './store'
import { browserLayout, consoleLine, emptyHint, isOpenPort, portText, sendLabel } from './view-model'
import styles from './BrowserView.module.css'

/** Mirrors MOBILE_WIDTH in main (src/main/browser/host.ts). */
const MOBILE_WIDTH = 375
const NO_PORTS: ListeningPort[] = []

/** Every session in the active session's worktree: a dev server may run in a shell next to the agent. */
function useWorktreeSessions(sessionId: SessionId): SessionId[] {
  return useWorkspace(
    useShallow((s) => {
      const worktreeId = s.sessions.find((x) => x.id === sessionId)?.worktreeId
      return s.sessions.filter((x) => x.id === sessionId || (worktreeId !== undefined && x.worktreeId === worktreeId)).map((x) => x.id)
    })
  )
}

function useWorktreePorts(sessionIds: SessionId[]): ListeningPort[] {
  const lists = useBrowser(useShallow((s) => sessionIds.map((id) => s.ports[id] ?? NO_PORTS)))
  return useMemo(() => mergePorts(lists), [lists])
}

export function BrowserView({ worktree, sessionId, kind }: { worktree: string; sessionId: SessionId; kind: AgentKind }) {
  const page = useBrowser((s) => s.pages[worktree])
  const notice = useBrowser((s) => s.notices[worktree] ?? null)
  const sessionIds = useWorktreeSessions(sessionId)
  const ports = useWorktreePorts(sessionIds)
  const slot = useRef<HTMLDivElement>(null)
  const layout = browserLayout(page, ports)
  const mobile = page?.mobile ?? false
  const snapshot = usePageSlot(slot, worktree, layout.well === 'page', mobile ? 'mobile' : 'desktop')

  useEffect(() => {
    listenForBrowser()
    void loadPage(worktree)
  }, [worktree])

  const watchKey = sessionIds.join(' ')
  useEffect(() => {
    const ids = watchKey.split(' ').filter(Boolean)
    for (const id of ids) window.tr.browser.watchPorts(id)
    return () => {
      for (const id of ids) window.tr.browser.unwatchPorts(id)
    }
  }, [watchKey])

  usePageContextMenu(worktree, slot)

  const open = (port: ListeningPort) => {
    setNotice(worktree, null)
    window.tr.browser.navigate(worktree, portUrl(port))
  }

  return (
    <>
      <BrowserBar worktree={worktree} page={page} onError={(message) => setNotice(worktree, message)} />
      {notice ? (
        <div className={styles.row} role="alert">
          <StatusGlyph status="error" />
          <span className={styles.noticeText} title={notice}>
            {notice}
          </span>
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
                data-selected={page ? isOpenPort(p, page.url) : false}
                title={`打开 ${portUrl(p)}`}
                onClick={() => open(p)}
              >
                {portText(p)}
              </button>
            ))}
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
      {layout.console && page && <ConsoleRow worktree={worktree} sessionId={sessionId} kind={kind} />}
    </>
  )
}

/** Right-click in the page: main reports it, the app draws the menu (so it matches every other menu here). */
function usePageContextMenu(worktree: string, slot: RefObject<HTMLDivElement | null>): void {
  useEffect(
    () =>
      window.tr.browser.onContextMenu((menu) => {
        const rect = slot.current?.getBoundingClientRect()
        if (menu.worktree !== worktree || !rect) return
        const at = { x: menu.x, y: menu.y }
        void popupMenu(
          [
            { type: 'item', id: 'back', label: '后退', enabled: menu.canGoBack, accelerator: 'CmdOrCtrl+[' },
            { type: 'item', id: 'reload', label: '刷新', accelerator: 'CmdOrCtrl+R' },
            { type: 'item', id: 'copy', label: '复制', enabled: menu.canCopy, accelerator: 'CmdOrCtrl+C' },
            { type: 'item', id: 'paste', label: '粘贴', enabled: menu.canPaste, accelerator: 'CmdOrCtrl+V' },
            { type: 'item', id: 'inspect', label: '检查元素' }
          ],
          { x: rect.left + menu.x, y: rect.top + menu.y }
        ).then((id) => {
          if (id === 'back' || id === 'reload' || id === 'copy' || id === 'paste' || id === 'inspect') window.tr.browser.pageCommand(worktree, id, at)
        })
      }),
    [worktree, slot]
  )
}

function ConsoleRow({ worktree, sessionId, kind }: { worktree: string; sessionId: SessionId; kind: AgentKind }) {
  const page = useBrowser((s) => s.pages[worktree])
  const [sent, setSent] = useState(false)
  useEffect(() => {
    if (!sent) return
    const timer = setTimeout(() => setSent(false), 2000)
    return () => clearTimeout(timer)
  }, [sent])
  if (!page) return null
  const line = consoleLine(page.console, page.loading)

  // The errors are page-controlled text going to an agent that runs tools: it goes into the input line, quoted,
  // and the user reads it and presses Enter themselves.
  const send = () => {
    insertIntoTerminal(sessionId, formatErrorsForAgent(page.console, page.url)).then(
      () => {
        setSent(true)
        getSurface(sessionId)?.focus()
      },
      (error: unknown) => setNotice(worktree, error instanceof Error ? error.message : '没有放进终端')
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
      {page.console.errors > 0 && (
        <button type="button" className={styles.ghost} onClick={send} disabled={sent} title="把错误放进终端的输入行，确认后按回车发送">
          {sent ? '已放进输入行' : sendLabel(kind)}
        </button>
      )}
    </div>
  )
}
