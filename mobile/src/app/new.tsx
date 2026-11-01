// 新建会话 (Figma 45H): the fields of the desktop's sheet (PRD F4) — project, 工作目录 (new worktree / current folder),
// the branch it starts from and its name, the agent — plus an optional first message. The Mac's window creates it the
// same way its own sheet does (src/renderer/remote/handler.ts); the phone then opens it.
import { router } from 'expo-router'
import { Bot, ChevronRight } from 'lucide-react-native'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { agentName, type CliAgent } from '../../../src/shared/agents'
import { branchNameProblem, defaultBase, generateBranchName, type NewSessionInfo } from '../../../src/shared/new-session'
import { call, useApp } from '../state/store'
import { Button, Icon } from '../ui/atoms'
import { Picker, type PickerOption } from '../ui/Picker'
import { font, MONO, useColors } from '../ui/theme'

type Info = { info: NewSessionInfo; agents: CliAgent[] }
type Choosing = 'project' | 'base' | 'agent' | null

const BRANCH_PROBLEM = { empty: '要填分支名', invalid: '分支名不能用', exists: '已经有这个分支' } as const

/** The new session shows up in the list Wavi pushes a moment after it is made. */
function opened(id: string): Promise<void> {
  return new Promise((resolve) => {
    if (useApp.getState().sessions.sessions.some((s) => s.id === id)) return resolve()
    const stop = useApp.subscribe((st) => {
      if (!st.sessions.sessions.some((s) => s.id === id)) return
      stop()
      clearTimeout(timer)
      resolve()
    })
    const timer = setTimeout(() => {
      stop()
      resolve()
    }, 5000)
  })
}

function Field({ label, value, mono, icon, onPress }: { label: string; value: string; mono?: boolean; icon?: boolean; onPress?: () => void }) {
  const c = useColors()
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={s.field}>
      <Text style={[font(16), { color: c.textSecondary }]}>{label}</Text>
      <View style={s.fieldValue}>
        {icon ? <Icon icon={Bot} size={18} color={c.textPrimary} /> : null}
        <Text numberOfLines={1} style={[font(mono ? 14 : 16, 400, mono), { color: c.textPrimary, flexShrink: 1 }]}>
          {value}
        </Text>
        {onPress ? <Icon icon={ChevronRight} size={16} color={c.textTertiary} /> : null}
      </View>
    </Pressable>
  )
}

