// 出口进度 (Figma 45J): an exit of Git · 变更 running on the Mac (PRD F16 v1.78) — the agent writes the text, the phone
// gets a last look and may edit it, then Wavi commits, merges, pushes or opens the PR; steps ◌ working / ✓ / ○ / ✗.
// 在后台继续 closes the sheet; the run goes on on the Mac.
import { Square, SquareCheck } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { RemoteShip, RemoteShipAction, RemoteStepState } from '../../../src/shared/remote'
import type { SessionStatus } from '../../../src/shared/types'
import { call } from '../state/store'
import { Button, Icon, Sheet } from '../ui/atoms'
import { StatusGlyph } from '../ui/StatusGlyph'
import { font, MONO, useColors } from '../ui/theme'

const STEP_GLYPH: Record<RemoteStepState, SessionStatus> = { working: 'running', done: 'done_unread', pending: 'idle', failed: 'error' }
/** Edits reach the Mac this long after the last keystroke (and at once before going ahead). */
const EDIT_MS = 400

type Texts = RemoteShip['texts']

export function ShipSheet({ session, ship, notice, visible, onClose }: { session: string; ship: RemoteShip | undefined; notice: string | undefined; visible: boolean; onClose: () => void }) {
  const c = useColors()
  const [texts, setTexts] = useState<Texts | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<Partial<Texts>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editable = ship !== undefined && (ship.stage === 'glance' || ship.error !== null) && ship.fields.length > 0

  // The fields start from what the agent wrote each time the run reaches a new stage (or fails); while they can be edited,
  // later pushes (the echo of what is being typed) do not overwrite them.
  const seededFor = useRef('')
  useEffect(() => {
    if (!ship) {
      seededFor.current = ''
      return setTexts(null)
    }
    const key = `${ship.stage}:${ship.error?.step ?? ''}`
    if (!editable || seededFor.current !== key) {
      seededFor.current = key
      setTexts(ship.texts)
    }
  }, [ship, editable])

  const flush = async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const edit = pending.current
    pending.current = {}
    if (Object.keys(edit).length === 0) return true
    const result = await call({ type: 'ship', session, action: { do: 'edit', texts: edit } })
    if (!result.ok) setError(result.error)
    return result.ok
  }

  const edit = (patch: Partial<Texts>) => {
    setTexts((t) => (t ? { ...t, ...patch } : t))
    pending.current = { ...pending.current, ...patch }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), EDIT_MS)
  }

  const act = async (action: RemoteShipAction, label: string) => {
    setBusy(label)
    setError(null)
    // Cancelling drops the text anyway; anything else goes with the latest edit.
    if (action.do !== 'cancel' && !(await flush())) return setBusy(null)
    const result = await call({ type: 'ship', session, action })
    setBusy(null)
    if (!result.ok) return setError(result.error)
    if (action.do === 'cancel') onClose()
  }

  const close = () => {
    void flush()
    onClose()
  }

  // The Mac decides with the latest text (what the phone last heard may be a keystroke behind).
  const submit = () => void act({ do: 'submit' }, 'submit')

  const field = (key: 'commit' | 'title' | 'body', label: string) =>
    texts ? (
      <View key={key} style={{ gap: 6 }}>
        {ship && ship.fields.length > 1 ? <Text style={[font(13, 500), { color: c.textSecondary }]}>{label}</Text> : null}
        <TextInput
          value={texts[key]}
          editable={editable}
          onChangeText={(value) => edit({ [key]: value })}
          multiline={key !== 'title'}
          autoCapitalize="none"
          autoCorrect={false}
          style={[s.box, key === 'title' ? font(14, 400, true) : font(key === 'body' ? 13 : 14, 400, true, key === 'body' ? 19 : 20), { color: c.textPrimary, backgroundColor: c.bgInset, fontFamily: MONO }]}
        />
      </View>
    ) : null

  const showTexts = ship && texts && (editable || ship.stage === 'running') && ship.fields.some((f) => f !== 'draft' && texts[f].trim() !== '')

  return (
    <Sheet visible={visible} onClose={close}>
      {ship ? (
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={[font(20, 500), { color: c.textPrimary }]}>{ship.title}</Text>
          {showTexts ? (
            <>
              {ship.fields.includes('commit') ? field('commit', '提交说明') : null}
              {ship.fields.includes('title') ? field('title', '标题') : null}
              {ship.fields.includes('body') ? field('body', '正文') : null}
              {ship.fields.includes('draft') && editable ? (
                <Pressable onPress={() => edit({ draft: !texts!.draft })} style={s.draft}>
                  <Icon icon={texts!.draft ? SquareCheck : Square} size={20} color={c.textPrimary} />
                  <Text style={[font(15), { color: c.textPrimary }]}>草稿</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          <View style={s.steps}>
            {ship.steps.map((step) => (
              <View key={step.id} style={{ gap: 6 }}>
                <View style={s.step}>
                  <StatusGlyph status={STEP_GLYPH[step.state]} />
                  <Text numberOfLines={1} style={[font(15), { flex: 1, color: step.state === 'pending' ? c.textTertiary : c.textPrimary }]}>
                    {step.label}
                  </Text>
                  {step.note ? (
                    <Text numberOfLines={1} style={[font(12, 400, true), { color: c.textTertiary, maxWidth: '45%' }]}>
                      {step.note}
                    </Text>
                  ) : null}
                </View>
                {ship.error?.step === step.id ? (
                  <View style={{ gap: 6, paddingLeft: 24 }}>
                    <Text style={[font(14, 400, false, 20), { color: c.statusError }]}>{ship.error.message}</Text>
                    {ship.error.output ? (
                      <Text numberOfLines={8} style={[font(12, 400, true, 17), s.output, { color: c.textTertiary, backgroundColor: c.bgInset }]}>
                        {ship.error.output}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
          {error ? <Text style={[font(14), { color: c.statusError }]}>{error}</Text> : null}
          {ship.error ? (
            <View style={{ gap: 8 }}>
              <Button primary label="重试" busy={busy === 'retry'} onPress={() => void act({ do: 'retry' }, 'retry')} />
              {ship.error.conflicts ? <Button label={`交给 ${ship.agent} 解`} busy={busy === 'conflicts'} onPress={() => void act({ do: 'conflicts' }, 'conflicts')} /> : null}
              {ship.error.pushRefused ? <Button label="改为创建 PR" busy={busy === 'switch'} onPress={() => void act({ do: 'switch-pr' }, 'switch')} /> : null}
              <Button label="取消" busy={busy === 'cancel'} onPress={() => void act({ do: 'cancel' }, 'cancel')} />
            </View>
          ) : ship.stage === 'glance' ? (
            <View style={s.row}>
              <Button label="取消" busy={busy === 'cancel'} onPress={() => void act({ do: 'cancel' }, 'cancel')} style={{ flex: 1 }} />
              <Button primary label={ship.submitLabel} busy={busy === 'submit'} onPress={submit} style={{ flex: 2 }} />
            </View>
          ) : ship.stage === 'writing' ? (
            <View style={s.row}>
              <Button label="取消" busy={busy === 'cancel'} onPress={() => void act({ do: 'cancel' }, 'cancel')} style={{ flex: 1 }} />
              <Button label="在后台继续" onPress={close} style={{ flex: 2 }} />
            </View>
          ) : (
            <Button label="在后台继续" onPress={close} />
          )}
        </ScrollView>
      ) : (
        <>
          <View style={s.step}>
            <StatusGlyph status={notice ? 'done_unread' : 'idle'} />
            <Text style={[font(15), { flex: 1, color: c.textPrimary }]}>{notice ?? '这个出口已经结束了'}</Text>
          </View>
          <Button primary label="完成" onPress={onClose} />
        </>
      )}
    </Sheet>
  )
}

const s = StyleSheet.create({
  box: { borderRadius: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, maxHeight: 220 },
  draft: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  steps: { gap: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  output: { borderRadius: 8, padding: 10 },
  row: { flexDirection: 'row', gap: 10 }
})
