// One file of Git · 变更, drawn like 45D: `git diff` as numbered rows.
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'
import { splitPath, unifiedRows, type DiffRow } from '../state/model'
import { call } from '../state/store'
import { NavBar, Screen } from '../ui/atoms'
import { DiffView } from '../ui/DiffView'
import { font, useColors } from '../ui/theme'

export default function FileDiff() {
  const c = useColors()
  const p = useLocalSearchParams<{ session: string; path: string; scope: 'uncommitted' | 'committed'; oldPath?: string; untracked?: string }>()
  const [rows, setRows] = useState<DiffRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void call({ type: 'diff', session: p.session, path: p.path, scope: p.scope, ...(p.oldPath ? { oldPath: p.oldPath } : {}), ...(p.untracked ? { untracked: true } : {}) }).then((r) => {
      if (r.ok) setRows(unifiedRows(String((r.data as { text?: unknown }).text ?? '')))
      else setError(r.error)
    })
  }, [p.session, p.path, p.scope, p.oldPath, p.untracked])
  const { name, dir } = splitPath(p.path)
  return (
    <Screen bottom={false}>
      <NavBar title={name} subtitle={<Text numberOfLines={1} style={[font(12, 400, true), { color: c.textTertiary }]}>{[dir, p.scope === 'committed' ? '已提交' : '未提交'].filter(Boolean).join(' · ')}</Text>} />
      {rows ? (
        rows.length ? <DiffView rows={rows} /> : <Text style={[font(15), s.pad, { color: c.textTertiary }]}>没有可显示的文本改动</Text>
      ) : error ? (
        <Text style={[font(15), s.pad, { color: c.textTertiary }]}>{error}</Text>
      ) : (
        <ActivityIndicator style={s.pad} color={c.textTertiary} />
      )}
    </Screen>
  )
}

const s = StyleSheet.create({ pad: { padding: 20 } })
