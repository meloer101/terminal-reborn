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
      // Never cut: in a sheet at its full height the actions are not squeezed, the content above them scrolls.
      Text(message).font(.ui(.subheadline, medium: true)).foregroundStyle(colors.0).fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let action, let perform {
        Button(action, action: perform).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary).buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 12)
    .background(colors.1, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
  }
}

/// Buttons side by side, or one above the other once the text is too big for them side by side (accessibility sizes).
struct ButtonRow<Content: View>: View {
  @ViewBuilder let content: Content
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
    layout { content }
  }
}

/// A Markdown table: columns as wide as their text, between 48 and 220 (a longer cell wraps), the whole table
/// scrolling sideways when it is wider than the reply.
private struct MarkdownTable: View {
  let header: [String]
  let rows: [[String]]
  let inline: (String) -> Text

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 0) {
        GridRow { ForEach(Array(header.enumerated()), id: \.offset) { _, cell in self.cell(cell, header: true) } }
        Rectangle().fill(Color.lineStrong).frame(height: 1).gridCellUnsizedAxes(.horizontal)
        ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
          GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, cell in self.cell(cell, header: false) } }
          if index < rows.count - 1 { Rectangle().fill(Color.hairline).frame(height: 1).gridCellUnsizedAxes(.horizontal) }
        }
      }
    }
  }

  private func cell(_ text: String, header: Bool) -> some View {
    inline(text).font(.ui(.subheadline, medium: header)).foregroundStyle(Color.textPrimary)
      .fixedSize(horizontal: false, vertical: true)
      .frame(minWidth: 48, maxWidth: 220, alignment: .leading)
      .padding(.vertical, 6)
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

/// One block of an agent's Markdown reply.
enum MarkdownBlock: Hashable {
  case paragraph(String), heading(String), item(marker: String, text: String), quote(String), code(String)
  /// A GitHub table: the header's cells, then each row's (padded or cut to the header's count).
  case table(header: [String], rows: [[String]])
}

/// `| a | b |` → ["a", "b"]; an escaped `\|` stays in its cell.
func tableCells(_ line: String) -> [String] {
  var body = line.trimmingCharacters(in: .whitespaces)
  if body.hasPrefix("|") { body.removeFirst() }
  if body.hasSuffix("|") && !body.hasSuffix("\\|") { body.removeLast() }
  var cells: [String] = []
  var cell = ""
  var escaped = false
  for ch in body {
    if escaped { cell.append(ch); escaped = false } else if ch == "\\" { escaped = true } else if ch == "|" { cells.append(cell); cell = "" } else { cell.append(ch) }
  }
  cells.append(cell)
  return cells.map { $0.trimmingCharacters(in: .whitespaces) }
}

private func isTableDivider(_ line: String) -> Bool {
  line.wholeMatch(of: /\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*/) != nil
}

/// Paragraphs, headings, lists, quotes, fenced code and tables, line by line.
func markdownBlocks(_ text: String) -> [MarkdownBlock] {
  var out: [MarkdownBlock] = []
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
    } else if trimmed.contains("|"), i + 1 < lines.count, isTableDivider(lines[i + 1]) {
      flush()
      let header = tableCells(line)
      var rows: [[String]] = []
      i += 2
      while i < lines.count, lines[i].contains("|"), !lines[i].trimmingCharacters(in: .whitespaces).isEmpty {
        let cells = tableCells(lines[i])
        rows.append(Array((cells + Array(repeating: "", count: header.count)).prefix(header.count)))
        i += 1
      }
      out.append(.table(header: header, rows: rows))
      continue
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

/// The agent's replies are Markdown (PRD F22 会话页): paragraphs, headings, lists, quotes, fenced code (scrolls
/// sideways) and tables (Figma 64A: header in medium, a hairline under each row, the whole table scrolls sideways
/// when wider than the screen); inside a line the system's inline Markdown (code, bold, italics, links).
struct MarkdownText: View {
  let text: String

  private var blocks: [MarkdownBlock] { markdownBlocks(text) }

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
        case .table(let header, let rows):
          MarkdownTable(header: header, rows: rows, inline: inline)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .tint(Color.textPrimary)
  }
}
