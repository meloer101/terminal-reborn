import { describe, expect, it } from 'vitest'
import { headingSlug, imagePath, isMarkdownPath, resolveMarkdownHref } from './markdown-model'

describe('isMarkdownPath', () => {
  it('knows the Markdown extensions, in any case', () => {
    expect(isMarkdownPath('docs/PRD.md')).toBe(true)
    expect(isMarkdownPath('README.MD')).toBe(true)
    expect(isMarkdownPath('notes.markdown')).toBe(true)
    expect(isMarkdownPath('page.mdx')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
  })
})

describe('resolveMarkdownHref', () => {
  it('keeps http(s) links as URLs', () => {
    expect(resolveMarkdownHref('https://example.com/a', 'docs/a.md')).toEqual({ kind: 'url', url: 'https://example.com/a' })
  })

  it('refuses other schemes and protocol-relative links', () => {
    expect(resolveMarkdownHref('javascript:alert(1)', 'a.md')).toBeNull()
    expect(resolveMarkdownHref('mailto:a@b.c', 'a.md')).toBeNull()
    expect(resolveMarkdownHref('file:///etc/passwd', 'a.md')).toBeNull()
    expect(resolveMarkdownHref('//evil.example/x', 'a.md')).toBeNull()
    expect(resolveMarkdownHref('  ', 'a.md')).toBeNull()
  })

  it('treats a bare fragment as an anchor in this file', () => {
    expect(resolveMarkdownHref('#package-topology', 'docs/a.md')).toEqual({ kind: 'anchor', id: 'package-topology' })
    expect(resolveMarkdownHref('#%E4%B8%AD%E6%96%87', 'a.md')).toEqual({ kind: 'anchor', id: '中文' })
    expect(resolveMarkdownHref('#', 'a.md')).toBeNull()
  })

  it('resolves relative paths against the file’s folder and root-absolute ones against the root', () => {
    expect(resolveMarkdownHref('../README.md', 'docs/architecture.md')).toEqual({ kind: 'file', path: 'README.md', line: null })
    expect(resolveMarkdownHref('./web.md', 'docs/architecture.md')).toEqual({ kind: 'file', path: 'docs/web.md', line: null })
    expect(resolveMarkdownHref('/src/a.ts', 'docs/x/y.md')).toEqual({ kind: 'file', path: 'src/a.ts', line: null })
    expect(resolveMarkdownHref('my%20file.md?raw=1', 'a.md')).toEqual({ kind: 'file', path: 'my file.md', line: null })
  })

  it('reads a #L line and ignores other fragments on a file', () => {
    expect(resolveMarkdownHref('src/a.ts#L42', 'README.md')).toEqual({ kind: 'file', path: 'src/a.ts', line: 42 })
    expect(resolveMarkdownHref('src/a.ts#L42-L50', 'README.md')).toEqual({ kind: 'file', path: 'src/a.ts', line: 42 })
    expect(resolveMarkdownHref('other.md#usage', 'README.md')).toEqual({ kind: 'file', path: 'other.md', line: null })
  })

  it('never climbs out of the root', () => {
    expect(resolveMarkdownHref('../../etc/passwd', 'docs/a.md')).toBeNull()
    expect(resolveMarkdownHref('..', 'a.md')).toBeNull()
    expect(resolveMarkdownHref('./', 'a.md')).toBeNull()
  })
})

describe('imagePath', () => {
  it('only gives paths inside the worktree', () => {
    expect(imagePath('assets/logo.png', 'docs/a.md')).toBe('docs/assets/logo.png')
    expect(imagePath('https://img.shields.io/x.svg', 'a.md')).toBeNull()
    expect(imagePath('data:image/png;base64,AAAA', 'a.md')).toBeNull()
    expect(imagePath('../../x.png', 'docs/a.md')).toBeNull()
  })
})

describe('headingSlug', () => {
  it('matches GitHub’s anchors', () => {
    expect(headingSlug('Package topology')).toBe('package-topology')
    expect(headingSlug('F17 · 右侧栏 (P1)')).toBe('f17--右侧栏-p1')
    expect(headingSlug('`npm run dev`!')).toBe('npm-run-dev')
  })
})
