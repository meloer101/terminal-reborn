// What the agent waits for, as a sheet over its conversation: a permission request (Figma 45E) or AskUserQuestion
// (45F). The answer goes back through the held hook (PRD §6.16), so the Mac terminal's dialog closes with it; answered
// in the terminal first, the prompt leaves the list Wavi pushes and the sheet goes.
import { Square, SquareCheck } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import type { RemotePrompt } from '../../../src/shared/remote'
import { allowAlwaysLabel, permissionSubject, permissionTitle, shortAge } from '../state/model'
import { call } from '../state/store'
import { Button, Icon, Sheet } from '../ui/atoms'
import { StatusGlyph } from '../ui/StatusGlyph'
import { font, useColors } from '../ui/theme'
import { useNow } from '../ui/useNow'

const OTHER = '\u0000other'

/** 45F's radio: a ring, filled at its centre when chosen. */
function Radio({ on, color }: { on: boolean; color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22" fill="none">
      <Circle cx={11} cy={11} r={9} stroke={color} strokeWidth={1.75} />
      {on ? <Circle cx={11} cy={11} r={5} fill={color} /> : null}
    </Svg>
  )
}

function Head({ label, waited, chip }: { label: string; waited?: number; chip?: string }) {
  const c = useColors()
  return (
    <View style={s.head}>
      <StatusGlyph status="needs_you" />
      <Text style={[font(13, 500), { color: c.statusAttention }]}>{label}</Text>
      {waited !== undefined ? <Text style={[font(12, 400, true), { color: c.textTertiary }]}>已等 {shortAge(waited)}</Text> : null}
      {chip ? (
        <View style={[s.chip, { backgroundColor: c.bgSelected }]}>
          <Text style={[font(12), { color: c.textSecondary }]}>{chip}</Text>
        </View>
      ) : null}
    </View>
  )
}

function Permission({ prompt, onDone }: { prompt: Extract<RemotePrompt, { kind: 'permission' }>; onDone: (error?: string) => void }) {
  const c = useColors()
  const now = useNow(1000)
  const [busy, setBusy] = useState<string | null>(null)
  const description = typeof prompt.input.description === 'string' ? prompt.input.description : null
  const answer = async (decision: 'allow-once' | 'allow-always' | 'deny') => {
    setBusy(decision)
    const result = await call({ type: 'permission', prompt: prompt.id, decision })
    setBusy(null)
    onDone(result.ok ? undefined : result.error)
  }
  return (
    <>
      <Head label="等你确认" waited={now - prompt.createdAt} />
      <Text style={[font(22, 500), { color: c.textPrimary }]}>{permissionTitle(prompt.tool)}</Text>
      <View style={[s.command, { backgroundColor: c.bgInset }]}>
        <Text style={[font(15, 400, true), { color: c.textPrimary }]} numberOfLines={8}>
          {permissionSubject(prompt.input, prompt.summary)}
        </Text>
      </View>
      {description ? <Text style={[font(15, 400, false, 22), { color: c.textSecondary }]}>{description}</Text> : null}
      {prompt.answerable ? (
        <>
          <View style={s.actions}>
            <Button label="拒绝" busy={busy === 'deny'} disabled={busy !== null} onPress={() => void answer('deny')} style={{ flex: 1 }} />
            <Button primary label="允许" busy={busy === 'allow-once'} disabled={busy !== null} onPress={() => void answer('allow-once')} style={{ flex: 1 }} />
          </View>
          {prompt.canAllowAlways ? (
            <Button label={allowAlwaysLabel(prompt.allowAlways?.rules)} busy={busy === 'allow-always'} disabled={busy !== null} onPress={() => void answer('allow-always')} />
          ) : null}
        </>
      ) : (
        <Text style={[font(15), { color: c.textSecondary }]}>这个请求只能在 Mac 的终端里回答</Text>
      )}
    </>
  )
}

