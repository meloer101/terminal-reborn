// 设置 · 手机 (PRD F22, Figma 45K): the few texts the page computes. Pure.
import { encode } from 'uqr'

/** `4:32 后失效`; '已失效' at 0. */
export function expiresText(msLeft: number): string {
  if (msLeft <= 0) return '已失效'
  const s = Math.ceil(msLeft / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} 后失效`
}

/** When a phone was last connected: `刚刚`, `5 分钟前`, `3 小时前`, `3 天前`; '' when never. */
export function lastSeenText(at: number | null, now: number): string {
  if (at === null) return ''
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** The QR code as one SVG path over a `size`×`size` grid of modules (no quiet zone: the tile draws it). */
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { ecc: 'M', border: 0 })
  let d = ''
  data.forEach((row, y) => row.forEach((dark, x) => (d += dark ? `M${x} ${y}h1v1h-1z` : '')))
  return { size, d }
}
