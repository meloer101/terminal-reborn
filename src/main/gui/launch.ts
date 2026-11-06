// How a GUI session's agent is started (PRD F23 / §6.17): the argument vector per protocol, the `wavi` PATH prefix,
// what a message's attachments become, and the short Chinese reason shown when the process could not start or died.
// Pure: src/main/gui/index.ts supplies the hooks, the dispatch launch and the binary.

import { AGENT_SPECS, type CliAgent } from '@shared/agents'
import { shellQuote, tomlString } from '@shared/agent-launch'
import { AGENT_GUI, guiBinary, launchPermissionArgs } from '@shared/gui-agents'
import { CLAUDE_MODE_OF } from './claude-stream'
import type { GuiLaunch, GuiProtocol } from '@shared/gui-chat'
import { isSafeAgentSessionId } from '@shared/workspace-file'
import { compareSemver, parseSemver } from '../update-check'
import type { ImageBlock } from './driver'

/** The flags a long-lived headless Claude needs for a GUI (PRD F23 驱动). */
export const CLAUDE_STREAM_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--replay-user-messages',
  '--permission-prompt-tool',
  'stdio'
] as const

export interface GuiArgvInput {
  agent: CliAgent
  /** The folder the agent runs in, resolved (Codex's per-launch trust names it). */
  realCwd: string
  launch: Pick<GuiLaunch, 'model' | 'resumeAt' | 'permission' | 'plan'>
  /** Continue this conversation (Claude `--resume`; Codex and ACP resume over their protocol). */
  resume?: string
  /** Claude's per-launch hooks file (src/main/hooks). */
  claudeSettingsPath?: string
  /** `claude --version`, when known: from 2.1.94 on it is asked for thinking summaries. */
  claudeVersion?: string | null
  /** Arguments after the binary: the dispatch system prompt (Claude `--append-system-prompt`, Codex `-c …`). */
  extraArgs?: readonly string[]
}

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]{0,79}$/

/** The first Claude Code with `--thinking-display` (2.1.92 lacks it; there is no 2.1.93). An older one exits on it. */
const THINKING_DISPLAY_SINCE = { major: 2, minor: 1, patch: 94, prerelease: [] }

/**
 * Current models send thinking without its text unless asked (display omitted); summarized gives the row under
 * 「思考了 Ns」 something to open, as T3 Code, Paseo and Orca ask. Billed the same either way.
 */
function thinkingDisplayArgs(version: string | null | undefined): string[] {
  const parsed = version ? parseSemver(version) : null
  return parsed && compareSemver(parsed, THINKING_DISPLAY_SINCE) >= 0 ? ['--thinking-display', 'summarized'] : []
}

/** `[binary, ...args]` for the agent's GUI protocol; null for an agent without one. */
export function guiArgv(input: GuiArgvInput): string[] | null {
  const driver = AGENT_GUI[input.agent]
  if (!driver) return null
  const binary = guiBinary(input.agent, AGENT_SPECS[input.agent].binary)
  if (driver.protocol === 'claude-stream') {
    const resume = isSafeAgentSessionId(input.resume)
      ? ['--resume', input.resume, ...(isSafeAgentSessionId(input.launch.resumeAt) ? ['--resume-session-at', input.launch.resumeAt] : [])]
      : []
    const model = input.launch.model && MODEL.test(input.launch.model) ? ['--model', input.launch.model] : []
    // The saved 权限 / 计划 (Figma 56); 询问 is Claude's default (its --permission-mode has no `default` choice).
    const mode = input.launch.plan ? 'plan' : input.launch.permission && input.launch.permission !== 'ask' ? CLAUDE_MODE_OF[input.launch.permission] : undefined
    return [binary, ...CLAUDE_STREAM_ARGS, ...thinkingDisplayArgs(input.claudeVersion), ...(mode ? ['--permission-mode', mode] : []), ...resume, ...(input.claudeSettingsPath ? ['--settings', input.claudeSettingsPath] : []), ...(input.extraArgs ?? []), ...model]
  }
  if (driver.protocol === 'codex-app-server') {
    // Global `-c` overrides go before the subcommand; trust for this folder only, nothing written to ~/.codex.
    return [
      binary,
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      `projects={${tomlString(input.realCwd)}={trust_level="trusted"}}`,
      ...(input.extraArgs ?? []),
      'app-server'
    ]
  }
  // A permission mode set at launch goes before the agent's ACP arguments (`grok --permission-mode auto agent stdio`).
  return [binary, ...launchPermissionArgs(input.agent, input.launch.permission, input.launch.plan), ...('adapter' in driver ? driver.adapter.args : driver.args)]
}