function Question({ prompt, onDone }: { prompt: Extract<RemotePrompt, { kind: 'question' }>; onDone: (error?: string) => void }) {
  const c = useColors()
  const [chosen, setChosen] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const toggle = (q: number, label: string, multi: boolean) =>
    setChosen((all) => {
      const now = all[q] ?? []
      return { ...all, [q]: multi ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label] }
    })
  const answerOf = (q: number): string | null => {
    const picked = (chosen[q] ?? []).map((l) => (l === OTHER ? (other[q] ?? '').trim() : l)).filter(Boolean)
    return picked.length ? picked.join(', ') : null
  }
  const complete = prompt.questions.every((_, i) => answerOf(i) !== null)
  const submit = async () => {
    setBusy(true)
    const answers = Object.fromEntries(prompt.questions.map((q, i) => [q.question, answerOf(i)!]))
    const result = await call({ type: 'answer', prompt: prompt.id, answers })
    setBusy(false)
    onDone(result.ok ? undefined : result.error)
  }
  return (
    <>
      <Head label="等你回答" chip={prompt.questions.length === 1 ? prompt.questions[0]!.header : undefined} />
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 20 }} keyboardShouldPersistTaps="handled">
        {prompt.questions.map((q, i) => {
          const options = [...q.options, { label: OTHER, description: undefined }]
          return (
            <View key={i} style={{ gap: 16 }}>
              <Text style={[font(20, 500, false, 28), { color: c.textPrimary }]}>{q.question}</Text>
              <View style={{ gap: 2 }}>
                {options.map((o) => {
                  const on = (chosen[i] ?? []).includes(o.label)
                  return (
                    <Pressable key={o.label} onPress={() => prompt.answerable && toggle(i, o.label, q.multiSelect)} style={[s.option, on && { backgroundColor: c.bgSelected }]}>
                      {q.multiSelect ? <Icon icon={on ? SquareCheck : Square} size={22} color={on ? c.textPrimary : c.textSecondary} /> : <Radio on={on} color={on ? c.textPrimary : c.textSecondary} />}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[font(16), { color: c.textPrimary }]}>{o.label === OTHER ? '其他…' : o.label}</Text>
                        {o.description ? <Text style={[font(14), { color: c.textSecondary }]}>{o.description}</Text> : null}
                        {o.label === OTHER && on ? (
                          <TextInput
                            autoFocus
                            value={other[i] ?? ''}
                            onChangeText={(t) => setOther((all) => ({ ...all, [i]: t }))}
                            placeholder="写下你的回答"
                            placeholderTextColor={c.textTertiary}
                            multiline
                            style={[font(16, 400, false, 22), { color: c.textPrimary, paddingVertical: 4 }]}
                          />
                        ) : null}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )
        })}
      </ScrollView>
      {prompt.answerable ? (
        <Button primary label="提交" busy={busy} disabled={!complete} onPress={() => void submit()} />
      ) : (
        <Text style={[font(15), { color: c.textSecondary }]}>这个问题现在只能在 Mac 的终端里回答</Text>
      )}
    </>
  )
}

/** The oldest prompt of the session, until it is answered (here or in the terminal); put aside, a row brings it back. */
export function PromptSheet({ prompts }: { prompts: RemotePrompt[] }) {
  const c = useColors()
  const [hidden, setHidden] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prompt = prompts[0]
  useEffect(() => setError(null), [prompt?.id])
  if (!prompt) return null
  const done = (failure?: string) => (failure ? setError(failure) : setHidden(prompt.id))
  const aside = hidden === prompt.id
  return (
    <>
      {aside ? (
        <Pressable onPress={() => setHidden(null)} style={[s.aside, { borderTopColor: c.borderSubtle }]}>
          <StatusGlyph status="needs_you" />
          <Text numberOfLines={1} style={[font(14), { flex: 1, color: c.statusAttention }]}>
            {prompt.kind === 'permission' ? `等你确认：${prompt.summary}` : `等你回答：${prompt.questions[0]?.question ?? ''}`}
          </Text>
        </Pressable>
      ) : null}
      <Sheet visible={!aside} onClose={() => setHidden(prompt.id)}>
        {prompt.kind === 'permission' ? <Permission prompt={prompt} onDone={done} /> : <Question prompt={prompt} onDone={done} />}
        {error ? <Text style={[font(14), { color: c.statusError }]}>{error}</Text> : null}
      </Sheet>
    </>
  )
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  command: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  actions: { flexDirection: 'row', gap: 8 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 10 },
  aside: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth }
})
