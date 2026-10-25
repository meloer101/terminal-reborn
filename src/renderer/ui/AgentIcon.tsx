import { SquareTerminal } from 'lucide-react'
import { agentName } from '@shared/agents'
import type { AgentKind } from '@shared/types'
import { AGENT_ICON_SVG } from './agent-icon-svg'
import styles from './AgentIcon.module.css'

interface Props {
  kind: AgentKind
  /** Square edge in px. */
  size?: number
}

/**
 * The mark of the agent that runs in a session (Figma 27D): the CLI's own logo, the terminal glyph for a plain shell,
 * a letter for the few CLIs that have no logo to bundle. Decorative: the name sits in the row's tooltip.
 */
export function AgentIcon({ kind, size = 14 }: Props) {
  const label = agentName(kind)
  if (kind === 'shell') return <SquareTerminal className={styles.shell} size={size} strokeWidth={1.75} aria-hidden />
  const svg = AGENT_ICON_SVG[kind]
  if (svg === undefined) {
    return (
      <span className={styles.letter} style={{ width: size, height: size, fontSize: Math.round(size * 0.68) }} aria-hidden>
        {label.slice(0, 1)}
      </span>
    )
  }
  // The markup is bundled from the MIT icon pack (agent-icon-svg.ts), never user input.
  return <span className={styles.mark} style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
}
