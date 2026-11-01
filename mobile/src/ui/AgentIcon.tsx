// The mark of the agent in a session, as the desktop's AgentIcon draws it (src/renderer/ui/AgentIcon.tsx, Figma 34K):
// the CLI's own one-colour logo in the text colour (never a brand colour or a grey), the terminal glyph for a shell, the
// first letter for the few CLIs with no logo.
import { SquareTerminal } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { AGENT_ICON_SVG } from '../../../src/shared/agent-icon-svg'
import { agentName } from '../../../src/shared/agents'
import type { AgentKind } from '../../../src/shared/types'
import { useColors } from './theme'

export function AgentIcon({ kind, size = 13 }: { kind: AgentKind; size?: number }) {
  const c = useColors()
  if (kind === 'shell') return <SquareTerminal size={size} color={c.textPrimary} strokeWidth={1.75} />
  const svg = AGENT_ICON_SVG[kind]
  if (svg === undefined) {
    return (
      <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: c.bgHover, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: Math.round(size * 0.68), fontWeight: '600', color: c.textPrimary }}>{agentName(kind).slice(0, 1)}</Text>
      </View>
    )
  }
  return <SvgXml xml={svg} width={size} height={size} color={c.textPrimary} />
}
