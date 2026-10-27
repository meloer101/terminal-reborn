import { describe, expect, it } from 'vitest'
import {
  agentFree,
  backToGlance,
  begin,
  canTakeMessage,
  commitSubjectOf,
  compareLine,
  complete,
  conflictPrompt,
  createFailureStep,
  fail,
  firstUndone,
  flowSteps,
  formatCommit,
  glanceFields,
  mainFailureStep,
  markFailed,
  parseRemembered,
  retry,
  setTexts,
  startState,
  stepGlyph,
  submitBlocker,
  submitLabel,
  toGlance,
  toRunning,
  type FlowInput
} from './ship-flow'

const input = (patch: Partial<FlowInput> = {}): FlowInput => ({
  kind: 'main',
  agent: 'Claude',
  base: 'main',
  branch: 'feat/x',
  remote: 'origin',
  review: false,
  uncommitted: false,
  ...patch
})

const labels = (patch: Partial<FlowInput>): string[] => flowSteps(input(patch)).map((s) => s.label)

describe('flowSteps', () => {
  it('exit A: write the message, squash into the base, push it', () => {
    expect(labels({})).toEqual(['Claude 写提交说明', '合并到 main · Squash', '推送 origin/main'])
  })

  it('exit B: write title and body, push the branch, create the PR; 提交 only with uncommitted work', () => {
    expect(labels({ kind: 'pr', agent: 'Codex' })).toEqual(['Codex 写标题和正文', '推送 feat/x', '创建 PR'])
    expect(labels({ kind: 'pr', uncommitted: true })).toEqual(['Claude 写标题和正文', '提交', '推送 feat/x', '创建 PR'])
  })

  it('pushing to an open PR: just the push, or message → commit → push', () => {
    expect(labels({ kind: 'push-pr' })).toEqual(['推送 feat/x'])
    expect(labels({ kind: 'push-pr', uncommitted: true })).toEqual(['Claude 写提交说明', '提交', '推送 feat/x'])
  })

  it('a review comes first when it is asked for', () => {
    expect(labels({ review: true })[0]).toBe('审阅')
    expect(labels({ kind: 'pr', review: true }).slice(0, 2)).toEqual(['审阅', 'Claude 写标题和正文'])
  })

  it('names the remote the base goes to', () => {
    expect(labels({ remote: 'upstream', base: 'develop' })[2]).toBe('推送 upstream/develop')
  })
})

describe('transitions', () => {
  it('starts on the first step in the writing stage', () => {
    const state = startState(input({ review: true }), '合并到 main 并推送')
    expect(state.stage).toBe('writing')
    expect(state.steps.map((s) => s.state)).toEqual(['working', 'pending', 'pending', 'pending'])
  })

  it('a push with nothing to write goes straight to running', () => {
    const state = startState(input({ kind: 'push-pr' }), '推送到 PR #3')
    expect(state.stage).toBe('running')
    expect(state.steps[0]!.state).toBe('working')
  })

  it('writing ends at the glance with the write step done, then running starts the next step', () => {
    let state = startState(input(), '合并到 main 并推送')
    state = toGlance(state, {
      commit: 'feat: x',
      title: '',
      body: '',
      draft: false
    })
    expect(state.stage).toBe('glance')
    expect(state.steps.map((s) => s.state)).toEqual(['done', 'pending', 'pending'])
    state = toRunning(state)
    expect(state.stage).toBe('running')
    expect(state.steps.map((s) => s.state)).toEqual(['done', 'working', 'pending'])
  })

  it('a failure stops at its step; 重试 resumes in the stage it failed in and keeps finished steps', () => {
    let state = toRunning(
      toGlance(startState(input(), 't'), {
        commit: 'feat: x',
        title: '',
        body: '',
        draft: false
      })
    )
    state = fail(state, {
      step: 'merge',
      message: '有冲突',
      conflicts: ['a.ts']
    })
    expect(state.steps.map((s) => s.state)).toEqual(['done', 'failed', 'pending'])
    expect(state.failedIn).toBe('running')
    state = retry(state)
    expect(state.error).toBeNull()
    expect(state.stage).toBe('running')
    expect(state.steps.map((s) => s.state)).toEqual(['done', 'working', 'pending'])
    expect(firstUndone(state.steps)?.id).toBe('merge')
  })

  it('a declined confirmation goes back to the glance with the unfinished steps pending', () => {
    let state = toRunning(
      toGlance(startState(input(), 't'), {
        commit: 'feat: x',
        title: '',
        body: '',
        draft: false
      })
    )
    state = backToGlance(state)
    expect(state.stage).toBe('glance')
    expect(state.steps.map((s) => s.state)).toEqual(['done', 'pending', 'pending'])
    expect(state.texts.commit).toBe('feat: x')
  })

  it('a failed write retries in the writing stage', () => {
    let state = startState(input(), 't')
    state = fail(state, { step: 'write', message: '等了 10 分钟' })
    expect(state.failedIn).toBe('writing')
    expect(retry(state).stage).toBe('writing')
  })

  it('a failed review can be marked without stopping the flow', () => {
    const state = markFailed(startState(input({ review: true }), 't'), 'review', '审阅失败')
    expect(state.error).toBeNull()
    expect(state.steps[0]).toMatchObject({ state: 'failed', note: '审阅失败' })
  })

  it('begin and complete replace the note', () => {
    let state = startState(input(), 't')
    state = begin(state, 'write', '等 Claude 空闲')
    expect(state.steps[0]!.note).toBe('等 Claude 空闲')
    state = complete(state, 'write')
    expect(state.steps[0]).toMatchObject({ state: 'done', note: undefined })
  })
})

