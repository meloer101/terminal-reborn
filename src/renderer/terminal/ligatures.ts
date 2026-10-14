// Programming ligatures for xterm via its character-joiner API.
//
// @xterm/addon-ligatures was evaluated and not adopted: the stable 0.10 line reads font files
// through Node APIs (unavailable with sandbox: true) and the 0.11 beta needs xterm 6.1 betas plus
// the queryLocalFonts permission. The joiner API itself is in xterm 6.0 and honoured by the WebGL
// renderer, so we register our own joiner over the common `calt` sequences. The font does the
// actual shaping: fonts without ligatures render the joined run exactly like separate glyphs.

/** Sequences that Fira Code / JetBrains Mono / Cascadia style fonts turn into one glyph. */
export const LIGATURE_SEQUENCES: readonly string[] = [
  '<--', '<---', '<<-', '<-', '->', '->>', '-->', '--->',
  '<==', '<===', '<<=', '<=', '=>', '=>>', '==>', '===>', '>=', '>>=',
  '<->', '<-->', '<--->', '<---->', '<=>', '<==>', '<===>', '<====>', '::', ':::',
  '<~~', '</', '</>', '/>', '~~>', '==', '!=', '/=', '~=', '<>', '===', '!==', '!===',
  '<:', ':=', '*=', '*+', '<*', '<*>', '*>', '<|', '<|>', '|>', '+*', '=*', '=:', ':>',
  '/*', '*/', '+++', '<!--', '<!---', '&&', '||', '++', '--', '..', '...', '??', '?.', '|-', '-|',
  '>>', '<<', '>>>', '<<<', '##', '###', '####', '#{', '#[', '#(', '#?', '#_', '#_(', '__',
  'www', '~@', '~-', '=!=', '\\\\', '\\\\\\', '//', '///', '<$>', '<$', '$>', '<+>', '<+', '+>'
].sort((a, b) => b.length - a.length)

/** Character ranges `[start, end)` in `text` that should be drawn as one ligature run. */
export function findLigatureRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  for (let i = 0; i < text.length; i++) {
    const hit = LIGATURE_SEQUENCES.find((sequence) => text.startsWith(sequence, i))
    if (hit) {
      ranges.push([i, i + hit.length])
      i += hit.length - 1
    }
  }
  return ranges
}
