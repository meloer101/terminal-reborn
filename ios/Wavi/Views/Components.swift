// Buttons and Markdown, the pieces several screens share.
import SwiftUI

/// Figma 45 / 46′ buttons: primary is the solid fill, the others the selected fill (inside a sheet) or glass when they
/// float over content (46I's exits).
struct WaviButtonStyle: ButtonStyle {
  var primary = false
  var floating = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    let radius: CGFloat = floating ? 24 : 12
    let label = configuration.label
      .font(.ui(16, 500))
      .foregroundStyle(primary ? Color.textInverse : Color.textPrimary)
      .frame(maxWidth: .infinity, minHeight: floating ? 52 : 50)
      .contentShape(Rectangle())
    Group {
      if primary {
        label.background(Color.fillPrimary, in: RoundedRectangle(cornerRadius: radius))
      } else if floating {
        label.glass(radius, interactive: true)
      } else {
        label.background(Color.bgSelected, in: RoundedRectangle(cornerRadius: radius))
      }
    }
    .opacity(!enabled ? 0.4 : configuration.isPressed && (primary || !floating) ? 0.7 : 1)
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
        case .paragraph(let t): inline(t).font(.ui(16)).lineSpacing(5).foregroundStyle(Color.textPrimary)
        case .heading(let t): inline(t).font(.ui(16, 600)).foregroundStyle(Color.textPrimary)
        case .item(let marker, let t):
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(marker).font(.ui(16)).foregroundStyle(Color.textSecondary).frame(minWidth: 14, alignment: .leading)
            inline(t).font(.ui(16)).lineSpacing(5).foregroundStyle(Color.textPrimary)
          }
        case .quote(let t):
          inline(t).font(.ui(16)).foregroundStyle(Color.textSecondary).padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(Color.borderStrong).frame(width: 2) }
        case .code(let t):
          ScrollView(.horizontal, showsIndicators: false) {
            Text(t).font(.mono(12)).lineSpacing(4).foregroundStyle(Color.termFg).padding(12).textSelection(.enabled)
          }
          .background(Color.bgInset, in: RoundedRectangle(cornerRadius: 8))
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .tint(Color.textPrimary)
  }
}
