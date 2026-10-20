// One-line Chinese description of what an agent is doing, from a PreToolUse payload (PRD §3.2).

const BASH_PREVIEW_CHARS = 40
const DETAIL_PREVIEW_CHARS = 60

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Last path segment; tolerates trailing slashes and Windows separators. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? path
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** The action line for a tool call; unknown tools (and known ones without usable input) fall back to the tool name. */
export function currentAction(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read': {
      const path = str(input, 'file_path')
      return path ? `读取 ${basename(path)}` : tool
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const path = str(input, 'file_path') ?? str(input, 'notebook_path')
      return path ? `编辑 ${basename(path)}` : tool
    }
    case 'Bash': {
      const command = str(input, 'command')
      return command ? `运行 ${oneLine(command, BASH_PREVIEW_CHARS)}` : tool
    }
    case 'Grep':
    case 'Glob': {
      const pattern = str(input, 'pattern')
      return pattern ? `搜索 '${oneLine(pattern, DETAIL_PREVIEW_CHARS)}'` : tool
    }
    case 'WebSearch': {
      const query = str(input, 'query')
      return query ? `搜索 '${oneLine(query, DETAIL_PREVIEW_CHARS)}'` : tool
    }
    case 'WebFetch': {
      const url = str(input, 'url')
      return url ? `抓取 ${host(url)}` : tool
    }
    case 'Task':
    case 'Agent': {
      const description = str(input, 'description') ?? str(input, 'prompt')
      return description ? `子任务：${oneLine(description, DETAIL_PREVIEW_CHARS)}` : tool
    }
    case 'AskUserQuestion': {
      const questions = input.questions
      const first = Array.isArray(questions) ? (questions[0] as { question?: unknown } | undefined) : undefined
      const question = typeof first?.question === 'string' ? first.question : undefined
      return question ? `提问：${oneLine(question, DETAIL_PREVIEW_CHARS)}` : '提问'
    }
    case 'ExitPlanMode':
      return '确认计划'
    default:
      return tool
  }
}
