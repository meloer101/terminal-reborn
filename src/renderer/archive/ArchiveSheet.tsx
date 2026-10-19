// 归档 (PRD F15, Figma 16D 249:9117 / 249:9144): what archiving does, as a checklist — stop the sessions, run the
// repository's `archive`, keep the worktree (uncommitted changes included) locally and fold it out of the sidebar,
// restore from ⌘K 历史. Refused while a session is running. While it works the current step spins; a failing archive
// script shows its output and offers 仍然归档.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, X } from 'lucide-react'
import { useRepoScripts } from '../scripts/run-script'
import { useWorkspace } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import { archiveWorktree, blockerFor, type ArchiveStep, type ArchiveTarget } from './actions'
import { closeArchiveSheet, useArchiveSheet } from './store'
import styles from './ArchiveSheet.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

export function ArchiveSheet() {
  const target = useArchiveSheet((s) => s.target)
  const generation = useArchiveSheet((s) => s.generation)
  return target ? <Sheet key={generation} target={target} /> : null
}

type Phase =
  | { kind: 'ready' }
  | { kind: 'working'; step: ArchiveStep }
  | { kind: 'script-failed'; message: string; output: string }
  | { kind: 'failed'; message: string }

const STEP_ORDER: ArchiveStep[] = ['stopping', 'script', 'snapshot']

function Sheet({ target }: { target: ArchiveTarget }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' })
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Re-read whenever sessions change: one that starts running blocks the archive, one that stops frees it.
  useWorkspace((s) => s.sessions)
  const blocker = blockerFor(target)
  const repo = useRepoScripts(target.worktreePath)
  const script = repo?.scripts.archive

  useEffect(() => sheetRef.current?.focus(), [])

  const busy = phase.kind === 'working'
  const run = async (ignoreScriptFailure: boolean): Promise<void> => {
    setPhase({ kind: 'working', step: 'stopping' })
    try {
      const outcome = await archiveWorktree(target, { ignoreScriptFailure, onStep: (step) => setPhase({ kind: 'working', step }) })
      if (outcome.ok) closeArchiveSheet(true)
      else if (outcome.stage === 'script') setPhase({ kind: 'script-failed', message: outcome.message, output: outcome.output })
      else setPhase({ kind: 'failed', message: outcome.message })
    } catch (error) {
      setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const primary = (): void => {
    if (busy || blocker) return
    void run(phase.kind === 'script-failed')
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      closeArchiveSheet(true)
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      primary()
    }
  }

  const onScrimMouseDown = (event: MouseEvent): void => {
    if (event.target === event.currentTarget && !busy) closeArchiveSheet(true)
  }

  const stepState = (step: ArchiveStep): 'pending' | 'working' | 'done' => {
    if (phase.kind !== 'working') return 'pending'
    const at = STEP_ORDER.indexOf(phase.step)
    const mine = STEP_ORDER.indexOf(step)
    return mine < at ? 'done' : mine === at ? 'working' : 'pending'
  }

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown} data-region="archive">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="archive-sheet"
      >
        <header className={styles.context}>
          <h2 id={titleId} className={styles.title}>
            归档
          </h2>
          <p className={styles.branch}>{target.branch}</p>
        </header>

        <div className={styles.checks} aria-live="polite">
          {blocker ? (
            <Line tone="error" text={blocker} />
          ) : (
            <>
              <Line state={stepState('stopping')} text="停止这里的会话" />
              {script !== undefined && <Line state={stepState('script')} text={`运行 archive：${script.replace(/\s+/g, ' ').trim()}`} />}
              <Line state={stepState('snapshot')} text="工作区（含未提交的改动）记在本地，侧栏里先收起来" />
              <Line text="之后可以在跳转（⌘K）的历史里恢复" />
              {phase.kind === 'script-failed' && (
                <>
                  <Line tone="error" text={`${phase.message}，还没归档`} />
                  {phase.output && <pre className={styles.output}>{phase.output}</pre>}
                </>
              )}
              {phase.kind === 'failed' && <Line tone="error" text={phase.message} />}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <span className={styles.spacer} />
          <button type="button" className={styles.cancel} disabled={busy} onClick={() => closeArchiveSheet(true)}>
            取消
          </button>
          <button type="button" className={styles.primary} disabled={busy || blocker !== null} onClick={primary}>
            {busy ? '正在归档…' : phase.kind === 'script-failed' ? '仍然归档' : '归档'}
            <span className={styles.shortcut}>⌘↵</span>
          </button>
        </footer>
      </div>
    </div>
  )
}

function Line({ text, state = 'pending', tone }: { text: string; state?: 'pending' | 'working' | 'done'; tone?: 'error' }) {
  const shownTone = tone ?? (state === 'working' ? 'working' : 'ok')
  return (
    <p className={styles.line} data-tone={shownTone} data-state={state}>
      <span className={styles.lineIcon} aria-hidden={state === 'working'}>
        {tone === 'error' ? <X {...ICON} /> : state === 'working' ? <StatusGlyph status="running" /> : <Check {...ICON} />}
      </span>
      <span className={styles.lineText}>{text}</span>
    </p>
  )
}
