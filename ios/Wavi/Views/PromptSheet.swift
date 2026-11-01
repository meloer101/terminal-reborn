// What the agent waits for, as a sheet over its conversation (Figma 45E / 45F, 46″): a permission request or an
// AskUserQuestion. The answer goes back through the held hook (PRD §6.16), so the Mac terminal's dialog closes with it;
// answered in the terminal first, the prompt leaves the list Wavi pushes and the sheet goes. Put aside, a row over the
// composer brings it back.
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
          HStack(spacing: 10) {
            StatusGlyph(status: .needsYou)
            Text(prompt.kind == "permission" ? "等你确认：\(prompt.summary ?? "")" : "等你回答：\(prompt.questions?.first?.question ?? "")")
              .font(.ui(14)).foregroundStyle(Color.statusAttention).lineLimit(1)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, 16)
          .frame(minHeight: 44)
          .glass(22, interactive: true)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
      }
    }
    .sheet(item: Binding(get: { prompt.flatMap { hidden == $0.id ? nil : $0 } }, set: { if $0 == nil, let prompt { hidden = prompt.id } })) { shown in
      PromptSheet(prompt: shown) { hidden = shown.id }
    }
  }
}

private struct PromptSheet: View {
  let prompt: RemotePrompt
  let answered: () -> Void
  @State private var error: String?

  var body: some View {
    FittedSheet {
      VStack(alignment: .leading, spacing: 16) {
        if prompt.kind == "permission" { PermissionAsk(prompt: prompt, done: done) } else { QuestionAsk(prompt: prompt, done: done) }
        if let error { Text(error).font(.ui(14)).foregroundStyle(Color.statusError) }
      }
    }
  }

  private func done(_ failure: String?) {
    if let failure { error = failure } else { answered() }
  }
}

/// A sheet as tall as what it holds (the system floats it, its corners following the display's); scrolls when longer.
struct FittedSheet<Content: View>: View {
  @ViewBuilder let content: Content
  @State private var height: CGFloat = 320

  var body: some View {
    ScrollView {
      content
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 16)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
    }
    .scrollBounceBehavior(.basedOnSize)
    .presentationDetents([.height(height)])
    .presentationDragIndicator(.visible)
    .presentationBackground(Color.bgRaised.opacity(0.9))
  }
}

private struct Head: View {
  let label: String
  var since: Double?
  var chip: String?

  var body: some View {
    HStack(spacing: 8) {
      StatusGlyph(status: .needsYou)
      Text(label).font(.ui(13, 500)).foregroundStyle(Color.statusAttention)
      if let since {
        TimelineView(.periodic(from: .now, by: 1)) { context in
          Text("已等 \(shortAge(context.date.timeIntervalSince1970 * 1000 - since))").font(.mono(12)).foregroundStyle(Color.textTertiary)
        }
      }
      if let chip {
        Text(chip).font(.ui(12)).foregroundStyle(Color.textSecondary).padding(.horizontal, 8).padding(.vertical, 2)
          .background(Color.bgSelected, in: RoundedRectangle(cornerRadius: 6))
      }
    }
  }
}

private struct PermissionAsk: View {
  let prompt: RemotePrompt
  let done: (String?) -> Void
  @Environment(AppModel.self) private var model
  @State private var busy: String?

  var body: some View {
    let input = prompt.input ?? [:]
    Head(label: "等你确认", since: prompt.createdAt)
    Text(permissionTitle(prompt.tool ?? "")).font(.ui(22, 500)).foregroundStyle(Color.textPrimary)
    Text(permissionSubject(input, summary: prompt.summary ?? "")).font(.mono(15)).foregroundStyle(Color.textPrimary).lineLimit(8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(Color.bgInset, in: RoundedRectangle(cornerRadius: 10))
    if let description = input["description"]?.string { Text(description).font(.ui(15)).lineSpacing(4).foregroundStyle(Color.textSecondary) }
    if prompt.answerable {
      HStack(spacing: 8) {
        answerButton("拒绝", "deny")
        answerButton("允许", "allow-once", primary: true)
      }
      // 46″: as wide as the two above, left on 拒绝 and right on 允许.
      if prompt.canAllowAlways == true { answerButton(allowAlwaysLabel(prompt.allowAlways?.rules), "allow-always") }
    } else {
      Text("这个请求只能在 Mac 的终端里回答").font(.ui(15)).foregroundStyle(Color.textSecondary)
    }
  }

  private func answerButton(_ label: String, _ decision: String, primary: Bool = false) -> some View {
    Button {
      busy = decision
      Task {
        let result = await model.call(.permission(prompt: prompt.id, decision: decision))
        busy = nil
        done(result.error)
      }
    } label: {
      if busy == decision { ProgressView() } else { Text(label).lineLimit(1) }
    }
    .buttonStyle(.wavi(primary: primary))
    .disabled(busy != nil)
  }
}

private struct QuestionAsk: View {
  let prompt: RemotePrompt
  let done: (String?) -> Void
  @Environment(AppModel.self) private var model
  @State private var chosen: [Int: [String]] = [:]
  @State private var other: [Int: String] = [:]
  @State private var busy = false
  private static let otherKey = "\u{0}other"

