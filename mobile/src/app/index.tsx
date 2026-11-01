// 会话列表 (Figma 45B): the Mac's sessions, 等你处理 first, then by project; each row has its status (shape + text),
// its current action and how long it has waited.
import { Redirect, router } from 'expo-router'
import { Plus, Smartphone } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { ActionSheetIOS, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { STATUS_LABEL } from '../../../src/shared/session-status'
import type { RemoteSession } from '../../../src/shared/remote'
import { groupSessions, rowTime, viaOf } from '../state/model'
import { call, forget, useApp } from '../state/store'
import { AgentIcon } from '../ui/AgentIcon'
import { GlassButton, GroupHeader, Icon, Screen } from '../ui/atoms'
import { StatusGlyph } from '../ui/StatusGlyph'
import { font, useColors } from '../ui/theme'
import { useNow } from '../ui/useNow'

type Row = { kind: 'group'; key: string; title: string; count: number } | { kind: 'session'; key: string; session: RemoteSession; projectName?: string }

function SessionRow({ session, projectName, now }: { session: RemoteSession; projectName?: string; now: number }) {
  const c = useColors()
  const waiting = session.status === 'needs_you'
  // Like the desktop sidebar's row (Figma 34P): project and branch, then the agent's mark; no model name.
  const meta = [projectName, session.branch].filter(Boolean).join(' · ')
  return (
    <Pressable onPress={() => router.push(`/session/${session.id}`)} style={({ pressed }) => [s.row, pressed && { backgroundColor: c.bgHover }]}>
      <View style={s.glyph}>
        <StatusGlyph status={session.status} />
      </View>
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text numberOfLines={1} style={[font(16), { flex: 1, color: c.textPrimary }]}>
            {session.title}
          </Text>
          <Text style={[font(12, 400, true), { color: waiting ? c.statusAttention : c.textTertiary }]}>{rowTime(session, now)}</Text>
        </View>
        <Text numberOfLines={1} style={[font(14), { color: waiting ? c.statusAttention : c.textSecondary }]}>
          {session.action ?? STATUS_LABEL[session.status]}
        </Text>
        <View style={s.meta}>
          <Text numberOfLines={1} style={[font(12, 400, true), { flex: 1, color: c.textTertiary }]}>
            {meta}
          </Text>
          <AgentIcon kind={session.agent} />
        </View>
      </View>
    </Pressable>
  )
}

export default function Sessions() {
  const c = useColors()
  const { pairing, link, macName, sessions } = useApp()
  const now = useNow(15_000)
  const [refreshing, setRefreshing] = useState(false)
  const rows = useMemo<Row[]>(
    () =>
      groupSessions(sessions).flatMap((g) => [
        { kind: 'group' as const, key: `g-${g.key}`, title: g.title, count: g.rows.length },
        ...g.rows.map((r) => ({ kind: 'session' as const, key: `${g.key}-${r.session.id}`, session: r.session, projectName: r.projectName }))
      ]),
    [sessions]
  )
  if (!pairing) return <Redirect href="/pair" />

  const where =
    link.kind === 'open'
      ? `${macName} · ${viaOf(link.url)}`
      : link.kind === 'connecting'
        ? `${macName} · 连接中…`
        : link.kind === 'refused'
          ? `${macName} 不认识这台手机`
          : 'Mac 上的 Wavi 没有运行'
  const unpair = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: macName, message: link.kind === 'refused' ? '这台手机在 Mac 上被撤销了，或者这个地址现在是别的电脑。取消配对后可以重新扫码。' : undefined, options: ['取消配对', '取消'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => i === 0 && void forget()
    )
  const refresh = async () => {
    setRefreshing(true)
    const result = await call({ type: 'snapshot' })
    if (result.ok) {
      const data = result.data as typeof sessions & { prompts?: [] }
      useApp.setState({ sessions: { projects: data.projects, sessions: data.sessions }, ...(data.prompts ? { prompts: data.prompts } : {}) })
    }
    setRefreshing(false)
  }

  return (
    <Screen bottom={false}>
      <View style={s.top}>
        <Pressable accessibilityRole="button" onPress={unpair} style={s.mac}>
          <Icon icon={Smartphone} color={c.textTertiary} />
          <Text numberOfLines={1} style={[font(13), { color: link.kind === 'refused' ? c.statusError : c.textTertiary, flexShrink: 1 }]}>
            {where}
          </Text>
        </Pressable>
        <GlassButton label="新建会话" disabled={link.kind !== 'open'} onPress={() => router.push('/new')}>
          <Icon icon={Plus} size={22} color={c.textPrimary} />
        </GlassButton>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.textTertiary} />}
        ListHeaderComponent={<Text style={[font(30, 500), s.title, { color: c.textPrimary }]}>会话</Text>}
        ListEmptyComponent={link.kind === 'open' ? <Text style={[font(15), s.empty, { color: c.textTertiary }]}>Mac 上还没有会话</Text> : undefined}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (item.kind === 'group' ? <GroupHeader title={item.title} count={item.count} /> : <SessionRow session={item.session} projectName={item.projectName} now={now} />)}
      />
    </Screen>
  )
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 16, paddingTop: 8, paddingBottom: 4 },
  mac: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  title: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  empty: { paddingHorizontal: 20, paddingTop: 24 },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  glyph: { paddingTop: 3 },
  rowBody: { flex: 1, gap: 3, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 }
})
