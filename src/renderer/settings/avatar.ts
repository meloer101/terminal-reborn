// 设置 · 外观 · 对话 · 我的头像 (PRD F23 v1.127, Figma 51D): a picture the user picks, cut to its centred square and
// scaled to 256² — no crop dialog (Open WebUI does the same) — kept in settings as a webp data URL.

/** Edge of the stored picture, px: twice the largest place it is drawn (28 at 2×, with room). */
export const AVATAR_PX = 256

/** The centred square of a `width` × `height` picture: what is kept. */
export function centreSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height)
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size }
}

/** Reads a picked image file into the stored form. Rejects when the file is not a picture the browser can decode. */
export async function avatarFromFile(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const { x, y, size } = centreSquare(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_PX
    canvas.height = AVATAR_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, x, y, size, size, 0, 0, AVATAR_PX, AVATAR_PX)
    return canvas.toDataURL('image/webp', 0.85)
  } finally {
    bitmap.close()
  }
}
