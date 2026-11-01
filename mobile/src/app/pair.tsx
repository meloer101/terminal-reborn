// 首次打开 · 扫码配对 (Figma 45A): scan the QR code 设置 · 手机 shows on the Mac, or type its address and pairing code
// (the PAKE in protocol/crypto.ts brings the Mac's key then). A `wavi://pair?d=…` link opened from the Camera app lands
// here with `d` and pairs at once.
import { CameraView, useCameraPermissions } from 'expo-camera'
import Constants from 'expo-constants'
import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { DEFAULT_REMOTE_PORT, formatPairingCode } from '../../../src/shared/remote'
import { addressUrl, PairError, pairWithCode, pairWithOffer, parseOffer, type Pairing } from '../protocol/client'
import { adopt, useApp } from '../state/store'
import { Button, Screen, Sheet } from '../ui/atoms'
import { font, MONO, useColors } from '../ui/theme'

const phoneName = () => Constants.deviceName ?? 'iPhone'

function Viewfinder({ color }: { color: string }) {
  const corner = 'M2 40V18A16 16 0 0 1 18 2h22'
  return (
    <Svg width={220} height={220} viewBox="0 0 220 220" fill="none">
      {[0, 90, 180, 270].map((deg) => (
        <Path key={deg} d={corner} stroke={color} strokeWidth={3} strokeLinecap="round" transform={`rotate(${deg} 110 110)`} />
      ))}
    </Svg>
  )
}

export default function Pair() {
  const c = useColors()
  const { d } = useLocalSearchParams<{ d?: string }>()
  const [permission, requestPermission] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const handled = useRef<string | null>(null)

  const finish = useCallback(async (attempt: () => Promise<Pairing>) => {
    setBusy(true)
    setError(null)
    try {
      await adopt(await attempt())
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setTyping(false)
      router.replace('/')
    } catch (e) {
      setError(e instanceof PairError ? e.message : '配对没有成功')
    } finally {
      setBusy(false)
    }
  }, [])

  /** `fromLink`: opened from somewhere else (a message, a web page), so the user confirms which Mac first. */
  const scanned = useCallback(
    (data: string, fromLink = false) => {
      if (busy || handled.current === data) return
      handled.current = data
      const offer = parseOffer(data)
      if (!offer) {
        setError('这不是 Wavi 的配对二维码')
        return
      }
      const pair = () => void finish(() => pairWithOffer(offer, phoneName()))
      if (!fromLink) return pair()
      const current = useApp.getState().pairing
      const hosts = offer.urls.map((u) => u.replace(/^wss?:\/\//, '')).join('、')
      Alert.alert(
        `和「${offer.name}」配对？`,
        current ? `地址 ${hosts}。会替换现在配对的「${current.macName}」。` : `地址 ${hosts}。`,
        [
          { text: '取消', style: 'cancel', onPress: () => (current ? router.replace('/') : undefined) },
          { text: '配对', onPress: pair }
        ]
      )
    },
    [busy, finish]
  )

  useEffect(() => {
    if (d) scanned(`wavi://pair?d=${d}`, true)
  }, [d, scanned])

  const url = addressUrl(address, DEFAULT_REMOTE_PORT)
  const bare = code.toUpperCase().replace(/[^0-9A-Z]/g, '')

  return (
    <Screen>
      <View style={s.body}>
        <Text style={[font(28, 500), { color: c.textPrimary }]}>扫描 Mac 上的二维码</Text>
        <View style={[s.camera, { backgroundColor: c.bgInset }]}>
          {permission?.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy ? undefined : (r) => scanned(r.data)} />
          ) : null}
          {permission?.granted ? (
            <View pointerEvents="none" style={s.finder}>
              <Viewfinder color="#ffffff" />
            </View>
          ) : permission ? (
            <Button
              label={permission.canAskAgain ? '允许使用相机' : '在设置里允许使用相机'}
              onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
            />
          ) : null}
        </View>
        {busy && !typing ? <Text style={[font(15), s.note, { color: c.textSecondary }]}>正在配对…</Text> : null}
        {error && !typing ? <Text style={[font(15), s.note, { color: c.statusError }]}>{error}</Text> : null}
        <View style={{ flex: 1 }} />
        <Button label="输入配对码" onPress={() => (setError(null), setTyping(true))} />
      </View>

      <Sheet visible={typing} onClose={() => !busy && setTyping(false)}>
        <Text style={[font(20, 500), { color: c.textPrimary }]}>输入配对码</Text>
        <View style={s.fields}>
          <View style={s.field}>
            <Text style={[font(16), { color: c.textSecondary }]}>地址</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="100.101.1.2"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[s.input, { color: c.textPrimary, fontFamily: MONO }]}
            />
          </View>
          <View style={s.field}>
            <Text style={[font(16), { color: c.textSecondary }]}>配对码</Text>
            <TextInput
              value={bare.length === 6 ? formatPairingCode(bare) : code}
              onChangeText={setCode}
              placeholder="4KX-92Q"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              style={[s.input, { color: c.textPrimary, fontFamily: MONO }]}
            />
          </View>
        </View>
        {error ? <Text style={[font(15), { color: c.statusError }]}>{error}</Text> : null}
        <Button primary label="配对" busy={busy} disabled={!url || bare.length !== 6} onPress={() => url && void finish(() => pairWithCode(url, bare, phoneName()))} />
      </Sheet>
    </Screen>
  )
}

const s = StyleSheet.create({
  body: { flex: 1, paddingTop: 40, paddingHorizontal: 24, paddingBottom: 24, gap: 32 },
  camera: { width: '100%', aspectRatio: 1, borderRadius: 24, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  finder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  note: { marginTop: -16 },
  fields: { gap: 4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  input: { flex: 1, fontSize: 15, textAlign: 'right', paddingVertical: 0 }
})
