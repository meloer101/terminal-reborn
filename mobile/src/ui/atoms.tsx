// The small parts every Figma 45 / 46′ screen is built from: glass, buttons, the nav bar, group headers, the bottom sheet.
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { router } from 'expo-router'
import { ChevronLeft, type LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { font, isDark, useColors } from './theme'

/** lucide at the project's stroke (CLAUDE.md: 1.75). */
export function Icon({ icon: Glyph, size = 16, color }: { icon: LucideIcon; size?: number; color: string }) {
  return <Glyph size={size} color={color} strokeWidth={1.75} />
}

/** iOS 26's Liquid Glass; below it the same shapes take Figma 46's solid fills. */
export const LIQUID = isLiquidGlassAvailable()

/**
 * Figma 46′: glass only on what floats over content. A control (back, 变更, +, the composer, an exit) is the clear
 * glass; a surface (sheet, menu) is tinted heavier so text on it reads. Shadows only in the light theme.
 */
export function Glass({ kind = 'control', interactive = false, style, children }: { kind?: 'control' | 'surface'; interactive?: boolean; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const c = useColors()
  const shadow = isDark(c) ? null : kind === 'surface' ? s.shadowSurface : s.shadowControl
  if (LIQUID) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} colorScheme={isDark(c) ? 'dark' : 'light'} tintColor={kind === 'surface' ? c.glassSurface : undefined} style={[shadow, style]}>
        {children}
      </GlassView>
    )
  }
  return <View style={[{ backgroundColor: kind === 'surface' ? c.bgRaised : c.bgSelected, borderColor: c.glassBorder, borderWidth: StyleSheet.hairlineWidth }, shadow, style]}>{children}</View>
}

/**
 * Figma 46′ scroll edge: content fades into the background where floating controls sit over it, instead of a bar.
 * The design also blurs what is under it; without that blur the top stays nearly opaque down to the bar's bottom
 * (`solid` of the height) so text never runs under the title, and fades out over the rest.
 */
export function ScrollEdge({ edge, height, solid = 0.62 }: { edge: 'top' | 'bottom'; height: number; solid?: number }) {
  const c = useColors()
  const stops = edge === 'top' ? [[0, 1], [solid / 2, 1], [solid, 0.92], [1, 0]] : [[0, 0], [0.5, 0.45], [1, 0.85]]
  return (
    <View pointerEvents="none" style={[s.edge, edge === 'top' ? { top: 0 } : { bottom: 0 }, { height }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`edge-${edge}`} x1="0" y1="0" x2="0" y2="1">
            {stops.map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={c.bgApp} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#edge-${edge})`} />
      </Svg>
    </View>
  )
}

/** Pressed feedback for what wraps a glass view: interactive glass answers the touch itself. */
const pressedOpacity = (pressed: boolean) => (pressed && !LIQUID ? 0.7 : 1)

/** A button; `floating` is one of 46I's exits over the file list: taller, rounder, the secondary ones glass. */
export function Button({
  label,
  onPress,
  primary,
  floating,
  disabled,
  busy,
  style
}: {
  label: string
  onPress: () => void
  primary?: boolean
  floating?: boolean
  disabled?: boolean
  busy?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const c = useColors()
  const content = busy ? <ActivityIndicator color={primary ? c.textInverse : c.textPrimary} /> : <Text style={[font(16, 500), { color: primary ? c.textInverse : c.textPrimary }]}>{label}</Text>
  if (floating && !primary) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [{ opacity: disabled ? 0.4 : pressedOpacity(pressed) }, style]}>
        <Glass interactive style={[s.button, s.floating]}>
          {content}
        </Glass>
      </Pressable>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.button, floating && s.floating, { backgroundColor: primary ? c.fillPrimary : c.bgSelected, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, style]}
    >
      {content}
    </Pressable>
  )
}

const NAV_HEIGHT = 44

/** Where content starts under a floating nav bar: the safe area, the bar and its margins. */
export function useNavInset(): number {
  return useSafeAreaInsets().top + 2 + NAV_HEIGHT + 8
}

