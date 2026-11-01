// The input under a conversation (Figma 45C, 45G): photos from the camera or the library (up to six), the text field,
// and one round button — send when there is something to send, stop (Esc) while the agent runs. In 46′ it is one glass
// capsule floating over the feed; the photos sit above it. Photos are drawn again
// as JPEG on the phone before they go: that drops their EXIF, location included, which the agent would otherwise read.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { ArrowUp, Camera, Image as ImageIcon, Square, X } from 'lucide-react-native'
import { useRef, useState, type ComponentRef } from 'react'
import { Dimensions, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { REMOTE_LIMITS, type RemotePhoto } from '../../../src/shared/remote'
import { call } from '../state/store'
import { Glass, Icon } from '../ui/atoms'
import { font, useColors } from '../ui/theme'

interface Picked extends RemotePhoto {
  uri: string
}

const PICK: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 }
/** Long edge of what is sent: plenty for an agent to read a screenshot, and six of them stay a few MB to seal and send. */
const MAX_EDGE = 2048

async function picked(result: ImagePicker.ImagePickerResult): Promise<Picked[]> {
  if (result.canceled) return []
  return Promise.all(
    result.assets.map(async (a, i) => {
      const context = ImageManipulator.manipulate(a.uri)
      if (Math.max(a.width, a.height) > MAX_EDGE) context.resize(a.width >= a.height ? { width: MAX_EDGE } : { height: MAX_EDGE })
      const image = await context.renderAsync()
      const jpeg = await image.saveAsync({ base64: true, compress: 0.85, format: SaveFormat.JPEG })
      const name = (a.fileName ?? `photo-${Date.now()}-${i}`).replace(/\.[^.]*$/, '') + '.jpg'
      return { uri: jpeg.uri, name, data: jpeg.base64 ?? '' }
    })
  ).then((list) => list.filter((p) => p.data))
}

export function Composer({ session, running, onHeight }: { session: string; running: boolean; onHeight: (height: number) => void }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<Picked[]>([])
  const [menu, setMenu] = useState(false)
  /** Where the menu's bottom edge goes: just above the composer (measured when it opens). */
  const [menuBottom, setMenuBottom] = useState(0)
  const root = useRef<ComponentRef<typeof View>>(null)
  /** What to open once the menu is gone: iOS will not present the picker while the menu's modal is still closing. */
  const next = useRef<(() => Promise<void>) | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSend = (text.trim() !== '' || photos.length > 0) && !sending

  const add = (more: Picked[]) => {
    const tooBig = more.some((p) => (p.data.length * 3) / 4 > REMOTE_LIMITS.photoBytes)
    setError(tooBig ? '有照片超过 10 MB，没有加上' : null)
    setPhotos((list) => [...list, ...more.filter((p) => (p.data.length * 3) / 4 <= REMOTE_LIMITS.photoBytes)].slice(0, REMOTE_LIMITS.photos))
  }

  const fromLibrary = async () => {
    add(await picked(await ImagePicker.launchImageLibraryAsync({ ...PICK, allowsMultipleSelection: true, selectionLimit: REMOTE_LIMITS.photos - photos.length })))
  }

  const fromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      setError('没有相机权限，在设置里允许')
      return
    }
    add(await picked(await ImagePicker.launchCameraAsync(PICK)))
  }

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    const result = await call({ type: 'send', session, text, photos: photos.map(({ name, data }) => ({ name, data })) })
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setText('')
    setPhotos([])
  }

  const stop = async () => {
    const result = await call({ type: 'interrupt', session })
    if (!result.ok) setError(result.error)
  }

  const choose = (open: () => Promise<void>) => {
    next.current = open
    setMenu(false)
  }

  const menuClosed = () => {
    const open = next.current
    next.current = null
    if (open) open().catch((e: unknown) => setError(e instanceof Error ? e.message : '没能打开照片'))
  }

  const openMenu = () =>
    root.current?.measureInWindow((_x, y) => {
      setMenuBottom(Dimensions.get('window').height - y + 8)
      setMenu(true)
    })

  const action = canSend || !running ? 'send' : 'stop'
  return (
    <View ref={root} onLayout={(e) => onHeight(e.nativeEvent.layout.height)} style={[s.root, { paddingBottom: insets.bottom + 4 }]}>
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)} onDismiss={menuClosed}>
        <Pressable accessibilityLabel="关闭" style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} />
        <Glass kind="surface" style={[s.menu, { bottom: menuBottom }]}>
          <Pressable style={s.menuItem} onPress={() => choose(fromCamera)}>
            <Icon icon={Camera} size={20} color={c.textPrimary} />
            <Text style={[font(16), { color: c.textPrimary }]}>拍照</Text>
          </Pressable>
          <Pressable style={s.menuItem} onPress={() => choose(fromLibrary)}>
            <Icon icon={ImageIcon} size={20} color={c.textPrimary} />
            <Text style={[font(16), { color: c.textPrimary }]}>照片</Text>
          </Pressable>
        </Glass>
      </Modal>
      {error ? <Text style={[font(13), s.error, { color: c.statusError }]}>{error}</Text> : null}
      {photos.length ? (
        <View style={s.photos}>
          {photos.map((p, i) => (
            <View key={`${p.uri}-${i}`} style={[s.photo, { backgroundColor: c.bgSelected }]}>
              <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} />
              <Pressable accessibilityLabel="移除照片" hitSlop={6} onPress={() => setPhotos((list) => list.filter((_, j) => j !== i))} style={[s.remove, { backgroundColor: c.bgApp }]}>
                <Icon icon={X} size={12} color={c.textPrimary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Glass style={s.bar}>
        <Pressable
          accessibilityLabel="加照片"
          disabled={photos.length >= REMOTE_LIMITS.photos}
          onPress={openMenu}
          style={[s.attach, menu && { backgroundColor: c.bgSelected }, photos.length >= REMOTE_LIMITS.photos && { opacity: 0.4 }]}
        >
          <Icon icon={ImageIcon} size={22} color={c.textSecondary} />
        </Pressable>
        <View style={s.field}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="回复…"
            placeholderTextColor={c.textTertiary}
            multiline
            style={[font(16, 400, false, 22), s.input, { color: c.textPrimary }]}
          />
        </View>
        <Pressable
          accessibilityLabel={action === 'send' ? '发送' : '停止'}
          disabled={action === 'send' && !canSend}
          onPress={action === 'send' ? send : stop}
          style={[s.round, { backgroundColor: c.fillPrimary }, action === 'send' && !canSend && { opacity: 0.3 }]}
        >
          <Icon icon={action === 'send' ? ArrowUp : Square} size={22} color={c.textInverse} />
        </Pressable>
      </Glass>
    </View>
  )
}

const s = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 8 },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 28 },
  attach: { padding: 8, marginBottom: 5, borderRadius: 18 },
  field: { flex: 1, paddingLeft: 8, paddingRight: 16, paddingVertical: 12, minHeight: 46, justifyContent: 'center' },
  input: { maxHeight: 132, paddingTop: 0, paddingBottom: 0 },
  round: { padding: 9, marginBottom: 3, borderRadius: 20 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
  remove: { position: 'absolute', top: 4, right: 4, padding: 3, borderRadius: 10 },
  menu: { position: 'absolute', left: 12, width: 208, borderRadius: 22, paddingVertical: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  error: { paddingLeft: 16 }
})
