// 工具详情 (Figma 45D): an Edit / Write as its full numbered diff; any other tool call as its input and output.
import { useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Counts } from '../chat/FeedItem'
import { hunkRows, splitPath } from '../state/model'
import { useApp } from '../state/store'
import { NavBar, Screen } from '../ui/atoms'
import { DiffView } from '../ui/DiffView'
import { font, useColors } from '../ui/theme'

export default function ToolDetail() {
  const c = useColors()
  const { session, item: itemId } = useLocalSearchParams<{ session: string; item: string }>()
  const item = useApp((st) => (st.watching === session ? st.feed?.items.find((i) => i.id === itemId) : undefined))
  if (!item || item.kind !== 'tool') {
    return (
      <Screen>
        <NavBar title="工具" />
      </Screen>
    )
  }
  if (item.diff) {
    const { name, dir } = splitPath(item.diff.path)
    const sub = [dir, item.name, `${item.diff.hunks.length} 处`].filter(Boolean).join(' · ')
    return (
      <Screen bottom={false}>
        <NavBar
          title={name}
          subtitle={<Text numberOfLines={1} style={[font(12, 400, true), { color: c.textTertiary }]}>{sub}</Text>}
          right={<View style={{ paddingRight: 8 }}><Counts added={item.diff.added} removed={item.diff.removed} /></View>}
        />
        <DiffView rows={hunkRows(item.diff.hunks)} />
        {item.diff.truncated ? <Text style={[font(13), s.note, { color: c.textTertiary, backgroundColor: c.bgInset }]}>只显示了前 400 行</Text> : null}
      </Screen>
    )
  }
  return (
    <Screen>
      <NavBar title={item.name} subtitle={<Text numberOfLines={1} style={[font(12, 400, true), { color: c.textTertiary }]}>{item.state === 'running' ? '运行中' : item.state === 'error' ? '出错' : '完成'}</Text>} />
      <ScrollView contentContainerStyle={s.body}>
        <View style={[s.block, { backgroundColor: c.bgInset }]}>
          <Text selectable style={[font(13, 400, true, 20), { color: c.textPrimary }]}>{item.arg}</Text>
        </View>
        {item.output ? (
          <View style={[s.block, { backgroundColor: c.bgInset }]}>
            <Text selectable style={[font(12, 400, true, 18), { color: item.state === 'error' ? c.statusError : c.termFg }]}>{item.output}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { padding: 20, gap: 12 },
  block: { borderRadius: 10, padding: 14 },
  note: { padding: 12, textAlign: 'center' }
})
