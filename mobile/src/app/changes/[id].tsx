// Git · 变更 (Figma 45I): what the session's worktree changed — 未提交 against HEAD, 已提交 against the branch it left —
// each file with its line counts; a file opens its diff. The exits (提交 / 推送 / PR / 合并 / 归档) are not on the phone yet.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import type { GitChanges, GitFileChange } from '../../../../src/shared/git-graph/log'
import { Counts } from '../../chat/FeedItem'
import { splitPath } from '../../state/model'
import { call } from '../../state/store'
import { GroupHeader, Icon, NavBar, Screen } from '../../ui/atoms'
import { font, useColors, type Colors } from '../../ui/theme'

type Row = { kind: 'group'; key: string; title: string; count: number } | { kind: 'file'; key: string; file: GitFileChange; scope: 'uncommitted' | 'committed' }

const statusColor = (status: GitFileChange['status'], c: Colors) => (status === 'A' ? c.diffAddFg : status === 'D' ? c.diffDelFg : c.textTertiary)

export default function Changes() {
  const c = useColors()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [data, setData] = useState<GitChanges | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      void call({ type: 'changes', session: id }).then((r) => {
        if (r.ok) {
          setData(r.data as GitChanges)
          setError(null)
        } else setError(r.error)
      })
    }, [id])
  )

  const all = data ? [...data.uncommitted, ...data.committed] : []
  const added = all.reduce((n, f) => n + (f.added ?? 0), 0)
  const removed = all.reduce((n, f) => n + (f.removed ?? 0), 0)
  const rows: Row[] = data
    ? [
        ...(data.uncommitted.length ? [{ kind: 'group' as const, key: 'g-u', title: '未提交', count: data.uncommitted.length }] : []),
        ...data.uncommitted.map((file) => ({ kind: 'file' as const, key: `u-${file.path}`, file, scope: 'uncommitted' as const })),
        ...(data.committed.length ? [{ kind: 'group' as const, key: 'g-c', title: `已提交 · ${data.ahead} 个提交`, count: data.committed.length }] : []),
        ...data.committed.map((file) => ({ kind: 'file' as const, key: `c-${file.path}`, file, scope: 'committed' as const }))
      ]
    : []
  const sub = data
    ? [data.branch && data.base ? `${data.branch} → ${data.base}` : data.branch, data.ahead ? `领先 ${data.ahead}` : null, data.behind ? `落后 ${data.behind}` : null].filter(Boolean).join(' · ')
    : ''

  return (
    <Screen>
      <NavBar
        title="变更"
        subtitle={
          sub ? (
            <Text numberOfLines={1} style={[font(12, 400, true), { color: c.textTertiary }]}>
              {sub}
            </Text>
          ) : null
        }
      />
      {!data ? (
        error ? (
          <Text style={[font(15), s.pad, { color: c.textTertiary }]}>{error}</Text>
        ) : (
          <ActivityIndicator style={s.pad} color={c.textTertiary} />
        )
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          ListHeaderComponent={
            <View style={s.summary}>
              <Text style={[font(20, 400, true), { color: c.diffAddFg }]}>+{added}</Text>
              <Text style={[font(20, 400, true), { color: c.diffDelFg }]}>−{removed}</Text>
              <Text style={[font(15), { color: c.textSecondary }]}>{all.length} 个文件</Text>
            </View>
          }
          ListEmptyComponent={<Text style={[font(15), s.pad, { color: c.textTertiary }]}>没有改动</Text>}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => {
            if (item.kind === 'group') return <GroupHeader title={item.title} count={item.count} />
            const { name, dir } = splitPath(item.file.path)
            const openable = !item.file.nested && !item.file.tooLarge
            return (
              <Pressable
                disabled={!openable}
                onPress={() =>
                  router.push({
                    pathname: '/diff',
                    params: { session: id, path: item.file.path, scope: item.scope, ...(item.file.oldPath ? { oldPath: item.file.oldPath } : {}), ...(item.file.untracked ? { untracked: '1' } : {}) }
                  })
                }
                style={({ pressed }) => [s.file, pressed && { backgroundColor: c.bgHover }]}
              >
                <Text style={[font(12, 500, true), { color: statusColor(item.file.untracked ? 'A' : item.file.status, c), width: 10 }]}>{item.file.untracked ? 'A' : item.file.status}</Text>
                <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[font(15, 400, true), { color: c.textPrimary }]}>
                    {name}
                  </Text>
                  {dir ? (
                    <Text numberOfLines={1} style={[font(12, 400, true), { color: c.textTertiary }]}>
                      {dir}
                    </Text>
                  ) : null}
                </View>
                <Counts added={item.file.added ?? undefined} removed={item.file.removed ?? undefined} />
                {openable ? <Icon icon={ChevronRight} size={14} color={c.textTertiary} /> : null}
              </Pressable>
            )
          }}
        />
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  pad: { padding: 20 },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 11 }
})
