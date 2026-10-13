import { describe, expect, it } from 'vitest'
import { formatPath, imageExtensionFor, pathsInsertion, pickPastedImage, restoreAfterFailure } from './attachments'

describe('formatPath', () => {
  it('leaves plain and CJK paths alone', () => {
    expect(formatPath('/Users/m/项目/a-b_c.png')).toBe('/Users/m/项目/a-b_c.png')
  })
  it('escapes spaces and shell metacharacters', () => {
    expect(formatPath('/tmp/Screen Shot (1).png')).toBe('/tmp/Screen\\ Shot\\ \\(1\\).png')
    expect(formatPath("/tmp/it's.png")).toBe("/tmp/it\\'s.png")
  })
})

describe('pathsInsertion', () => {
  it('adds a leading space only after non-whitespace', () => {
    expect(pathsInsertion(['/a'], 'see')).toBe(' /a ')
    expect(pathsInsertion(['/a'], 'see ')).toBe('/a ')
    expect(pathsInsertion(['/a'], 'see\n')).toBe('/a ')
    expect(pathsInsertion(['/a'], '')).toBe('/a ')
  })
  it('joins multiple paths', () => {
    expect(pathsInsertion(['/a', '/b c'], '')).toBe('/a /b\\ c ')
  })
  it('inserts nothing for no paths', () => {
    expect(pathsInsertion([], 'x')).toBe('')
  })
})

describe('image paste', () => {
  it('maps mime types to extensions', () => {
    expect(imageExtensionFor('image/png')).toBe('png')
    expect(imageExtensionFor('image/jpeg')).toBe('jpg')
    expect(imageExtensionFor('IMAGE/WEBP')).toBe('webp')
    expect(imageExtensionFor('image/bmp')).toBeNull()
    expect(imageExtensionFor('text/plain')).toBeNull()
  })
  it('picks the first supported image item when there is no text', () => {
    const items = [
      { kind: 'string', type: 'text/html' },
      { kind: 'file', type: 'image/bmp' },
      { kind: 'file', type: 'image/png' }
    ]
    expect(pickPastedImage(items, false)).toBe(2)
  })
  it('lets text paste win', () => {
    expect(pickPastedImage([{ kind: 'file', type: 'image/png' }], true)).toBe(-1)
  })
  it('ignores non-image files', () => {
    expect(pickPastedImage([{ kind: 'file', type: 'application/pdf' }], false)).toBe(-1)
  })
})

describe('restoreAfterFailure', () => {
  it('restores into an empty editor', () => {
    expect(restoreAfterFailure('lost', '')).toBe('lost')
  })
  it('keeps newly typed text after the restored text', () => {
    expect(restoreAfterFailure('lost', 'new')).toBe('lost\nnew')
  })
})
