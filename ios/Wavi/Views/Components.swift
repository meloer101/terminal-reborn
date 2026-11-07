// Buttons, notices, empty states and Markdown: the pieces several screens share (Figma 59 Mobile/Button, Mobile/Notice,
// Mobile/EmptyState).
import SwiftUI

/// Capsule buttons, 50 high (Figma 59 Mobile/Button): primary is the solid fill, the others fill/strong inside a sheet,
/// or glass when they float over content (Git · 变更's exits). Disabled at 40%; a press scales down a little.
struct WaviButtonStyle: ButtonStyle {
  var primary = false
  var floating = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    let label = configuration.label
      .font(.ui(.callout, medium: true))
      .foregroundStyle(primary ? Color.solidOn : Color.textPrimary)
      .padding(.horizontal, Metric.margin)
      .frame(maxWidth: .infinity, minHeight: Metric.control)
      .contentShape(Capsule())
    Group {
      if primary {
        label.background(Color.solidFill, in: Capsule())
      } else if floating {
        label.glass(Metric.control / 2, interactive: true)
      } else {
        label.background(Color.fillStrong, in: Capsule())
      }
    }
    .opacity(enabled ? 1 : 0.4)
    .scaleEffect(configuration.isPressed && enabled ? 0.98 : 1)
    .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}

/// A notice that is not a session status (connection, stale data, send failures, pairing): a tinted band with a whole
/// sentence in the notice colour, and an optional action in the text colour (Figma 59 Mobile/Notice).
struct Notice: View {
  enum Tone { case info, success, warning, danger }
  let tone: Tone
  let message: String
  var action: String?
  var perform: (() -> Void)?

  private var colors: (Color, Color) {
    switch tone {
    case .info: (.noticeInfo, .noticeInfoTint)
    case .success: (.noticeSuccess, .noticeSuccessTint)
    case .warning: (.noticeWarning, .noticeWarningTint)
    case .danger: (.noticeDanger, .noticeDangerTint)
    }
  }

  var body: some View {
    HStack(spacing: 8) {
      Text(message).font(.ui(.subheadline, medium: true)).foregroundStyle(colors.0).frame(maxWidth: .infinity, alignment: .leading)
      if let action, let perform {
        Button(action, action: perform).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary).buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 12)
    .background(colors.1, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
  }
}

/// An empty or blocked screen: one sentence of what is true and one way forward, no grey caption (Figma 59
/// Mobile/EmptyState, 63B2 / 63C4 / 63E2).
struct EmptyState: View {
  let title: String
  var action: String?
  var perform: (() -> Void)?

  var body: some View {
    VStack(spacing: 16) {
      Text(title).font(.ui(.title3)).foregroundStyle(Color.textPrimary).multilineTextAlignment(.center)
      if let action, let perform {
        Button(action, action: perform).buttonStyle(.wavi).fixedSize()
      }
    }
    .padding(.horizontal, 32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

extension ButtonStyle where Self == WaviButtonStyle {
  static var wavi: WaviButtonStyle { WaviButtonStyle() }
  static func wavi(primary: Bool = false, floating: Bool = false) -> WaviButtonStyle { WaviButtonStyle(primary: primary, floating: floating) }
}

/// The agent's replies are Markdown (PRD F22 会话页): paragraphs, headings, lists, quotes and fenced code (scrolls
/// sideways); inside a line the system's inline Markdown (code, bold, italics, links).
struct MarkdownText: View {
  let text: String

  private enum Block: Hashable {
    case paragraph(String), heading(String), item(marker: String, text: String), quote(String), code(String)
  }

  private var blocks: [Block] {
    var out: [Block] = []
    var paragraph: [String] = []
    func flush() {
      if !paragraph.isEmpty { out.append(.paragraph(paragraph.joined(separator: "\n"))) }
      paragraph = []
    }
    let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    var i = 0
    while i < lines.count {
      let line = lines[i]
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
        flush()
        let fence = String(trimmed.prefix(3))
        var code: [String] = []
        i += 1
        while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
          code.append(lines[i])
          i += 1
        }
        out.append(.code(code.joined(separator: "\n")))
      } else if trimmed.isEmpty {
        flush()
      } else if let m = line.wholeMatch(of: /#{1,6}\s+(.*)/) {
        flush()
        out.append(.heading(String(m.1)))
      } else if let m = line.wholeMatch(of: /\s*([-*+]|\d+[.)])\s+(.*)/) {
        flush()
        let marker = String(m.1)
        out.append(.item(marker: marker.first?.isNumber == true ? marker : "•", text: String(m.2)))
      } else if let m = line.wholeMatch(of: />\s?(.*)/) {
        flush()
        out.append(.quote(String(m.1)))
      } else {
        paragraph.append(line)
      }
      i += 1
    }
    flush()
    return out
  }

  private func inline(_ text: String) -> Text {
    let attributed = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    return Text(attributed)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        switch block {
        case .paragraph(let t): inline(t).font(.ui(.callout)).lineSpacing(5).foregroundStyle(Color.textPrimary)
        case .heading(let t): inline(t).font(.ui(.callout, medium: true)).foregroundStyle(Color.textPrimary)
        case .item(let marker, let t):
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(marker).font(.ui(.callout)).foregroundStyle(Color.textSecondary).frame(minWidth: 14, alignment: .leading)
            inline(t).font(.ui(.callout)).lineSpacing(5).foregroundStyle(Color.textPrimary)
          }
        case .quote(let t):
          inline(t).font(.ui(.callout)).foregroundStyle(Color.textSecondary).padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(Color.lineStrong).frame(width: 2) }
        case .code(let t):
          ScrollView(.horizontal, showsIndicators: false) {
            Text(t).font(.mono(.caption)).lineSpacing(4).foregroundStyle(Color.textPrimary).padding(12).textSelection(.enabled)
          }
          .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .tint(Color.textPrimary)
  }
}
