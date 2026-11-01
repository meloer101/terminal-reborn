// 14×14 status mark, the desktop's StatusGlyph v3 (src/renderer/ui/StatusGlyph.tsx, Figma 627:27332): each state has its
// own shape, not just its own colour — a turning arc, the halo dot (needs you), a check, a warning triangle, a ring, a
// dash — so status is never colour-only.
import { useEffect, useRef } from 'react'
import { Animated, Easing } from 'react-native'
import Svg, { Circle, G, Path } from 'react-native-svg'
import type { SessionStatus } from '../../../src/shared/types'
import { STATUS_LABEL } from '../../../src/shared/session-status'
import { useColors } from './theme'

function Spinner({ color }: { color: string }) {
  const turn = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [turn])
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return (
    <Animated.View style={{ width: 14, height: 14, transform: [{ rotate }] }}>
      <Svg width={14} height={14} viewBox="0 0 14 14">
        <Path d="M7 2.5A4.5 4.5 0 1 1 2.5 7" stroke={color} strokeWidth={1.75} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  )
}

export function StatusGlyph({ status }: { status: SessionStatus }) {
  const c = useColors()
  if (status === 'running') return <Spinner color={c.statusWorking} />
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none" accessibilityLabel={STATUS_LABEL[status]}>
      {status === 'needs_you' && (
        <>
          <Circle cx={7} cy={7} r={7} fill={c.statusAttentionBg} />
          <Circle cx={7} cy={7} r={4} fill={c.statusAttention} />
        </>
      )}
      {status === 'done_unread' && <Path d="M3.2 7.3 5.9 10l4.9-5.6" stroke={c.statusDone} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />}
      {status === 'error' && (
        <G stroke={c.statusError} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M7 2.1 12.3 11.4H1.7Z" />
          <Path d="M7 5.6V8" />
          <Circle cx={7} cy={9.75} r={0.7} fill={c.statusError} stroke="none" />
        </G>
      )}
      {status === 'idle' && <Circle cx={7} cy={7} r={3.25} stroke={c.statusIdle} strokeWidth={1.5} />}
      {status === 'exited' && <Path d="M4.25 7h5.5" stroke={c.textDisabled} strokeWidth={1.5} strokeLinecap="round" />}
    </Svg>
  )
}
