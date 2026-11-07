// The phone's tokens (Figma 「手机 · iOS」 section 59, the Mobile and Mobile · Layout variables): neutrals are black or
// white with an alpha (OpenAI Style, the author's design-system file), so they read on glass; the colours that mean
// something (status, diff) come from the desktop's tokens.css through Resources/Shared.json, so a status reads the same
// on phone and Mac. Type follows the iOS text styles and Dynamic Type (the system face, PingFang for CJK); JetBrains Mono
// for code, paths and counts scales with them. Icons are the desktop's lucide set.
import SwiftUI

extension Color {
  /// One token, its dark and light values.
  fileprivate static func token(_ dark: UInt32, _ light: UInt32, alpha darkAlpha: Double = 1, _ lightAlpha: Double = 1) -> Color {
    Color(uiColor: UIColor { trait in
      let (rgb, a) = trait.userInterfaceStyle == .dark ? (dark, darkAlpha) : (light, lightAlpha)
      return UIColor(red: CGFloat(rgb >> 16 & 0xff) / 255, green: CGFloat(rgb >> 8 & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: a)
    })
  }

  /// A colour from Shared.json (`#rrggbb` or `#rrggbbaa` per theme).
  fileprivate static func shared(_ name: String) -> Color {
    guard let pair = Shared.data.colors[name] else { fatalError("Shared.json has no colour \(name): run the phone-assets test with WAVI_WRITE_PHONE_ASSETS=1") }
    let dark = UIColor(hex: pair.dark), light = UIColor(hex: pair.light)
    return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
  }

  // Surfaces
  static let bgApp = token(0x000000, 0xffffff)
  /// Inset code blocks, grouped lists and form groups.
  static let bgGrouped = token(0x222222, 0xededed)
  /// Sheets, menus and alerts; also the opaque stand-in for glass under Reduce Transparency.
  static let bgSheet = token(0x1a1a1a, 0xffffff)
  static let fillSubtle = token(0xffffff, 0x000000, alpha: 0.04, 0.04)
  /// Secondary buttons, the selected segment.
  static let fillStrong = token(0xffffff, 0x000000, alpha: 0.11, 0.08)
  // Lines
  static let hairline = token(0xffffff, 0x000000, alpha: 0.07, 0.08)
  static let lineStrong = token(0xffffff, 0x000000, alpha: 0.44, 0.44)
  // Text: three roles, and icons are never grey (they take textPrimary unless they belong to a secondary line)
  static let textPrimary = token(0xffffff, 0x000000)
  static let textSecondary = token(0xffffff, 0x000000, alpha: 0.6, 0.6)
  /// Placeholders and disabled text only.
  static let textHint = token(0xffffff, 0x000000, alpha: 0.44, 0.44)
  // The primary button
  static let solidFill = token(0xffffff, 0x000000)
  static let solidOn = token(0x000000, 0xffffff)
  static let link = token(0x5ea1ff, 0x2f6fd6)
  static let scrim = token(0x000000, 0x000000, alpha: 0.75, 0.35)
  // Notices that are not a session status (connection, pairing, send failures): always with words
  static let noticeInfo = token(0x5ea1ff, 0x2f6fd6)
  static let noticeInfoTint = token(0x5ea1ff, 0x5ea1ff, alpha: 0.12, 0.12)
  static let noticeSuccess = token(0x3dd68c, 0x1e8e5a)
  static let noticeSuccessTint = token(0x3dd68c, 0x3dd68c, alpha: 0.12, 0.12)
  static let noticeWarning = token(0xffb224, 0xb86e00)
  static let noticeWarningTint = token(0xffb224, 0xffb224, alpha: 0.12, 0.12)
  static let noticeDanger = token(0xff5c5c, 0xd23b3b)
  static let noticeDangerTint = token(0xff5c5c, 0xff5c5c, alpha: 0.12, 0.12)
  // Status and diff: the desktop's values
  static let statusWorking = shared("status-working")
  static let statusAttention = shared("status-attention")
  static let statusAttentionBg = shared("status-attention-bg")
  static let statusDone = shared("status-done")
  static let statusError = shared("status-error")
  static let statusIdle = shared("status-idle")
  static let diffAddFg = shared("diff-add-fg")
  static let diffAddBg = shared("diff-add-bg")
  static let diffDelFg = shared("diff-del-fg")
  static let diffDelBg = shared("diff-del-bg")
  /// The Live Activity's Lock Screen card and its quiet buttons (Figma 47D / 47E; the island is always black).
  static let activityBackground = token(0x141414, 0xffffff, alpha: 0.82, 0.8)
  static let activityButton = token(0xffffff, 0x000000, alpha: 0.14, 0.06)
}

extension UIColor {
  /// `#rrggbb` or `#rrggbbaa`.
  convenience init(hex: String) {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    let value = UInt64(digits, radix: 16) ?? 0
    let hasAlpha = digits.count == 8
    let rgb = hasAlpha ? value >> 8 : value
    self.init(red: CGFloat(rgb >> 16 & 0xff) / 255, green: CGFloat(rgb >> 8 & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: hasAlpha ? CGFloat(value & 0xff) / 255 : 1)
  }
}

/// Spacing, radii and sizes (Mobile · Layout). Spacing is on the 4 grid.
enum Metric {
  static let margin: CGFloat = 16
  /// Controls and inset blocks: notices, code, fields, thumbnails.
  static let radiusControl: CGFloat = 10
  /// Groups: form groups, option lists, menus.
  static let radiusGroup: CGFloat = 16
  /// The composer and rows that float over content.
  static let radiusField: CGFloat = 22
  /// Sheets: concentric with the screen corner, 8 from the edge.
  static let radiusSheetTop: CGFloat = 34
  static let radiusSheetBottom: CGFloat = 54
  static let touch: CGFloat = 44
  static let control: CGFloat = 50
}

/// The iOS text styles at the weights the design uses (400 and 500 only): sizes follow Dynamic Type.
enum TypeStyle {
  case largeTitle, title2, title3, headline, body, callout, subheadline, footnote, caption, caption2

