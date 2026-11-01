// The app's frame (PRD F22): fonts, the pairing from the Keychain, reconnecting when the app comes back to the
// foreground, and the screens. `wavi://pair?d=…` (the QR code scanned with the Camera app) opens /pair with it.
import '../polyfills'
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular'
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { init, useApp, wake } from '../state/store'
import { isDark, useColors } from '../ui/theme'

export default function Layout() {
  const c = useColors()
  const [fontsLoaded] = useFonts({ JetBrainsMono_400Regular, JetBrainsMono_500Medium })
  const ready = useApp((s) => s.ready)
  useEffect(() => {
    void init()
    const sub = AppState.addEventListener('change', (state) => state === 'active' && wake())
    return () => sub.remove()
  }, [])
  if (!fontsLoaded || !ready) return null
  return (
    <SafeAreaProvider>
      <StatusBar style={isDark(c) ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bgApp } }}>
        <Stack.Screen name="new" options={{ presentation: 'modal', contentStyle: { backgroundColor: c.bgRaised } }} />
      </Stack>
    </SafeAreaProvider>
  )
}
