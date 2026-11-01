// The phone's tokens: the desktop's src/renderer/styles/tokens.css values (Figma variables, both themes) that the
// Figma 45 screens use, so the two apps stay one system. Follows the phone's light / dark setting.
import { useColorScheme, type TextStyle } from 'react-native'

const dark = {
  bgApp: '#0a0a0a',
  bgRaised: '#161616',
  bgFloat: '#121212',
  bgInset: '#050505',
  bgHover: '#ffffff0a',
  bgSelected: '#ffffff12',
  borderSubtle: '#ffffff12',
  borderStrong: '#ffffff2e',
  textPrimary: '#ededed',
  textSecondary: '#a1a1a1',
  textTertiary: '#808080',
  textDisabled: '#474747',
  textInverse: '#0a0a0a',
  fillPrimary: '#ededed',
  scrim: '#00000066',
  statusWorking: '#5ea1ff',
  statusAttention: '#ff5fb0',
  statusAttentionBg: '#ff5fb01f',
  statusDone: '#3dd68c',
  statusError: '#ff5c5c',
  statusIdle: '#6b6b6b',
  diffAddFg: '#3dd68c',
  diffAddBg: '#3dd68c1f',
  diffDelFg: '#ff5c5c',
  diffDelBg: '#ff5c5c1f',
  termFg: '#e5e5e5'
}

export type Colors = typeof dark

const light: Colors = {
  bgApp: '#ffffff',
  bgRaised: '#ffffff',
  bgFloat: '#ffffff',
  bgInset: '#fafafa',
  bgHover: '#0000000a',
  bgSelected: '#00000014',
  borderSubtle: '#00000014',
  borderStrong: '#00000033',
  textPrimary: '#121212',
  textSecondary: '#474747',
  textTertiary: '#808080',
  textDisabled: '#c9c9c9',
  textInverse: '#ffffff',
  fillPrimary: '#121212',
  scrim: '#00000033',
  statusWorking: '#2f6fd6',
  statusAttention: '#c0237a',
  statusAttentionBg: '#ff5fb01f',
  statusDone: '#1e8e5a',
  statusError: '#d23b3b',
  statusIdle: '#808080',
  diffAddFg: '#1e8e5a',
  diffAddBg: '#3dd68c1f',
  diffDelFg: '#d23b3b',
  diffDelBg: '#ff5c5c1f',
  termFg: '#121212'
}

export function useColors(): Colors {
  return useColorScheme() === 'light' ? light : dark
}

export const isDark = (c: Colors): boolean => c === dark

/** JetBrains Mono as loaded in _layout.tsx; the UI face is the system's (SF Pro, PingFang for CJK). */
export const MONO = 'JetBrainsMono_400Regular'
export const MONO_MEDIUM = 'JetBrainsMono_500Medium'

/** A text style: size, weight (400 / 500 / 600), mono or not, line height when the design sets one. */
export function font(size: number, weight: 400 | 500 | 600 = 400, mono = false, lineHeight?: number): TextStyle {
  if (mono) return { fontFamily: weight >= 500 ? MONO_MEDIUM : MONO, fontSize: size, ...(lineHeight ? { lineHeight } : {}) }
  return { fontSize: size, fontWeight: weight === 600 ? '600' : weight === 500 ? '500' : '400', ...(lineHeight ? { lineHeight } : {}) }
}
