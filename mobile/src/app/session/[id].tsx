// 会话页 · 聊天视图 (Figma 45C): the session's conversation from its transcript, newest at the bottom; what the agent
// is doing right now (its text reaches the transcript only once a block is written, PRD §6.16); the composer; and the
// sheet for what it waits for. The branch button opens Git · 变更.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { GitBranch } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native'
import type { GitChanges } from '../../../../src/shared/git-graph/log'
import { Composer } from '../../chat/Composer'
import { FeedItem } from '../../chat/FeedItem'
import { PromptSheet } from '../../chat/PromptSheet'
import { shortAge } from '../../state/model'
import { call, loadOlder, useApp, watch } from '../../state/store'
import { Icon, NavBar, Screen } from '../../ui/atoms'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { font, useColors } from '../../ui/theme'
import { useNow } from '../../ui/useNow'

function Live({ action, since }: { action: string; since?: number }) {
  const c = useColors()
  const now = useNow(1000)
  return (
    <View style={s.live}>
      <StatusGlyph status="running" />
      <Text numberOfLines={1} style={[font(14), { flexShrink: 1, color: c.textSecondary }]}>
        {action}
      </Text>
      {since ? <Text style={[font(13, 400, true), { color: c.textTertiary }]}>{shortAge(now - since)}</Text> : null}
    </View>
  )
}

export default function SessionScreen() {
  const c = useColors()
  const { id } = useLocalSearchParams<{ id: string }>()
  const session = useApp((st) => st.sessions.sessions.find((x) => x.id === id))
  const feed = useApp((st) => (st.watching === id ? st.feed : null))
  const allPrompts = useApp((st) => st.prompts)
  const linkOpen = useApp((st) => st.link.kind === 'open')
  const prompts = useMemo(() => allPrompts.filter((p) => p.sessionId === id).sort((a, b) => a.createdAt - b.createdAt), [allPrompts, id])
  const [changed, setChanged] = useState<number | null>(null)

  useEffect(() => {
    void watch(id)
    return () => void watch(null)
  }, [id])

  useFocusEffect(
    useCallback(() => {
      if (!linkOpen) return
      void call({ type: 'changes', session: id }).then((r) => {
        const data = r.ok ? (r.data as GitChanges) : null
        setChanged(data ? data.uncommitted.length + data.committed.length : null)
      })
    }, [id, linkOpen])
  )

  const items = useMemo(() => (feed ? [...feed.items].reverse() : []), [feed])
  const running = session?.status === 'running'
  const subtitle = [session?.branch, session?.model].filter(Boolean).join(' · ')

  return (
    <Screen bottom={false}>
      <NavBar
        title={session?.title ?? '会话'}
        subtitle={
          session ? (
            <View style={s.sub}>
              <StatusGlyph status={session.status} />
              {subtitle ? (
                <Text numberOfLines={1} style={[font(12, 400, true), { color: c.textTertiary, flexShrink: 1 }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null
        }
        right={
          changed !== null ? (
            <Pressable accessibilityLabel="变更" onPress={() => router.push(`/changes/${id}`)} style={[s.changes, { backgroundColor: c.bgSelected }]}>
              <Icon icon={GitBranch} color={c.textSecondary} />
              <Text style={[font(13, 400, true), { color: c.textSecondary }]}>{changed}</Text>
            </Pressable>
          ) : null
        }
      />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {!session ? (
          <Text style={[font(15), s.gone, { color: c.textTertiary }]}>{linkOpen ? '这个会话已经不在 Mac 上了' : 'Mac 上的 Wavi 没有运行'}</Text>
        ) : (
          <FlatList
            inverted
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <FeedItem item={item} session={id} />}
            contentContainerStyle={s.feed}
            ListHeaderComponent={running && session.action ? <Live action={session.action} since={session.since} /> : undefined}
            ListFooterComponent={feed?.loading ? <ActivityIndicator style={{ paddingVertical: 12 }} color={c.textTertiary} /> : undefined}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.5}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          />
        )}
        <PromptSheet prompts={prompts} />
        {session ? <Composer session={id} running={running} /> : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}

const s = StyleSheet.create({
  sub: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  changes: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  feed: { paddingHorizontal: 20, paddingVertical: 12, gap: 16 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gone: { padding: 20 }
})
