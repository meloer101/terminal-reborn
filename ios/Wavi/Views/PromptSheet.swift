// What the agent waits for, as a sheet over its conversation (Figma 59 Mobile/PromptSheet, 61C / 61D, 63D1–63D5, 63G3):
// a permission request or an AskUserQuestion. The answer goes back through the held hook (PRD §6.16), so the Mac
// terminal's dialog closes with it; answered in the terminal first, the prompt leaves the list Wavi pushes and the sheet
// goes. What it asks scrolls inside a capped area; the answers stay pinned under it, so a long command never pushes 允许
// off screen. Put aside, a row over the composer brings it back.
import SwiftUI

struct PromptBar: View {
  let prompts: [RemotePrompt]
  @State private var hidden: String?

  var body: some View {
    let prompt = prompts.first
    // A container that exists while it is empty, so the sheet below stays attached.
    VStack(spacing: 0) {
      if let prompt, hidden == prompt.id {
        Button { hidden = nil } label: {
          HStack(spacing: 8) {
            StatusGlyph(status: .needsYou)
            Text(prompt.kind == "permission" ? "等你确认：\(prompt.summary ?? "")" : "等你回答：\(prompt.questions?.first?.question ?? "")")
              .font(.ui(.subheadline, medium: true)).foregroundStyle(Color.statusAttention).lineLimit(1)
            Spacer(minLength: 0)
            Icon("chevron-right", size: 14).rotationEffect(.degrees(-90)).foregroundStyle(Color.textSecondary)
          }
          .padding(.horizontal, Metric.margin)
          .frame(minHeight: Metric.touch)
          .glass(Metric.radiusField, interactive: true)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Metric.margin)
        .accessibilityHint("重新打开")
      }
    }
    .sheet(item: Binding(get: { prompt.flatMap { hidden == $0.id ? nil : $0 } }, set: { if $0 == nil, let prompt { hidden = prompt.id } })) { shown in
      PromptSheet(prompt: shown) { hidden = shown.id }
    }
  }
}

private struct PromptSheet: View {
  let prompt: RemotePrompt
  let close: () -> Void
  @State private var error: String?

  var body: some View {
    Group {
      if prompt.kind == "permission" { PermissionAsk(prompt: prompt, error: $error, close: close) } else { QuestionAsk(prompt: prompt, error: $error, close: close) }
    }
  }
}

/// A sheet as tall as what it holds (the system floats it, its corners following the display's): `content` scrolls once
/// it passes `maxContent`, `actions` stay under it.
struct FittedSheet<Content: View, Actions: View>: View {
  @ViewBuilder let content: Content
  @ViewBuilder let actions: Actions
  /// About 60% of an iPhone screen.
  var maxContent: CGFloat = 480
  @State private var contentHeight: CGFloat = 240
  @State private var actionsHeight: CGFloat = 120

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        content
          .padding(.horizontal, 20)
          .padding(.top, 24)
          .padding(.bottom, 20)
          .frame(maxWidth: .infinity, alignment: .leading)
          .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
      }
      .scrollBounceBehavior(.basedOnSize)
      .frame(height: min(contentHeight, maxContent))
      // The system keeps the home indicator's inset under the sheet's content: only a little more here.
      VStack(spacing: 8) { actions }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { actionsHeight = $0 }
    }
    .presentationDetents([.height(min(contentHeight, maxContent) + actionsHeight)])
    .presentationDragIndicator(.visible)
    .presentationBackground(Color.bgSheet.opacity(0.9))
  }
}

/// 等你确认 · 已等 48s, in the attention colour after the status glyph.
private struct Head: View {
  let label: String
  var since: Double?

  var body: some View {
    HStack(spacing: 8) {
      StatusGlyph(status: .needsYou)
      TimelineView(.periodic(from: .now, by: 1)) { context in
        Text([label, since.map { "已等 \(shortAge(context.date.timeIntervalSince1970 * 1000 - $0))" }].compactMap { $0 }.joined(separator: " · "))
          .font(.ui(.footnote, medium: true)).monospacedDigit().foregroundStyle(Color.statusAttention)
      }
    }
  }
}

