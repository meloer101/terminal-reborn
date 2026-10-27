// The checks fact above Git · 变更's ship zone (PRD F13 v1.78, Figma 29A / 29J): its words and which mark it takes.
// A ✓ only when every check that ran passed; nothing ran (every kind 未跑) is a —, never a tick.
import { checksText, type TurnCheckView } from '@shared/turn-checks'

export type ChecksRowTone = 'ok' | 'fail' | 'none'

/** `这一轮跑过：测试 ✓ · lint ✓ · 类型 未跑`; `这一轮没跑检查` when nothing ran; 上一轮 when this turn has not edited or checked yet. */
export function checksRow(view: TurnCheckView): { tone: ChecksRowTone; text: string } {
  const when = view.turn === 'current' ? '这一轮' : '上一轮'
  const ran = view.kinds.filter((k) => k.status !== 'not-run')
  if (ran.length === 0) return { tone: 'none', text: `${when}没跑检查` }
  const text = `${when}跑过：${checksText(view)}`
  if (ran.some((k) => k.status === 'fail')) return { tone: 'fail', text }
  return { tone: ran.every((k) => k.status === 'pass') ? 'ok' : 'none', text }
}