  var body: some View {
    let questions = prompt.questions ?? []
    Head(label: "等你回答", chip: questions.count == 1 ? questions[0].header : nil)
    ForEach(Array(questions.enumerated()), id: \.offset) { index, q in
      VStack(alignment: .leading, spacing: 16) {
        Text(q.question).font(.ui(20, 500)).foregroundStyle(Color.textPrimary)
        VStack(spacing: 2) {
          ForEach(q.options.map(\.label) + [Self.otherKey], id: \.self) { label in
            option(index, q, label, description: q.options.first { $0.label == label }?.description)
          }
        }
      }
    }
    if prompt.answerable {
      Button {
        busy = true
        Task {
          let answers = Dictionary(questions.enumerated().map { ($0.element.question, answer($0.offset) ?? "") }, uniquingKeysWith: { a, _ in a })
          let result = await model.call(.answer(prompt: prompt.id, answers: answers))
          busy = false
          done(result.error)
        }
      } label: {
        if busy { ProgressView() } else { Text("提交") }
      }
      .buttonStyle(.wavi(primary: true))
      .disabled(busy || !questions.indices.allSatisfy { answer($0) != nil })
    } else {
      Text("这个问题现在只能在 Mac 的终端里回答").font(.ui(15)).foregroundStyle(Color.textSecondary)
    }
  }

  private func option(_ index: Int, _ q: AgentQuestion, _ label: String, description: String?) -> some View {
    let on = chosen[index, default: []].contains(label)
    return VStack(alignment: .leading, spacing: 0) {
      optionButton(index, q, label, description: description, on: on)
      // A sibling of the button, so typing in it does not toggle the option.
      if label == Self.otherKey && on {
        TextField("写下你的回答", text: Binding(get: { other[index] ?? "" }, set: { other[index] = $0 }), axis: .vertical)
          .font(.ui(16)).foregroundStyle(Color.textPrimary)
          .padding(.leading, 46).padding(.trailing, 12).padding(.bottom, 12)
      }
    }
    .background(on ? Color.bgSelected : .clear, in: RoundedRectangle(cornerRadius: 10))
  }

  private func optionButton(_ index: Int, _ q: AgentQuestion, _ label: String, description: String?, on: Bool) -> some View {
    Button {
      guard prompt.answerable else { return }
      let now = chosen[index, default: []]
      chosen[index] = q.multiSelect ? (on ? now.filter { $0 != label } : now + [label]) : [label]
    } label: {
      HStack(alignment: .top, spacing: 12) {
        if q.multiSelect { Icon(on ? "square-check" : "square", size: 22) } else { Radio(on: on) }
        VStack(alignment: .leading, spacing: 2) {
          Text(label == Self.otherKey ? "其他" : label).font(.ui(16)).foregroundStyle(Color.textPrimary)
          if let description { Text(description).font(.ui(14)).foregroundStyle(Color.textSecondary) }
        }
        Spacer(minLength: 0)
      }
      .foregroundStyle(on ? Color.textPrimary : Color.textSecondary)
      .padding(12)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func answer(_ index: Int) -> String? {
    let picked = chosen[index, default: []].map { $0 == Self.otherKey ? (other[index] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : $0 }.filter { !$0.isEmpty }
    return picked.isEmpty ? nil : picked.joined(separator: ", ")
  }
}

/// 45F's radio: a ring, filled at its centre when chosen.
private struct Radio: View {
  let on: Bool

  var body: some View {
    ZStack {
      Circle().stroke(lineWidth: 1.75).frame(width: 18, height: 18)
      if on { Circle().frame(width: 10, height: 10) }
    }
    .frame(width: 22, height: 22)
  }
}