export default function NewSession() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { projects, sessions } = useApp((st) => st.sessions)
  const recent = useMemo(() => [...sessions].sort((a, b) => b.activity - a.activity)[0]?.projectId, [sessions])
  const [project, setProject] = useState<string | null>(recent ?? projects[0]?.id ?? null)
  const [data, setData] = useState<Info | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workdir, setWorkdir] = useState<'worktree' | 'current'>('worktree')
  const [base, setBase] = useState<string | null>(null)
  const [branch, setBranch] = useState('')
  const [agent, setAgent] = useState<CliAgent>('claude')
  const [prompt, setPrompt] = useState('')
  const [choosing, setChoosing] = useState<Choosing>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    setData(null)
    setLoadError(null)
    void call({ type: 'new-session-info', project }).then((r) => {
      if (!r.ok) return setLoadError(r.error)
      const next = r.data as Info
      setData(next)
      setWorkdir(next.info.repo ? 'worktree' : 'current')
      setBase(defaultBase(next.info))
      setBranch(generateBranchName(next.info.prefix, new Set(next.info.branches.map((b) => b.name))))
      setAgent((a) => (next.agents.includes(a) ? a : (next.agents[0] ?? 'claude')))
    })
  }, [project])

  const projectName = projects.find((p) => p.id === project)?.name ?? '选择项目'
  const problem = data && workdir === 'worktree' ? branchNameProblem(branch, data.info.branches) : null
  const ready = !!data && !!project && data.agents.includes(agent) && (workdir === 'current' || (!!base && !problem))

  const baseOptions: PickerOption[] = (data?.info.branches ?? []).map((b, i, all) => ({
    value: b.name,
    label: b.name,
    mono: true,
    section: i === 0 || all[i - 1]!.remote !== b.remote ? (b.remote ? '远程分支' : '本地分支') : undefined
  }))

  const create = async () => {
    if (!ready || !project) return
    setBusy(true)
    setError(null)
    const result = await call({
      type: 'new-session',
      project,
      workdir,
      agent,
      ...(workdir === 'worktree' && base ? { base, branch: branch.trim() } : {}),
      ...(prompt.trim() ? { prompt } : {})
    })
    if (!result.ok) {
      setBusy(false)
      setError(result.error)
      return
    }
    const id = (result.data as { session?: unknown } | undefined)?.session
    if (typeof id === 'string') await opened(id)
    setBusy(false)
    router.back()
    if (typeof id === 'string') router.push(`/session/${id}`)
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bgRaised }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[font(16), { color: c.textSecondary }]}>取消</Text>
        </Pressable>
        <Text style={[font(17, 500), { color: c.textPrimary }]}>新建会话</Text>
        <Text style={[font(16), { opacity: 0 }]}>取消</Text>
      </View>
      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Field label="项目" value={projectName} onPress={() => setChoosing('project')} />
        {loadError ? <Text style={[font(14), { color: c.statusError }]}>{loadError}</Text> : null}
        {!data && !loadError ? <ActivityIndicator style={{ paddingVertical: 20 }} color={c.textTertiary} /> : null}
        {data ? (
          <>
            <View style={s.block}>
              <Text style={[font(16), { color: c.textSecondary }]}>工作目录</Text>
              <View style={[s.segmented, { backgroundColor: c.bgSelected }]}>
                {(['worktree', 'current'] as const).map((w) => {
                  const on = workdir === w
                  const disabled = w === 'worktree' && !data.info.repo
                  return (
                    <Pressable key={w} disabled={disabled} onPress={() => setWorkdir(w)} style={[s.segment, on && { backgroundColor: c.bgFloat }, disabled && { opacity: 0.4 }]}>
                      <Text style={[font(15, on ? 500 : 400), { color: on ? c.textPrimary : c.textSecondary }]}>{w === 'worktree' ? '新 worktree' : '当前目录'}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
            {workdir === 'worktree' ? (
              <>
                <Field label="基于" value={base ?? '选择分支'} mono onPress={() => setChoosing('base')} />
                <View style={s.field}>
                  <Text style={[font(16), { color: c.textSecondary }]}>分支名</Text>
                  <TextInput
                    value={branch}
                    onChangeText={setBranch}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[s.branchInput, { color: c.textPrimary, fontFamily: MONO }]}
                  />
                </View>
                {problem ? <Text style={[font(14), { color: c.statusError, marginTop: -8 }]}>{BRANCH_PROBLEM[problem]}</Text> : null}
              </>
            ) : null}
            <Field label="智能体" value={data.agents.includes(agent) ? agentName(agent) : 'Mac 上没有安装智能体'} icon onPress={data.agents.length ? () => setChoosing('agent') : undefined} />
            <View style={[s.block, { paddingBottom: 0 }]}>
              <Text style={[font(16), { color: c.textSecondary }]}>首条消息</Text>
              <TextInput
                value={prompt}
                onChangeText={setPrompt}
                multiline
                textAlignVertical="top"
                style={[font(16, 400, false, 23), s.prompt, { color: c.textPrimary, backgroundColor: c.bgInset }]}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        {error ? <Text style={[font(14), { color: c.statusError }]}>{error}</Text> : null}
        <Button primary label="创建" busy={busy} disabled={!ready} onPress={() => void create()} />
      </View>

      <Picker title="项目" visible={choosing === 'project'} value={project} options={projects.map((p) => ({ value: p.id, label: p.name }))} onPick={setProject} onClose={() => setChoosing(null)} />
      <Picker title="基于" visible={choosing === 'base'} value={base} options={baseOptions} onPick={setBase} onClose={() => setChoosing(null)} />
      <Picker
        title="智能体"
        visible={choosing === 'agent'}
        value={agent}
        options={(data?.agents ?? []).map((a) => ({ value: a, label: agentName(a) }))}
        onPick={(a) => setAgent(a as CliAgent)}
        onClose={() => setChoosing(null)}
      />
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  form: { paddingHorizontal: 20, paddingTop: 8, gap: 4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  fieldValue: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  block: { gap: 10, paddingVertical: 14 },
  segmented: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 10 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  branchInput: { flex: 1, fontSize: 14, textAlign: 'right', paddingVertical: 0 },
  prompt: { height: 120, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 }
})
