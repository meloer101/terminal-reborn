// Diffs as Figma 45 draws them: the full numbered view of 45D (old / new gutters, sign, code; hunk rows) and the
// few-line MiniDiff under an Edit row in the conversation (45C).
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { DiffRow } from '../state/model'
import { font, useColors } from './theme'

const ROW = 20

export function DiffView({ rows }: { rows: DiffRow[] }) {
  const c = useColors()
  const code = font(12, 400, true, ROW)
  return (
    <ScrollView horizontal style={{ flex: 1, backgroundColor: c.bgInset }} contentContainerStyle={{ minWidth: '100%' }}>
      <FlatList
        data={rows}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
        initialNumToRender={60}
        renderItem={({ item }) => {
          if (item.kind === 'hunk')
            return (
              <View style={[s.row, { backgroundColor: c.bgHover }]}>
                <Text style={[code, s.gutters, { color: c.textTertiary }]}> </Text>
                <Text style={[code, { color: c.textTertiary }]}>{item.text}</Text>
              </View>
            )
          const add = item.sign === '+'
          const del = item.sign === '-'
          return (
            <View style={[s.row, add && { backgroundColor: c.diffAddBg }, del && { backgroundColor: c.diffDelBg }]}>
              <Text style={[code, s.num, { color: c.textTertiary }]}>{item.old ?? ''}</Text>
              <Text style={[code, s.num, { color: c.textTertiary }]}>{item.new ?? ''}</Text>
              <Text style={[code, s.sign, { color: add ? c.diffAddFg : del ? c.diffDelFg : c.textTertiary }]}>{add ? '+' : del ? '−' : ' '}</Text>
              <Text style={[code, { color: c.termFg, paddingRight: 16 }]}>{item.code}</Text>
            </View>
          )
        }}
      />
    </ScrollView>
  )
}

/** The first lines of an Edit, under its row. */
export function MiniDiff({ lines }: { lines: string[] }) {
  const c = useColors()
  return (
    <View style={[s.mini, { backgroundColor: c.bgInset }]}>
      {lines.map((line, i) => {
        const sign = line[0] === '+' || line[0] === '-' ? line[0] : ' '
        return (
          <View key={i} style={[s.miniRow, sign === '+' && { backgroundColor: c.diffAddBg }, sign === '-' && { backgroundColor: c.diffDelBg }]}>
            <Text style={[font(12, 400, true), { color: sign === '+' ? c.diffAddFg : sign === '-' ? c.diffDelFg : c.textTertiary }]}>{sign === '-' ? '−' : sign}</Text>
            <Text numberOfLines={1} style={[font(12, 400, true), { flex: 1, color: sign === ' ' ? c.textSecondary : c.textPrimary }]}>
              {line.slice(1)}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', height: ROW, alignItems: 'center' },
  gutters: { width: 92 },
  num: { width: 36, textAlign: 'right' },
  sign: { width: 20, textAlign: 'center' },
  mini: { borderRadius: 8, paddingVertical: 6, overflow: 'hidden' },
  miniRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 2 }
})
