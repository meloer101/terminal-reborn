// One item of the conversation (Figma 45C): the user's bubble, the agent's Markdown, thinking (folded), one row per tool
// call (tap for 45D), system lines and the 未识别的条目 that keeps an unknown line from breaking the rest.
import { router } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { memo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SessionStatus } from '../../../src/shared/types'
import type { ChatItem, ToolState } from '../../../src/shared/transcript-chat'
import { lastLine } from '../state/model'
import { Icon } from '../ui/atoms'
import { MiniDiff } from '../ui/DiffView'
import { Markdown } from '../ui/Markdown'
import { StatusGlyph } from '../ui/StatusGlyph'
import { font, useColors } from '../ui/theme'

const TOOL_GLYPH: Record<ToolState, SessionStatus> = { running: 'running', ok: 'done_unread', error: 'error' }
const MINI_DIFF_LINES = 6

/** A few lines of an Edit's first hunk, from one line before its first change (a hunk opens with 3 of context). */
function miniLines(lines: string[]): string[] {
  const first = lines.findIndex((l) => l.startsWith('+') || l.startsWith('-'))
  const from = Math.max(0, first - 1)
  return lines.slice(from, from + MINI_DIFF_LINES)
}

export function Counts({ added, removed, size = 13 }: { added?: number; removed?: number; size?: number }) {
  const c = useColors()
  return (
    <View style={s.counts}>
      {added ? <Text style={[font(size, 400, true), { color: c.diffAddFg }]}>+{added}</Text> : null}
      {removed ? <Text style={[font(size, 400, true), { color: c.diffDelFg }]}>−{removed}</Text> : null}
    </View>
  )
}

function Thinking({ item }: { item: Extract<ChatItem, { kind: 'thinking' }> }) {
  const c = useColors()
  const [open, setOpen] = useState(false)
  const seconds = item.ms ? ` ${Math.max(1, Math.round(item.ms / 1000))}s` : ''
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={s.thinking}>
      <View style={s.row6}>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon icon={ChevronRight} size={14} color={c.textTertiary} />
        </View>
        <Text style={[font(14), { color: c.textTertiary }]}>思考{seconds}</Text>
      </View>
      {open && item.text ? <Text style={[font(14, 400, false, 20), { color: c.textTertiary, paddingLeft: 20 }]}>{item.text}</Text> : null}
    </Pressable>
  )
}

function Tool({ item, session }: { item: Extract<ChatItem, { kind: 'tool' }>; session: string }) {
  const c = useColors()
  const edit = item.diff && item.name !== 'Write' ? miniLines(item.diff.hunks[0]?.lines ?? []) : undefined
  const tail = !item.diff ? lastLine(item.output) : null
  return (
    <Pressable onPress={() => router.push({ pathname: '/tool', params: { session, item: item.id } })} style={({ pressed }) => [s.tool, pressed && { opacity: 0.6 }]}>
      <View style={s.row10}>
        <StatusGlyph status={TOOL_GLYPH[item.state]} />
        <Text style={[font(13, 500, true), { color: c.textPrimary }]}>{item.name}</Text>
        <Text numberOfLines={1} style={[font(13, 400, true), { flex: 1, color: c.textSecondary }]}>
          {item.arg}
        </Text>
        {item.diff ? <Counts added={item.diff.added} removed={item.diff.removed} /> : null}
        <Icon icon={ChevronRight} size={14} color={c.textTertiary} />
      </View>
      {tail ? (
        <Text numberOfLines={1} style={[font(12, 400, true), { color: item.state === 'error' ? c.statusError : c.textTertiary, paddingLeft: 24 }]}>
          {tail}
        </Text>
      ) : null}
      {edit?.length ? <MiniDiff lines={edit} /> : null}
    </Pressable>
  )
}

export const FeedItem = memo(function FeedItem({ item, session }: { item: ChatItem; session: string }) {
  const c = useColors()
  switch (item.kind) {
    case 'user':
      return (
        <View style={s.user}>
          <View style={[s.bubble, { backgroundColor: c.bgSelected }]}>
            {item.text ? <Text style={[font(16, 400, false, 23), { color: c.textPrimary }]}>{item.text}</Text> : null}
            {item.images ? <Text style={[font(13), { color: c.textTertiary }]}>{item.images} 张图片</Text> : null}
          </View>
        </View>
      )
    case 'text':
      return <Markdown text={item.text} />
    case 'thinking':
      return <Thinking item={item} />
    case 'tool':
      return <Tool item={item} session={session} />
    case 'system':
      return <Text style={[font(13, 400, false, 18), { color: c.textTertiary }]}>{item.text}</Text>
    case 'unknown':
      return <Text style={[font(13), { color: c.textTertiary }]}>未识别的条目</Text>
  }
})

const s = StyleSheet.create({
  counts: { flexDirection: 'row', gap: 4 },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row10: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thinking: { gap: 6 },
  tool: { gap: 6 },
  user: { flexDirection: 'row', justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 4 }
})
