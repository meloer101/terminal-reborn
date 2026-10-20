import { describe, expect, it } from 'vitest'
import { attachmentInput, imageExtension, insertablePath, isDragTempPath, parseDraggedPaths, shellEscapePath } from './attachments'

const P = (text: string) => `\x1b[200~${text}\x1b[201~`

describe('shellEscapePath', () => {
  it('escapes what a shell would split or expand, and keeps CJK as it is', () => {
    expect(shellEscapePath('/Users/u/Desktop/shot.png')).toBe('/Users/u/Desktop/shot.png')
    expect(shellEscapePath('/Users/u/my shot 截图.png')).toBe('/Users/u/my\\ shot\\ 截图.png')
    expect(shellEscapePath("/tmp/a'b\"c$(d)&;*?[]~!#")).toBe("/tmp/a\\'b\\\"c\\$\\(d\\)\\&\\;\\*\\?\\[\\]\\~\\!\\#")
    expect(shellEscapePath('/tmp/a\\b')).toBe('/tmp/a\\\\b')
  })
})

describe('insertablePath', () => {
  it('takes absolute paths without control characters', () => {
    expect(insertablePath('/a/b')).toBe(true)
    expect(insertablePath('relative')).toBe(false)
    expect(insertablePath('/a\nrm -rf ~')).toBe(false)
    expect(insertablePath('/a\tb')).toBe(false)
  })
})

describe('attachmentInput', () => {
  const two = ['/d/a.png', '/d/my notes.md']

  it('Claude: one paste of every path, so its images keep their order', () => {
    expect(attachmentInput(two, 'claude', true)).toBe(P('/d/a.png /d/my\\ notes.md '))
  })

  it('Codex: one paste per path, a space typed between and after', () => {
    expect(attachmentInput(two, 'codex', true)).toBe(`${P('/d/a.png')} ${P('/d/my\\ notes.md')} `)
  })

  it('a shell: one paste, then a space', () => {
    expect(attachmentInput(two, null, true)).toBe(`${P('/d/a.png /d/my\\ notes.md')} `)
  })

  it('a program without bracketed paste gets the plain line', () => {
    expect(attachmentInput(two, null, false)).toBe('/d/a.png /d/my\\ notes.md ')
    expect(attachmentInput(two, 'codex', false)).toBe('/d/a.png /d/my\\ notes.md ')
  })

  it('drops unusable paths, and is empty when none is left', () => {
    expect(attachmentInput(['/d/a.png', '/d/x\ny'], null, false)).toBe('/d/a.png ')
    expect(attachmentInput(['', 'rel'], 'claude', true)).toBe('')
  })
})

describe('imageExtension', () => {
  it('maps the image types the agents read', () => {
    expect(imageExtension('image/png')).toBe('png')
    expect(imageExtension('IMAGE/JPEG')).toBe('jpg')
    expect(imageExtension('image/webp')).toBe('webp')
    expect(imageExtension('image/tiff')).toBeNull()
    expect(imageExtension('text/plain')).toBeNull()
  })
})

describe('parseDraggedPaths', () => {
  it('reads the absolute paths a 文件 view entry carries, and nothing else', () => {
    expect(parseDraggedPaths(JSON.stringify(['/w/src', '/w/a.png']))).toEqual(['/w/src', '/w/a.png'])
    expect(parseDraggedPaths(JSON.stringify(['/w/a', 'rel', 3, '/w/x\ny']))).toEqual(['/w/a'])
    expect(parseDraggedPaths('{"path":"/w/a"}')).toEqual([])
    expect(parseDraggedPaths('not json')).toEqual([])
  })
})

describe('isDragTempPath', () => {
  it('spots files macOS lends for one drag (a screenshot thumbnail)', () => {
    expect(isDragTempPath('/var/folders/8g/x/T/TemporaryItems/NSIRD_screencaptureui_AbC123/截屏 2026-10-20 14.02.11.png')).toBe(true)
    expect(isDragTempPath('/var/folders/8g/x/T/TemporaryItems/other/a.png')).toBe(false)
    expect(isDragTempPath('/Users/u/Desktop/a.png')).toBe(false)
  })
})
