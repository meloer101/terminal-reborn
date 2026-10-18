import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentTitleWatcher,
  claudeTranscriptPath,
  cleanTitle,
  defaultAgentDataDirs,
  parseClaudeTitle,
  parseCodexTitle,
  readTail,
  type AgentDataDirs
} from './agent-title'
import type { Scheduler } from './permission-registry'

const line = (value: unknown) => JSON.stringify(value)

describe('cleanTitle', () => {
  it('keeps one line without control characters and clips by characters', () => {
    expect(cleanTitle('  终端应用\n会话\t自动标题 ')).toBe('终端应用 会话 自动标题')
    expect(cleanTitle('a\u001b[31mb‮')).toBe('a [31mb')
    expect(cleanTitle('中'.repeat(90))).toBe(`${'中'.repeat(80)}…`)
    expect(cleanTitle('   ')).toBeNull()
    expect(cleanTitle(42)).toBeNull()
  })
})

describe('parseClaudeTitle', () => {
  // Shapes captured from Claude Code 2.1.302 transcripts (PRD §6.6).
  const transcript = [
    line({ type: 'last-prompt', lastPrompt: 'x', sessionId: 's' }),
    line({ type: 'user', message: { role: 'user', content: '我想给会话起标题 "type":"ai-title"' } }),
    line({ type: 'ai-title', aiTitle: '终端应用会话自动标题', sessionId: 's' }),
    line({ type: 'assistant', message: { content: [] } })
  ]

  it('reads the generated title', () => {
    expect(parseClaudeTitle(transcript.join('\n'))).toBe('终端应用会话自动标题')
  })

  it('prefers the latest /rename over any generated title', () => {
    const renamed = [...transcript, line({ type: 'custom-title', customTitle: '启动问题', sessionId: 's' }), line({ type: 'ai-title', aiTitle: '另一个', sessionId: 's' })]
    expect(parseClaudeTitle(renamed.join('\n'))).toBe('启动问题')
  })

  it('ignores torn and malformed lines', () => {
    expect(parseClaudeTitle(`{"type":"ai-title","aiTi\n${line({ type: 'ai-title', aiTitle: '' })}\nnot json`)).toBeNull()
  })
})

describe('parseCodexTitle', () => {
  const id = '01a14f0b-cdfa-7870-bb4c-f75f727cb4ae'
  it('takes the latest thread_name of that thread only', () => {
    const index = [
      line({ id, thread_name: '梳理会话标题思路', updated_at: '2026-10-18T12:45:39Z' }),
      line({ id: 'other', thread_name: `mentions ${id}` }),
      line({ id, thread_name: '改过的名字', updated_at: '2026-10-18T12:50:00Z' })
    ].join('\n')
    expect(parseCodexTitle(index, id)).toBe('改过的名字')
    expect(parseCodexTitle(index, 'missing')).toBeNull()
  })
})

describe('readTail', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('returns whole lines from the end and nothing for a missing file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tr-title-'))
    const file = join(dir, 't.jsonl')
    writeFileSync(file, `${'x'.repeat(100)}\n${line({ type: 'ai-title', aiTitle: '尾部' })}\n`)
    const tail = await readTail(file, 60)
    expect(tail.startsWith('{')).toBe(true)
    expect(parseClaudeTitle(tail)).toBe('尾部')
    expect(await readTail(join(dir, 'missing.jsonl'), 60)).toBe('')
  })
})

describe('claudeTranscriptPath', () => {
  const dirs: AgentDataDirs = { claudeProjects: ['/Users/u/.claude/projects'], codexHome: '/Users/u/.codex' }
  it('accepts only transcripts inside the projects directory', () => {
    expect(claudeTranscriptPath('/Users/u/.claude/projects/-tmp-lab/abc.jsonl', dirs)).toBe('/Users/u/.claude/projects/-tmp-lab/abc.jsonl')
    expect(claudeTranscriptPath('/Users/u/.claude/projects/../settings.jsonl', dirs)).toBeNull()
    expect(claudeTranscriptPath('/etc/passwd', dirs)).toBeNull()
    expect(claudeTranscriptPath('relative/a.jsonl', dirs)).toBeNull()
    expect(claudeTranscriptPath(undefined, dirs)).toBeNull()
  })
  it('honours CLAUDE_CONFIG_DIR and CODEX_HOME', () => {
    const d = defaultAgentDataDirs({ CLAUDE_CONFIG_DIR: '/cfg/claude', CODEX_HOME: '/cfg/codex' }, '/Users/u')
    expect(d.claudeProjects).toEqual(['/Users/u/.claude/projects', '/cfg/claude/projects'])
    expect(d.codexHome).toBe('/cfg/codex')
    expect(defaultAgentDataDirs({ CODEX_HOME: 'relative' }, '/Users/u').codexHome).toBe('/Users/u/.codex')
  })
})