/** A glass button of 46′'s nav row: a 44 circle, or a capsule when it holds more than an icon. */
export function GlassButton({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressedOpacity(pressed) })}>
      <Glass interactive style={s.round}>
        {children}
      </Glass>
    </Pressable>
  )
}

/**
 * 45C / 45D / 45I as redrawn in 46′: a glass back button, a centred title over a mono subtitle, something on the right.
 * `floating` lays it over the content with a scroll edge behind it (the screen then starts its content at useNavInset).
 */
export function NavBar({ title, subtitle, right, floating }: { title: string; subtitle?: ReactNode; right?: ReactNode; floating?: boolean }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const row = (
    <View pointerEvents="box-none" style={s.nav}>
      <GlassButton label="返回" onPress={() => router.back()}>
        <Icon icon={ChevronLeft} size={20} color={c.textPrimary} />
      </GlassButton>
      <View pointerEvents="none" style={s.navTitle}>
        <Text numberOfLines={1} style={[font(16, 500), { color: c.textPrimary }]}>
          {title}
        </Text>
        {subtitle}
      </View>
      <View style={s.navRight}>{right}</View>
    </View>
  )
  if (!floating) return row
  return (
    <View pointerEvents="box-none" style={[s.float, { paddingTop: insets.top }]}>
      <ScrollEdge edge="top" height={insets.top + 2 + NAV_HEIGHT + 32} solid={(insets.top + 2 + NAV_HEIGHT) / (insets.top + 2 + NAV_HEIGHT + 32)} />
      {row}
    </View>
  )
}

export function GroupHeader({ title, count }: { title: string; count: number }) {
  const c = useColors()
  return (
    <View style={s.group}>
      <Text style={[font(13, 500), { color: c.textSecondary }]}>{title}</Text>
      <Text style={[font(13, 400, true), { color: c.textTertiary }]}>{count}</Text>
    </View>
  )
}

/** 45E / 45F / 45H / 45J as 46′ draws them: a glass sheet inset from the edges, over a scrim; taps on the scrim close it. */
export function Sheet({ visible, onClose, children, padded = true }: { visible: boolean; onClose: () => void; children: ReactNode; padded?: boolean }) {
  const c = useColors()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={s.sheetRoot}>
        <Pressable accessibilityLabel="关闭" style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={onClose} />
        <Glass kind="surface" style={[s.sheet, padded && s.sheetPadded]}>
          <View style={s.grabber}>
            <View style={[s.grabberBar, { backgroundColor: c.borderStrong }]} />
          </View>
          {children}
        </Glass>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** A screen's background with the safe area on top (unless a floating nav bar keeps it) and at the bottom (unless the screen keeps it for a composer). */
export function Screen({ children, top = true, bottom = true }: { children: ReactNode; top?: boolean; bottom?: boolean }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  return <View style={{ flex: 1, backgroundColor: c.bgApp, paddingTop: top ? insets.top : 0, paddingBottom: bottom ? insets.bottom : 0 }}>{children}</View>
}

const s = StyleSheet.create({
  shadowControl: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  shadowSurface: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  edge: { position: 'absolute', left: 0, right: 0 },
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, minHeight: 50 },
  floating: { paddingVertical: 16, borderRadius: 24, minHeight: 52 },
  round: { minWidth: NAV_HEIGHT, height: NAV_HEIGHT, borderRadius: NAV_HEIGHT / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  float: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8 },
  navTitle: { flex: 1, alignItems: 'center', gap: 2, minWidth: 0 },
  navRight: { minWidth: NAV_HEIGHT, alignItems: 'flex-end' },
  group: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { marginHorizontal: 8, marginBottom: 8, maxHeight: '92%', borderRadius: 34, paddingTop: 8, paddingBottom: 24, gap: 16 },
  sheetPadded: { paddingHorizontal: 20 },
  grabber: { alignItems: 'center' },
  grabberBar: { width: 36, height: 5, borderRadius: 3 }
})