/** The agent's own environment for its GUI protocol (ACP agents' auto-update switches) on top of its CLI row's. */
export function guiEnv(agent: CliAgent): Record<string, string> {
  const driver = AGENT_GUI[agent]
  const acpEnv = driver?.protocol === 'acp' && 'env' in driver ? driver.env : undefined
  return { ...AGENT_SPECS[agent].env, ...acpEnv }
}

/**
 * The command the pipe host runs with `exec` in the login shell. With a PATH prefix (`wavi`, PRD F21) a POSIX `sh`
 * puts it first after the user's rc files ran, then becomes the agent.
 */
export function guiCommand(argv: readonly string[], pathPrefix?: string): { command: string; args: string[] } {
  if (!pathPrefix) return { command: argv[0] ?? '', args: argv.slice(1) }
  return { command: '/bin/sh', args: ['-c', `PATH=${shellQuote(pathPrefix)}:"$PATH"; export PATH; exec ${argv.map(shellQuote).join(' ')}`] }
}

/** Whether dispatch's system prompt goes on this protocol's command line (ACP agents' TUI flags do not apply). */
export const takesSystemPromptArgs = (protocol: GuiProtocol): boolean => protocol !== 'acp'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i

/** Claude and ACP agents get png / jpg / gif / webp as image blocks; Codex reads them from the path. */
export const isImagePath = (path: string): boolean => IMAGE_EXT.test(path)

/**
 * Image bytes inlined in one message, at most: the message is one stdin line, and a line must fit in one frame of the
 * pty daemon's socket (PIPE_MAX_LINE_CHARS; base64 is 4/3 of the bytes). Images past it go as paths.
 */
export const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * The attachments sent as image blocks (`image` reads one; null when the agent takes none) and the rest, named by
 * path in the text.
 */
export async function splitAttachments(
  attachments: readonly string[],
  image: ((path: string) => Promise<ImageBlock | null>) | null
): Promise<{ images: ImageBlock[]; paths: string[] }> {
  const images: ImageBlock[] = []
  const paths: string[] = []
  let bytes = 0
  for (const path of attachments) {
    const block = image && isImagePath(path) && bytes < MAX_INLINE_IMAGE_BYTES ? await image(path) : null
    const size = block ? Math.ceil((block.data.length * 3) / 4) : 0
    if (block && bytes + size <= MAX_INLINE_IMAGE_BYTES) {
      images.push(block)
      bytes += size
    } else paths.push(path)
  }
  return { images, paths }
}

/** Attachments that are not sent as images go into the text as paths, one per line (as F19 drops them). */
export function withPaths(text: string, paths: readonly string[]): string {
  if (paths.length === 0) return text
  return text.trim() ? `${text}\n\n${paths.join('\n')}` : paths.join('\n')
}

export interface PipeExitInfo {
  exitCode: number
  signal?: number
  stderr: string
}

/** Why the agent process ended, for the line above the composer. */
export function exitReason(exit: PipeExitInfo, binary: string): string {
  if (exit.exitCode === 127) return `找不到 ${binary}`
  const tail = exit.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' ')
  const clipped = tail.length > 300 ? `…${tail.slice(-300)}` : tail
  const how = exit.signal ? `${binary} 被结束了` : `${binary} 退出了（退出码 ${exit.exitCode}）`
  return clipped ? `${how}：${clipped}` : how
}