describe('AgentTitleWatcher', () => {
  const dirs: AgentDataDirs = { claudeProjects: ['/h/.claude/projects'], codexHome: '/h/.codex' }
  const transcript = '/h/.claude/projects/-w/abc.jsonl'
  const thread = '01a14f0b-cdfa-7870-bb4c-f75f727cb4ae'

  function setup(files: Record<string, string>) {
    const timers = new Map<number, { fn: () => void; ms: number }>()
    let next = 0
    const scheduler: Scheduler = {
      setTimeout: (fn, ms) => {
        timers.set(++next, { fn, ms })
        return next
      },
      clearTimeout: (handle) => void timers.delete(handle as number)
    }
    const emitted: Array<[string, string, string]> = []
    const reads: string[] = []
    const watcher = new AgentTitleWatcher((s, a, t) => emitted.push([s, a, t]), {
      dirs,
      scheduler,
      read: async (path) => {
        reads.push(path)
        return files[path] ?? ''
      }
    })
    const runAll = async () => {
      const due = [...timers.values()]
      timers.clear()
      for (const t of due) t.fn()
      await new Promise((resolve) => setImmediate(resolve))
    }
    return { watcher, emitted, reads, timers, runAll, files }
  }

  it('Claude: looks again after the first prompt and emits only changes', async () => {
    const t = setup({ [transcript]: line({ type: 'ai-title', aiTitle: '会话标题' }) })
    t.watcher.observe('s1', 'claude', 'UserPromptSubmit', { transcript_path: transcript, session_id: 'abc' })
    expect([...t.timers.values()].map((x) => x.ms)).toEqual([3000, 8000, 20000])
    await t.runAll()
    expect(t.emitted).toEqual([['s1', 'claude', '会话标题']])
    t.watcher.observe('s1', 'claude', 'Stop', { transcript_path: transcript })
    await t.runAll()
    expect(t.emitted).toHaveLength(1)
    t.files[transcript] += `\n${line({ type: 'custom-title', customTitle: '新名字' })}`
    t.watcher.observe('s1', 'claude', 'Stop', { transcript_path: transcript })
    await t.runAll()
    expect(t.emitted.at(-1)).toEqual(['s1', 'claude', '新名字'])
  })

  it('Claude: never reads a transcript outside its projects directory', async () => {
    const t = setup({})
    t.watcher.observe('s1', 'claude', 'Stop', { transcript_path: '/etc/secret.jsonl' })
    await t.runAll()
    expect(t.reads).toEqual([])
  })

  it('Codex: reads the session index by the hook session_id after Stop', async () => {
    const index = '/h/.codex/session_index.jsonl'
    const t = setup({ [index]: line({ id: thread, thread_name: '梳理会话标题思路' }) })
    t.watcher.observe('s2', 'codex', 'SessionStart', { session_id: thread })
    t.watcher.observe('s2', 'codex', 'Stop', { session_id: thread })
    expect([...t.timers.values()].map((x) => x.ms)).toEqual([0, 2000, 6000, 15000, 30000])
    await t.runAll()
    expect(t.reads.every((p) => p === index)).toBe(true)
    expect(t.emitted).toEqual([['s2', 'codex', '梳理会话标题思路']])
  })

  it('forget cancels pending looks and drops late answers', async () => {
    const t = setup({ [transcript]: line({ type: 'ai-title', aiTitle: '会话标题' }) })
    t.watcher.observe('s1', 'claude', 'UserPromptSubmit', { transcript_path: transcript })
    t.watcher.forget('s1')
    expect(t.timers.size).toBe(0)
    await t.runAll()
    expect(t.emitted).toEqual([])
  })
})
