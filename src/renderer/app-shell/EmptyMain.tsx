// Welcome page: the main area when no session is selected (PRD F18 · Figma 14). A greeting, one short line and one
// next step. The sidebar already carries navigation and projects, so nothing here repeats it; the agent install
// block appears only when neither supported agent is installed. It comes in with the mark's entrance (Figma 39G,
// mark-entrance.ts), carried on from the boot screen on a cold start (Figma 39I, boot.ts).
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { Copy } from 'lucide-react'
import type { AgentAvailability } from '@shared/ipc'
import type { AgentKind } from '@shared/types'
import { SHORTCUTS } from '@shared/shortcuts'
import { openProjectInteractive, openProjectPath } from '../state/session-actions'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { Segmented } from '../ui/Segmented'
import { StatusGlyph } from '../ui/StatusGlyph'
import { formatAccelerator } from '../ui/menu-model'
import { claimBoot, rememberBootLayout, type BootPose } from './boot'
import { defaultAgent, greeting, INSTALLABLE_AGENTS, needsAgentInstall, pickQuote } from './empty-main'
import { entranceTracks, type EntranceStart } from './mark-entrance'
import { MARK_SEGMENTS, MARK_VIEW_BOX } from './mark-segments'
import styles from './EmptyMain.module.css'

/** Picked once per launch, so the line does not change every time the page reappears. */
const QUOTE = pickQuote()

const HINTS = [
  [SHORTCUTS['command-palette'], '跳转到'],
  [SHORTCUTS['toggle-overview'], '总览'],
  [SHORTCUTS['next-attention'], '下一个等你处理'],
  [SHORTCUTS['open-project'], '打开项目']
] as const

function useAgentAvailability(): AgentAvailability | null {
  const [agents, setAgents] = useState<AgentAvailability | null>(null)
  useEffect(() => {
    let live = true
    window.tr.app
      .detectAgents()
      .then((result) => live && setAgents(result))
      .catch(() => live && setAgents({}))
    return () => {
      live = false
    }
  }, [])
  return agents
}

/** Read once per launch: later visits to the welcome page have it at once. */
let knownName: string | null = null

/** The user's name; null until it is known. */
function useUserName(): string | null {
  const [name, setName] = useState(knownName)
  useEffect(() => {
    if (knownName !== null) return
    let live = true
    window.tr.app
      .userName()
      .catch(() => '')
      .then((result) => {
        knownName = result
        if (live) setName(result)
      })
    return () => {
      live = false
    }
  }, [])
  return name
}

/** The greeting waits this long for the name at most, so its row does not shift once the mark has landed beside it. */
const NAME_WAIT = 300

/** The boot screen's mark, claimed once per launch (StrictMode runs the effect twice; both share the claim). */
let bootHandOff: Promise<BootPose | null> | null = null
/** Set while the claim waits; the boot screen lets go if the page goes away before it arrives. */
let bootWaiting = false
let letGo: ReturnType<typeof setTimeout> | undefined

/**
 * Plays the entrance (mark-entrance.ts) once the name is known: from the boot screen's mark on a cold start, else the
 * full weave. A page that is not on screen (behind the overview, or drawn in another window) skips it.
 */
function useEntrance(cardRef: RefObject<HTMLDivElement | null>, welcomeRef: RefObject<HTMLDivElement | null>, nameKnown: boolean): void {
  useLayoutEffect(() => {
    if (welcomeRef.current) welcomeRef.current.dataset.entrance = 'hold'
  }, [welcomeRef])
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), NAME_WAIT)
    return () => clearTimeout(timer)
  }, [])
  const go = nameKnown || waited
  useEffect(() => {
    const card = cardRef.current
    const welcome = welcomeRef.current
    const mark = welcome?.querySelector<SVGSVGElement>('[data-entrance-part="mark"]')
    const text = welcome?.querySelector<HTMLElement>('[data-entrance-part="greeting"]')
    if (!go || !card || !welcome || !mark || !text || welcome.dataset.entrance !== 'hold') return
    if (welcome.ownerDocument !== document || card.getClientRects().length === 0) {
      void claimBoot('away')
      welcome.dataset.entrance = 'done'
      return
    }
    let live = true
    const animations: Animation[] = []
    const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    const cardBox = card.getBoundingClientRect()
    const anchor = { x: cardBox.left + cardBox.width / 2, y: centre(mark.getBoundingClientRect()).y }
    rememberBootLayout({
      left: cardBox.left,
      top: cardBox.top,
      right: window.innerWidth - cardBox.right,
      bottom: window.innerHeight - cardBox.bottom,
      anchorY: anchor.y - cardBox.top
    })
    clearTimeout(letGo)
    if (!bootHandOff) {
      bootWaiting = true
      bootHandOff = claimBoot('welcome', anchor)
      // Spent once it arrives, used or not: a later visit weaves instead of starting from a stale pose.
      void bootHandOff.then(() => {
        bootWaiting = false
        bootHandOff = Promise.resolve(null)
      })
    }
    void bootHandOff.then((pose) => {
      if (!live) return
      const box = mark.getBoundingClientRect()
      const rest = Array.from(welcome.querySelectorAll<HTMLElement>('[data-entrance-rest]'))
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const start: EntranceStart = reduce ? { kind: 'reduced' } : pose ? { kind: 'boot', scale: pose.size / box.width } : { kind: 'weave' }
      const from = pose ?? anchor
      const tracks = entranceTracks(start, { dx: from.x - centre(box).x, dy: from.y - centre(box).y, size: box.width, rest: rest.length })
      for (const { target, keyframes, options } of tracks) {
        const el =
          target === 'mark' ? mark : target === 'greeting' ? text : 'segment' in target ? mark.children[target.segment] : rest[target.rest]
        if (el) animations.push(el.animate(keyframes, options))
      }
      welcome.dataset.entrance = 'play'
      void Promise.all(animations.map((a) => a.finished)).then(
        () => live && (welcome.dataset.entrance = 'done'),
        () => {}
      )
    })
    return () => {
      live = false
      // Gone before the mark arrived (a session was picked during the boot): the dots scatter. Deferred, because
      // StrictMode runs this cleanup and the effect again at once, and that run still wants the mark.
      if (bootWaiting) letGo = setTimeout(() => void claimBoot('away'))
      for (const a of animations) a.cancel()
      // Cancelled half way (StrictMode, or the page went away): the next run starts over.
      if (welcome.dataset.entrance === 'play') welcome.dataset.entrance = 'hold'
    }
  }, [go, cardRef, welcomeRef])
}