  fileprivate var system: Font.TextStyle {
    switch self {
    case .largeTitle: .largeTitle
    case .title2: .title2
    case .title3: .title3
    case .headline: .headline
    case .body: .body
    case .callout: .callout
    case .subheadline: .subheadline
    case .footnote: .footnote
    case .caption: .caption
    case .caption2: .caption2
    }
  }
}

extension Font {
  /// The UI face for a text style; titles and the headline are medium, the rest regular unless asked.
  static func ui(_ style: TypeStyle, medium: Bool = false) -> Font {
    let heavy: Bool = switch style {
    case .largeTitle, .title2, .title3, .headline: true
    default: medium
    }
    return .system(style.system, weight: heavy ? .medium : .regular)
  }

  /// A fixed size, for marks drawn inside a fixed box (an agent's letter, the island's counters).
  static func fixed(_ size: CGFloat, medium: Bool = false) -> Font { .system(size: size, weight: medium ? .medium : .regular) }

  /// JetBrains Mono (Resources/Fonts, OFL): `.footnote` size for commands and code, `.caption` for paths and counts.
  static func mono(_ style: TypeStyle = .footnote, medium: Bool = false) -> Font {
    let size: CGFloat = switch style {
    case .caption, .caption2: 12
    case .subheadline, .callout, .body: 15
    case .title3, .title2, .largeTitle, .headline: 20
    default: 13
    }
    return .custom(medium ? "JetBrainsMono-Medium" : "JetBrainsMono-Regular", size: size, relativeTo: style.system)
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

/// The system glass for what floats over content (输入框, 出口, the pending-prompt row); an opaque sheet surface with a
/// hairline when Reduce Transparency is on.
private struct GlassSurface: ViewModifier {
  let radius: CGFloat
  let interactive: Bool
  @Environment(\.accessibilityReduceTransparency) private var reduce

  func body(content: Content) -> some View {
    if reduce {
      content
        .background(Color.bgSheet, in: RoundedRectangle(cornerRadius: radius))
        .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Color.hairline))
    } else {
      content.glassEffect(interactive ? .regular.interactive() : .regular, in: .rect(cornerRadius: radius))
    }
  }
}

extension View {
  func glass(_ radius: CGFloat, interactive: Bool = false) -> some View { modifier(GlassSurface(radius: radius, interactive: interactive)) }
}