/// The pinned part when this phone cannot answer (the request is not held for it).
private struct TerminalOnly: View {
  let text: String
  let close: () -> Void

  var body: some View {
    Text(text).font(.ui(.subheadline)).foregroundStyle(Color.textSecondary).multilineTextAlignment(.center).frame(maxWidth: .infinity)
    Button("知道了", action: close).buttonStyle(.wavi)
  }
}

/// What a button shows while its answer is on the way: a turning arc in its label's colour.
private func busyLabel(_ label: String, busy: Bool, primary: Bool) -> some View {
  Group { if busy { Spinner(color: primary ? .solidOn : .textPrimary) } else { Text(label).lineLimit(1) } }
}

private struct PermissionAsk: View {
  let prompt: RemotePrompt
  @Binding var error: String?
  let close: () -> Void
  @Environment(AppModel.self) private var model
  @Environment(\.dynamicTypeSize) private var typeSize
  @State private var busy: String?

  var body: some View {
    let input = prompt.input ?? [:]
    FittedSheet {
      VStack(alignment: .leading, spacing: 12) {
        Head(label: "等你确认", since: prompt.createdAt)
        Text(permissionTitle(prompt.tool ?? "")).font(.ui(.title2)).foregroundStyle(Color.textPrimary)
        Text(permissionSubject(input, summary: prompt.summary ?? "")).font(.mono()).foregroundStyle(Color.textPrimary).lineLimit(8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 12)
          .padding(.vertical, 12)
          .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
        if let description = input["description"]?.string { Text(description).font(.ui(.callout)).foregroundStyle(Color.textPrimary) }
      }
    } actions: {
      if prompt.answerable {
        if let error { Notice(tone: .danger, message: error) }
        // Side by side, 允许 on the right (46″); one above the other, 允许 first, once the text is too big for two.
        if typeSize.isAccessibilitySize {
          answerButton("允许", "allow-once", primary: true)
          answerButton("拒绝", "deny")
        } else {
          HStack(spacing: 8) {
            answerButton("拒绝", "deny")
            answerButton("允许", "allow-once", primary: true)
          }
        }
        if prompt.canAllowAlways == true { answerButton(allowAlwaysLabel(prompt.allowAlways?.rules), "allow-always") }
      } else {
        TerminalOnly(text: "这个确认只能在 Mac 的终端里回答", close: close)
      }
    }
  }

  private func answerButton(_ label: String, _ decision: String, primary: Bool = false) -> some View {
    Button {
      busy = decision
      error = nil
      Task {
        let result = await model.call(.permission(prompt: prompt.id, decision: decision))
        busy = nil
        if let failure = result.error { error = "没有送到 Mac：\(failure)" } else {
          model.answered(prompt, decision: decision)
          close()
        }
      }
    } label: {
      busyLabel(label, busy: busy == decision, primary: primary)
    }
    .buttonStyle(.wavi(primary: primary))
    .disabled(busy != nil)
  }
}

private struct QuestionAsk: View {
  let prompt: RemotePrompt
  @Binding var error: String?
  let close: () -> Void
  @Environment(AppModel.self) private var model
  @State private var chosen: [Int: [String]] = [:]
  @State private var other: [Int: String] = [:]
  @State private var busy = false
  private static let otherKey = "\u{0}other"