/** The folder in a drop, if the first dropped item is one. */
function droppedFolder(e: DragEvent): string | null {
  const item = Array.from(e.dataTransfer.items).find((i) => i.kind === 'file')
  const entry = item?.webkitGetAsEntry()
  const file = item?.getAsFile()
  if (!entry?.isDirectory || !file) return null
  const path = window.tr.files.pathForFile(file)
  return path.length > 0 ? path : null
}

function InstallAgent() {
  const [selected, setSelected] = useState(INSTALLABLE_AGENTS[0]!)
  return (
    <section className={styles.install} aria-label="安装 agent" data-testid="install-agent" data-entrance-rest>
      <p className={styles.installMessage}>
        <StatusGlyph status="needs_you" />
        还没有装任何 agent，选一个装上：
      </p>
      <Segmented
        label="选择 agent"
        variant="plain"
        className={styles.picker}
        value={selected.id}
        options={INSTALLABLE_AGENTS.map((agent) => ({ value: agent.id, label: agent.name }))}
        onChange={(id) => setSelected(INSTALLABLE_AGENTS.find((agent) => agent.id === id) ?? selected)}
      />
      <div className={styles.command}>
        <code>{selected.command}</code>
        <IconButton label={`复制 ${selected.name} 安装命令`} onClick={() => void navigator.clipboard.writeText(selected.command).catch(() => {})}>
          <Copy size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    </section>
  )
}

export function EmptyMain() {
  const hasProjects = useWorkspace((s) => s.projects.length > 0)
  const agents = useAgentAvailability()
  const name = useUserName()
  const [dragging, setDragging] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const welcomeRef = useRef<HTMLDivElement>(null)
  useEntrance(cardRef, welcomeRef, name !== null)

  // New sessions start the installed agent: Claude Code, else Codex.
  const kind: AgentKind = defaultAgent(agents)

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragging(false)
    const path = droppedFolder(e)
    if (path) openProjectPath(path, kind)
  }

  return (
    <div
      ref={cardRef}
      className={styles.empty}
      data-testid="empty-main"
      data-dragging={dragging}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div ref={welcomeRef} className={styles.welcome}>
        <h2 className={styles.greeting}>
          <svg className={styles.mark} viewBox={MARK_VIEW_BOX} aria-hidden data-entrance-part="mark">
            {MARK_SEGMENTS.map((d) => (
              <path key={d.slice(0, 16)} d={d} />
            ))}
          </svg>
          <span data-entrance-part="greeting">{greeting(new Date().getHours(), name ?? '')}</span>
        </h2>
        <p className={styles.quote} data-entrance-rest>
          {dragging ? (
            <span className={styles.dropLine}>松开就打开这个文件夹</span>
          ) : (
            <>
              {QUOTE.text}
              {QUOTE.by && <span className={styles.by}>— {QUOTE.by}</span>}
            </>
          )}
        </p>

        {hasProjects ? (
          <ul className={styles.hints} aria-label="快捷键" data-entrance-rest>
            {HINTS.map(([accelerator, label]) => (
              <li key={label}>
                <kbd className={styles.key}>{formatAccelerator(accelerator)}</kbd>
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.next} data-entrance-rest>
            <button type="button" className={styles.open} onClick={() => void openProjectInteractive(kind)}>
              打开项目…<kbd className={styles.kbd}>{formatAccelerator(SHORTCUTS['open-project'])}</kbd>
            </button>
            <span className={styles.dropHint}>或把文件夹拖进窗口</span>
          </div>
        )}

        {needsAgentInstall(agents) && <InstallAgent />}
      </div>
    </div>
  )
}
