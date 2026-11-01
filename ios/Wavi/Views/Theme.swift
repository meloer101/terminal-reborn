// The phone's tokens: the desktop's src/renderer/styles/tokens.css values (Figma variables, both themes) that the
// Figma 45 / 46′ screens use, so the two apps stay one system; light or dark follows the phone. Type is the system's
// (SF Pro, PingFang for CJK) with JetBrains Mono for code, paths and counts. Icons are the desktop's lucide set.
import SwiftUI

extension Color {
  /// One token, its dark and light values.
  fileprivate static func token(_ dark: UInt32, _ light: UInt32, alpha darkAlpha: Double = 1, _ lightAlpha: Double = 1) -> Color {
    Color(uiColor: UIColor { trait in
      let (rgb, a) = trait.userInterfaceStyle == .dark ? (dark, darkAlpha) : (light, lightAlpha)
      return UIColor(red: CGFloat(rgb >> 16 & 0xff) / 255, green: CGFloat(rgb >> 8 & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: a)
    })
  }

  static let bgApp = token(0x0a0a0a, 0xffffff)
  static let bgRaised = token(0x161616, 0xffffff)
  static let bgInset = token(0x050505, 0xfafafa)
  static let bgHover = token(0xffffff, 0x000000, alpha: 0.04, 0.04)
  static let bgSelected = token(0xffffff, 0x000000, alpha: 0.07, 0.08)
  static let borderSubtle = token(0xffffff, 0x000000, alpha: 0.07, 0.08)
  static let borderStrong = token(0xffffff, 0x000000, alpha: 0.18, 0.2)
  static let textPrimary = token(0xededed, 0x121212)
  static let textSecondary = token(0xa1a1a1, 0x474747)
  static let textTertiary = token(0x808080, 0x808080)
  static let textDisabled = token(0x474747, 0xc9c9c9)
  static let textInverse = token(0x0a0a0a, 0xffffff)
  static let fillPrimary = token(0xededed, 0x121212)
  static let statusWorking = token(0x5ea1ff, 0x2f6fd6)
  static let statusAttention = token(0xff5fb0, 0xc0237a)
  static let statusAttentionBg = token(0xff5fb0, 0xff5fb0, alpha: 0.12, 0.12)
  static let statusDone = token(0x3dd68c, 0x1e8e5a)
  static let statusError = token(0xff5c5c, 0xd23b3b)
  static let statusIdle = token(0x6b6b6b, 0x808080)
  static let diffAddFg = token(0x3dd68c, 0x1e8e5a)
  static let diffAddBg = token(0x3dd68c, 0x3dd68c, alpha: 0.12, 0.12)
  static let diffDelFg = token(0xff5c5c, 0xd23b3b)
  static let diffDelBg = token(0xff5c5c, 0xff5c5c, alpha: 0.12, 0.12)
  static let termFg = token(0xe5e5e5, 0x121212)
}

extension Font {
  /// The UI face at a size and weight (400 / 500 / 600).
  static func ui(_ size: CGFloat, _ weight: Int = 400) -> Font {
    .system(size: size, weight: weight >= 600 ? .semibold : weight >= 500 ? .medium : .regular)
  }

  /// JetBrains Mono (Resources/Fonts, OFL).
  static func mono(_ size: CGFloat, _ weight: Int = 400) -> Font {
    .custom(weight >= 500 ? "JetBrainsMono-Medium" : "JetBrainsMono-Regular", fixedSize: size)
  }
}

/// A lucide icon at the desktop's stroke, in the colour of the text around it.
struct Icon: View {
  let name: String
  var size: CGFloat = 16

  init(_ name: String, size: CGFloat = 16) {
    self.name = name
    self.size = size
  }

  var body: some View {
    Image("Lucide/\(name)").resizable().renderingMode(.template).frame(width: size, height: size).accessibilityHidden(true)
  }
}

/// The 46′ glass for what floats over content (输入框, 出口); sheets and toolbars get theirs from the system.
extension View {
  func glass(_ radius: CGFloat, interactive: Bool = false) -> some View {
    glassEffect(interactive ? .regular.interactive() : .regular, in: .rect(cornerRadius: radius))
  }
}