  var body: some View {
    let questions = prompt.questions ?? []
    FittedSheet {
      VStack(alignment: .leading, spacing: 16) {
        Head(label: "等你回答", since: prompt.createdAt)
        ForEach(Array(questions.enumerated()), id: \.offset) { index, q in
          VStack(alignment: .leading, spacing: 16) {
            Text(q.question).font(.ui(.title2)).foregroundStyle(Color.textPrimary)
            options(index, q)
          }
        }
      }
    } actions: {
      if prompt.answerable {
        if let error { Notice(tone: .danger, message: error) }
        Button {
          busy = true
          error = nil
          Task {
            let answers = Dictionary(questions.enumerated().map { ($0.element.question, answer($0.offset) ?? "") }, uniquingKeysWith: { a, _ in a })
            let result = await model.call(.answer(prompt: prompt.id, answers: answers))
            busy = false
            if let failure = result.error { error = "没有送到 Mac：\(failure)" } else {
              model.answered(prompt, decision: nil)
              close()
            }
          }
        } label: {
          busyLabel("提交", busy: busy, primary: true)
        }
        .buttonStyle(.wavi(primary: true))
        .disabled(busy || !questions.indices.allSatisfy { answer($0) != nil })
      } else {
        TerminalOnly(text: "这个问题只能在 Mac 的终端里回答", close: close)
      }
    }
  }

  /// One grouped list (Figma 61D / 63D4): rows 12 / 16, a hairline from the text's start, a filled field under 其他.
  private func options(_ index: Int, _ q: AgentQuestion) -> some View {
    let labels = q.options.map(\.label) + [Self.otherKey]
    return VStack(spacing: 0) {
      ForEach(Array(labels.enumerated()), id: \.element) { i, label in
        if i > 0 { Rectangle().fill(Color.hairline).frame(height: 1).padding(.leading, 48) }
        option(index, q, label, description: q.options.first { $0.label == label }?.description)
      }
    }
    .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusGroup))
  }

  private func option(_ index: Int, _ q: AgentQuestion, _ label: String, description: String?) -> some View {
    let on = chosen[index, default: []].contains(label)
    return VStack(alignment: .leading, spacing: 8) {
      Button {
        guard prompt.answerable else { return }
        let now = chosen[index, default: []]
        chosen[index] = q.multiSelect ? (on ? now.filter { $0 != label } : now + [label]) : [label]
      } label: {
        HStack(alignment: .top, spacing: 12) {
          Radio(on: on, multi: q.multiSelect)
          VStack(alignment: .leading, spacing: 2) {
            Text(label == Self.otherKey ? "其他" : label).font(.ui(.callout)).foregroundStyle(Color.textPrimary)
            if let description { Text(description).font(.ui(.footnote)).foregroundStyle(Color.textSecondary) }
          }
          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(on ? .isSelected : [])
      // A sibling of the button, so typing in it does not toggle the option.
      if label == Self.otherKey && on {
        TextField("写下你的做法", text: Binding(get: { other[index] ?? "" }, set: { other[index] = $0 }), axis: .vertical)
          .font(.ui(.callout)).foregroundStyle(Color.textPrimary)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(Color.fillStrong, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
          .padding(.leading, 32)
      }
    }
    .padding(.horizontal, Metric.margin)
    .padding(.vertical, 12)
  }

  private func answer(_ index: Int) -> String? {
    let picked = chosen[index, default: []].map { $0 == Self.otherKey ? (other[index] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : $0 }.filter { !$0.isEmpty }
    return picked.isEmpty ? nil : picked.joined(separator: ", ")
  }
}

/// Figma 59 Mobile/Radio: a ring (single) or a rounded square (multi), solid with a dot or a check when chosen.
private struct Radio: View {
  let on: Bool
  let multi: Bool

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: multi ? 5 : 10)
    ZStack {
      if on {
        shape.fill(Color.solidFill)
        if multi { Icon("check", size: 14).foregroundStyle(Color.solidOn) } else { Circle().fill(Color.solidOn).frame(width: 8, height: 8) }
      } else {
        shape.strokeBorder(Color.lineStrong, lineWidth: 1.5)
      }
    }
    .frame(width: 20, height: 20)
    .accessibilityHidden(true)
  }
}
