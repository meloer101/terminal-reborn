// One choice out of a list, in a sheet (新建会话's 项目 / 基于 / 智能体): the current one is checked.
import { Check } from 'lucide-react-native'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon, Sheet } from './atoms'
import { font, useColors } from './theme'

export interface PickerOption {
  value: string
  label: string
  /** A section title above this option (local / remote branches). */
  section?: string
  mono?: boolean
}

export function Picker({ title, options, value, visible, onPick, onClose }: { title: string; options: PickerOption[]; value: string | null; visible: boolean; onPick: (value: string) => void; onClose: () => void }) {
  const c = useColors()
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[font(17, 500), s.title, { color: c.textPrimary }]}>{title}</Text>
      <FlatList
        style={{ maxHeight: 460 }}
        data={options}
        keyExtractor={(o) => o.value}
        renderItem={({ item }) => (
          <View>
            {item.section ? <Text style={[font(13, 500), s.section, { color: c.textSecondary }]}>{item.section}</Text> : null}
            <Pressable
              onPress={() => {
                onPick(item.value)
                onClose()
              }}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: c.bgHover }]}
            >
              <Text numberOfLines={1} style={[font(item.mono ? 14 : 16, 400, item.mono), { flex: 1, color: c.textPrimary }]}>
                {item.label}
              </Text>
              {item.value === value ? <Icon icon={Check} size={18} color={c.textPrimary} /> : null}
            </Pressable>
          </View>
        )}
      />
    </Sheet>
  )
}

const s = StyleSheet.create({
  title: { textAlign: 'center' },
  section: { paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }
})