describe('glance', () => {
  it('shows what each exit has to say', () => {
    const main = startState(input(), 't')
    expect(glanceFields(main)).toEqual(['commit'])
    expect(glanceFields(startState(input({ kind: 'pr' }), 't'))).toEqual(['title', 'body', 'base', 'draft'])
    expect(glanceFields(startState(input({ kind: 'pr', uncommitted: true }), 't'))).toEqual(['commit', 'title', 'body', 'base', 'draft'])
    expect(glanceFields(startState(input({ kind: 'push-pr', uncommitted: true }), 't'))).toEqual(['commit'])
  })

  it('wants a subject, and for a PR a title', () => {
    const main = startState(input(), 't')
    expect(submitBlocker(main)).toBe('写一句提交说明')
    expect(submitBlocker(setTexts(main, { commit: 'feat: x' }))).toBeNull()
    const pr = startState(input({ kind: 'pr' }), 't')
    expect(submitBlocker(pr)).toBe('写一个标题')
    expect(submitBlocker(setTexts(pr, { title: 'T' }))).toBeNull()
  })

  it('labels the primary button after the exit', () => {
    expect(submitLabel('main')).toBe('合并并推送')
    expect(submitLabel('pr')).toBe('推送并创建 PR')
  })

  it('joins and reads the commit message', () => {
    expect(formatCommit({ subject: 'feat: x', body: 'why\nhow' })).toBe('feat: x\n\nwhy\nhow')
    expect(formatCommit({ subject: 'feat: x', body: '  ' })).toBe('feat: x')
    expect(commitSubjectOf('\n  feat: x \n\nbody')).toBe('feat: x')
  })
})

describe('helpers', () => {
  it('draws the glyph column', () => {
    expect(['working', 'done', 'pending', 'failed'].map((s) => stepGlyph(s as never))).toEqual(['◌', '✓', '○', '✗'])
  })

  it('writes the compare line, 落后 only when behind', () => {
    expect(compareLine('main', 3, 0)).toBe('对比 main · 领先 3')
    expect(compareLine('main', 3, 2)).toBe('对比 main · 领先 3 · 落后 2')
  })

  it('maps a failed ship to the step that shows it', () => {
    expect(mainFailureStep('commit')).toBe('merge')
    expect(mainFailureStep('merge')).toBe('merge')
    expect(mainFailureStep('push')).toBe('push')
    expect(createFailureStep('remote rejected')).toBe('push')
    expect(createFailureStep('GraphQL: not allowed')).toBe('create')
  })

  it('lists the conflicting files and nothing else', () => {
    expect(conflictPrompt('main', ['a.ts', 'b.ts'])).toBe('合并到 main 时这些文件有冲突，请解决后提交：\n- a.ts\n- b.ts')
  })

  it('reads only known remembered exits', () => {
    expect(parseRemembered('pr')).toBe('pr')
    expect(parseRemembered('main')).toBe('main')
    expect(parseRemembered('x')).toBeNull()
    expect(parseRemembered(null)).toBeNull()
  })

  it('asks the session only when it is an agent with hooks that is alive, and types only when it is free', () => {
    const session = { kind: 'claude', status: 'idle', phase: 'ready' } as const
    expect(canTakeMessage(session, true)).toBe(true)
    expect(canTakeMessage(session, false)).toBe(false)
    expect(canTakeMessage({ ...session, kind: 'shell' }, true)).toBe(false)
    expect(canTakeMessage({ ...session, phase: 'exited' }, true)).toBe(true)
    expect(canTakeMessage(null, true)).toBe(false)
    expect(agentFree(session)).toBe(true)
    expect(agentFree({ ...session, status: 'done_unread' })).toBe(true)
    expect(agentFree({ ...session, status: 'running' })).toBe(false)
    expect(agentFree({ ...session, status: 'needs_you' })).toBe(false)
    expect(agentFree({ ...session, phase: 'starting' })).toBe(false)
  })
})
