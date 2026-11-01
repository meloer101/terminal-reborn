// The agent's replies are Markdown (PRD F22 会话页). Enough of it for a phone: paragraphs, headings, lists, quotes, fenced
// code (scrolls sideways), inline code, bold and italics. Anything else stays as text.
import { ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native'
import { font, useColors, type Colors } from './theme'

type Block = { kind: 'p' | 'h' | 'li' | 'quote'; text: string; marker?: string } | { kind: 'code'; text: string }

export function blocks(source: string): Block[] {
  const out: Block[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) out.push({ kind: 'p', text: paragraph.join('\n') })
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) code.push(lines[i]!)
      out.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    if (heading) {
      flush()
      out.push({ kind: 'h', text: heading[1]! })
    } else if (item) {
      flush()
      out.push({ kind: 'li', text: item[2]!, marker: /\d/.test(item[1]!) ? item[1] : '•' })
    } else if (quote) {
      flush()
      out.push({ kind: 'quote', text: quote[1]! })
    } else paragraph.push(line)
  }
  flush()
  return out
}

/** `code`, **bold**, *italic* inside a line. */
function Inline({ text, style, c }: { text: string; style: TextStyle; c: Colors }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).filter(Boolean)
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
          return (
            <Text key={i} style={[font(14, 400, true), { color: c.textPrimary, backgroundColor: c.bgSelected }]}>
              {part.slice(1, -1)}
            </Text>
          )
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          return (
            <Text key={i} style={{ fontWeight: '600' }}>
              {part.slice(2, -2)}
            </Text>
          )
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {part.slice(1, -1)}
            </Text>
          )
        return part
      })}
    </Text>
  )
}

export function Markdown({ text }: { text: string }) {
  const c = useColors()
  const body: TextStyle = { ...font(16, 400, false, 24), color: c.textPrimary }
  return (
    <View style={s.root}>
      {blocks(text).map((b, i) => {
        switch (b.kind) {
          case 'code':
            return (
              <ScrollView key={i} horizontal style={[s.code, { backgroundColor: c.bgInset }]} contentContainerStyle={s.codeInner}>
                <Text style={[font(12, 400, true, 18), { color: c.termFg }]}>{b.text}</Text>
              </ScrollView>
            )
          case 'h':
            return <Inline key={i} text={b.text} c={c} style={{ ...body, fontWeight: '600' }} />
          case 'li':
            return (
              <View key={i} style={s.li}>
                <Text style={[body, { color: c.textSecondary, minWidth: 14 }]}>{b.marker}</Text>
                <View style={{ flex: 1 }}>
                  <Inline text={b.text} c={c} style={body} />
                </View>
              </View>
            )
          case 'quote':
            return (
              <View key={i} style={[s.quote, { borderLeftColor: c.borderStrong }]}>
                <Inline text={b.text} c={c} style={{ ...body, color: c.textSecondary }} />
              </View>
            )
          default:
            return <Inline key={i} text={b.text} c={c} style={body} />
        }
      })}
    </View>
  )
}

const s = StyleSheet.create({
  root: { gap: 8 },
  code: { borderRadius: 8 },
  codeInner: { padding: 12 },
  li: { flexDirection: 'row', gap: 6 },
  quote: { borderLeftWidth: 2, paddingLeft: 10 }
})
