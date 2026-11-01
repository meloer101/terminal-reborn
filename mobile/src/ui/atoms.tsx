// The small parts every Figma 45 screen is built from: buttons, the nav bar, group headers, the bottom sheet.
import { router } from 'expo-router'
import { ChevronLeft, type LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, useColors } from './theme'

/** lucide at the project's stroke (CLAUDE.md: 1.75). */
export function Icon({ icon: Glyph, size = 16, color }: { icon: LucideIcon; size?: number; color: string }) {
  return <Glyph size={size} color={color} strokeWidth={1.75} />
}

export function Button({ label, onPress, primary, disabled, busy, style }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.button, { backgroundColor: primary ? c.fillPrimary : c.bgSelected, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={primary ? c.textInverse : c.textPrimary} /> : <Text style={[font(16, 500), { color: primary ? c.textInverse : c.textPrimary }]}>{label}</Text>}
    </Pressable>
  )
}

/** 45C / 45D / 45I: back, a centred title over a mono subtitle, something on the right. */
export function NavBar({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  const c = useColors()
  return (
    <View style={s.nav}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回" hitSlop={8} onPress={() => router.back()} style={s.navBack}>
        <Icon icon={ChevronLeft} size={24} color={c.textPrimary} />
      </Pressable>
      <View style={s.navTitle}>
        <Text numberOfLines={1} style={[font(16, 500), { color: c.textPrimary }]}>
          {title}
        </Text>
        {subtitle}
      </View>
      <View style={s.navRight}>{right}</View>
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

/** 45E / 45F / 45H / 45J: slides up over a scrim; the grabber and the raised fill; taps on the scrim close it. */
export function Sheet({ visible, onClose, children, padded = true }: { visible: boolean; onClose: () => void; children: ReactNode; padded?: boolean }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={s.sheetRoot}>
        <Pressable accessibilityLabel="关闭" style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={onClose} />
        <View style={[s.sheet, padded && s.sheetPadded, { backgroundColor: c.bgRaised, paddingBottom: Math.max(insets.bottom, 16) + 8, maxHeight: '92%' }]}>
          <View style={s.grabber}>
            <View style={[s.grabberBar, { backgroundColor: c.borderStrong }]} />
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** A screen's background with the safe area on top (and at the bottom unless the screen keeps it for a composer). */
export function Screen({ children, bottom = true }: { children: ReactNode; bottom?: boolean }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  return <View style={{ flex: 1, backgroundColor: c.bgApp, paddingTop: insets.top, paddingBottom: bottom ? insets.bottom : 0 }}>{children}</View>
}

const s = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, minHeight: 50 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingRight: 12, paddingTop: 6, paddingBottom: 10 },
  navBack: { padding: 8 },
  navTitle: { flex: 1, alignItems: 'center', gap: 2, minWidth: 0 },
  navRight: { minWidth: 40, alignItems: 'flex-end' },
  group: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, gap: 16 },
  sheetPadded: { paddingHorizontal: 20 },
  grabber: { alignItems: 'center' },
  grabberBar: { width: 36, height: 5, borderRadius: 3 }
})
