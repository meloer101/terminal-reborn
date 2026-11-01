// Git · 变更 (Figma 45I): what the session's worktree changed — 未提交 against HEAD, 已提交 against the branch it left —
// each file with its line counts; a file opens its diff. At the bottom the exits Git · 变更 on the Mac offers (PRD F16:
// 合并到 main 并推送 / 创建 PR / 推送到 PR #N / 打开 PR #N) and 归档 (F15); an exit's progress is a sheet (45J).
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { ChevronRight, GitPullRequest } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { GitChanges, GitFileChange } from '../../../../src/shared/git-graph/log'
import type { RemoteExit, RemoteExits } from '../../../../src/shared/remote'
import { Counts } from '../../chat/FeedItem'
import { ShipSheet } from '../../git/ShipSheet'
import { splitPath } from '../../state/model'
import { call, useApp } from '../../state/store'
import { Button, GroupHeader, Icon, NavBar, Screen } from '../../ui/atoms'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { font, useColors, type Colors } from '../../ui/theme'

type Row = { kind: 'group'; key: string; title: string; count: number } | { kind: 'file'; key: string; file: GitFileChange; scope: 'uncommitted' | 'committed' }

const statusColor = (status: GitFileChange['status'], c: Colors) => (status === 'A' ? c.diffAddFg : status === 'D' ? c.diffDelFg : c.textTertiary)

const PR_STATE: Record<string, string> = { open: '已打开', draft: '草稿', merged: '已合并', closed: '已关闭' }

/** 45I's PR line: the branch's PR, or that there is none (and whether the base is protected). */
function prLine(exits: RemoteExits): string | null {
  if (exits.pr) return `PR #${exits.pr.number} · ${PR_STATE[exits.pr.state] ?? exits.pr.state}`
  const offersPr = [exits.primary, exits.secondary].some((e) => e?.kind === 'pr')
  if (!offersPr && exits.baseProtected === null) return null
  return `还没有 PR${exits.baseProtected && exits.base ? ` · ${exits.base} 有分支保护` : ''}`
}

export default function Changes() {
  const c = useColors()
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const [data, setData] = useState<GitChanges | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exits, setExits] = useState<RemoteExits | null>(null)
  const [exitsError, setExitsError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const session = useApp((st) => st.sessions.sessions.find((x) => x.id === id))
  const ship = session?.ship
  const notice = session?.shipNotice

  const load = useCallback(() => {
    void call({ type: 'changes', session: id }).then((r) => {
      if (r.ok) {
        setData(r.data as GitChanges)
        setError(null)
      } else setError(r.error)
    })
    void call({ type: 'exits', session: id }).then((r) => {
      setExits(r.ok ? (r.data as RemoteExits) : null)
      setExitsError(r.ok ? null : r.error)
    })
  }, [id])

  useFocusEffect(load)
  // An exit that ends changes what is left to ship: read it all again.
  const running = useRef(ship !== undefined)
  useEffect(() => {
    if (running.current && !ship) load()
    running.current = ship !== undefined
  }, [ship, load])

  const go = async (exit: RemoteExit) => {
    if (exit.blocker) return Alert.alert(exit.blocker)
    if (exit.kind === 'open-pr') return exit.url ? void Linking.openURL(exit.url) : undefined
    setBusy(exit.kind)
    const result = await call({ type: 'ship', session: id, action: { do: 'start', exit: exit.kind } })
    setBusy(null)
    if (!result.ok) return Alert.alert(result.error)
    setSheet(true)
  }

  const archive = () => {
    if (exits?.archive.blocker) return Alert.alert(exits.archive.blocker)
    Alert.alert('归档这个 worktree？', '停止它的 agent，记下工作区，从列表里收起；文件夹留着，可以在 Mac 上恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '归档',
        style: 'destructive',
        onPress: async () => {
          setBusy('archive')
          const result = await call({ type: 'archive', session: id })
          setBusy(null)
          if (!result.ok) return Alert.alert(result.error)
          router.dismissTo('/')
        }
      }
    ])
  }

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

  const pr = exits ? prLine(exits) : null
  const footer = ship ? (
    <Pressable onPress={() => setSheet(true)} style={[s.shipRow, { backgroundColor: c.bgSelected }]}>
      <StatusGlyph status={ship.error ? 'error' : ship.stage === 'glance' ? 'needs_you' : 'running'} />
      <Text numberOfLines={1} style={[font(15), { flex: 1, color: c.textPrimary }]}>
        {ship.title}
      </Text>
      <Text numberOfLines={1} style={[font(13), { color: ship.error ? c.statusError : c.textSecondary }]}>
        {ship.error ? '没有完成' : ship.stage === 'glance' ? '等你看一眼' : (ship.steps.find((st) => st.state === 'working')?.label ?? '')}
      </Text>
    </Pressable>
  ) : exits ? (
    <>
      {exits.primary ? <Button primary label={exits.primary.label} busy={busy === exits.primary.kind} onPress={() => void go(exits.primary!)} style={exits.primary.blocker ? { opacity: 0.4 } : undefined} /> : null}
      <View style={s.exitRow}>
        {exits.secondary ? (
          <Button label={exits.secondary.label} busy={busy === exits.secondary.kind} onPress={() => void go(exits.secondary!)} style={[{ flex: 1 }, exits.secondary.blocker ? { opacity: 0.4 } : undefined]} />
        ) : null}
        <Button label="归档" busy={busy === 'archive'} onPress={archive} style={[exits.secondary ? undefined : { flex: 1 }, exits.archive.blocker ? { opacity: 0.4 } : undefined]} />
      </View>
    </>
  ) : exitsError ? (
    <Text style={[font(14), { color: c.textTertiary, paddingVertical: 8 }]}>{exitsError}</Text>
  ) : null

  return (
    <Screen bottom={false}>
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
          ListFooterComponent={
            pr ? (
              <View style={s.prRow}>
                <Icon icon={GitPullRequest} size={18} color={c.textTertiary} />
                <Text numberOfLines={1} style={[font(14), { flex: 1, color: c.textTertiary }]}>
                  {pr}
                </Text>
              </View>
            ) : undefined
          }
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
      {footer ? <View style={[s.exits, { paddingBottom: Math.max(insets.bottom, 8) }]}>{footer}</View> : <View style={{ height: insets.bottom }} />}
      <ShipSheet session={id} ship={ship} notice={notice} visible={sheet} onClose={() => setSheet(false)} />
    </Screen>
  )
}

const s = StyleSheet.create({
  pad: { padding: 20 },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 11 },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  exits: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  exitRow: { flexDirection: 'row', gap: 8 },
  shipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12 }
})
