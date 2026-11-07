// 会话页 · 聊天视图 (Figma 61B, states 62F and 63C1–63C4): the session's conversation from its transcript, newest at the
// bottom; what the agent is doing right now (its text reaches the transcript only once a block is written, PRD §6.16);
// the composer floating over it as glass; and the sheet for what it waits for. The 变更 capsule opens Git · 变更.
import SwiftUI

struct SessionView: View {
  let id: String
  @Environment(AppModel.self) private var model
  @State private var changed: Int?

  var body: some View {
    let session = model.session(id)
    Group {
      if let session {
        feed(session)
      } else if model.isOpen {
        EmptyState(title: "这个会话已经不在 Mac 上", action: "回到会话列表") { model.showList() }
      } else {
        EmptyState(title: "连不上 \(model.macName)", action: "重试") { model.wake() }
      }
    }
    .background(Color.bgApp)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .principal) { title(session) }
      if let changed {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink(value: Route.changes(id)) {
            HStack(spacing: 8) {
              Icon("git-branch")
              Text("\(changed)").font(.ui(.callout, medium: true)).monospacedDigit()
            }
            .foregroundStyle(Color.textPrimary)
          }
          .accessibilityLabel("变更")
        }
      }
    }
    // Coming back from a tool, Git · 变更 or the camera, the feed is still the one on screen (RootView unwatches when the
    // session leaves the navigation path).
    .task(id: id) { if model.watching != id { await model.watch(id) } }
    .task(id: model.isOpen) {
      guard model.isOpen, let data = await model.call(.changes(session: id)).decode(GitChanges.self) else { return }
      changed = data.uncommitted.count + data.committed.count
    }
  }

  private func title(_ session: RemoteSession?) -> some View {
    VStack(spacing: 2) {
      Text(session?.title ?? "会话").font(.ui(.headline)).foregroundStyle(Color.textPrimary).lineLimit(1)
      if let session {
        HStack(spacing: 8) {
          StatusGlyph(status: session.status)
          let project = model.sessions.projects.first { $0.id == session.projectId }?.name
          let place = [project, session.branch].compactMap { $0 }.joined(separator: " · ")
          if !place.isEmpty { Text(place).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).lineLimit(1) }
          AgentMark(agent: session.agent, size: 14)
        }
      }
    }
  }

  private func feed(_ session: RemoteSession) -> some View {
    let conversation = model.conversation
    let prompts = model.prompts.filter { $0.sessionId == id }.sorted { $0.createdAt < $1.createdAt }
    return ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        if conversation?.loading == true { Spinner(color: .textSecondary).frame(maxWidth: .infinity).accessibilityLabel("正在读取更早的消息") }
        ForEach(Array((conversation?.feed.items ?? []).enumerated()), id: \.element.id) { index, item in
          FeedRow(item: item, session: id)
            .onAppear { if index == 0 { Task { await model.loadOlder() } } }
        }
        ForEach(model.sending[id] ?? []) { item in FeedRow(item: item, session: id).opacity(0.6) }
        if session.status == .running, let action = session.action { Live(action: action, since: session.since) }
      }
      .padding(.horizontal, Metric.margin)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      // Taps on the conversation put the keyboard away (a short one does not scroll, so dragging cannot).
      .contentShape(Rectangle())
      .onTapGesture { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
    }
    // A short conversation starts at the top; a long one opens at its end and stays there as it grows.
    .defaultScrollAnchor(.top, for: .alignment)
    .defaultScrollAnchor(.bottom, for: .initialOffset)
    .defaultScrollAnchor(.bottom, for: .sizeChanges)
    // 46′: text never runs under the title; the system's harder edge instead of the soft blur.
    .scrollEdgeEffectStyle(.hard, for: .top)
    .scrollDismissesKeyboard(.interactively)
    .safeAreaBar(edge: .top) {
      // Without a link the conversation stays as it was, under a line that says so (62F).
      if !model.isOpen {
        Group {
          if model.link == .connecting {
            Notice(tone: .info, message: "连接断了，正在重连")
          } else {
            Notice(tone: .warning, message: "连不上 \(model.macName)", action: "重试") { model.wake() }
          }
        }
        .padding(.horizontal, Metric.margin)
        .padding(.bottom, 4)
      }
    }
    .safeAreaBar(edge: .bottom) {
      VStack(spacing: 8) {
        PromptBar(prompts: prompts)
        Composer(session: id, running: session.status == .running)
      }
    }
  }
}

/// What the agent does right now, with how long it has been at it.
private struct Live: View {
  let action: String
  let since: Double?

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      HStack(spacing: 8) {
        Spinner(color: .textSecondary)
        Text([action, since.map { shortAge(context.date.timeIntervalSince1970 * 1000 - $0) }].compactMap { $0 }.joined(separator: " · "))
          .font(.ui(.footnote)).monospacedDigit().foregroundStyle(Color.textSecondary).lineLimit(1)
      }
    }
  }
}

/// One item of the conversation: the user's bubble, the agent's Markdown, thinking (folded), one row per tool call
/// (tap for 45D), system lines, and 未识别的条目 so an unknown line never breaks the rest.
struct FeedRow: View {
  let item: ChatItem
  let session: String
  @State private var open = false

  var body: some View {
    switch item.kind {
    case "user":
      HStack {
        Spacer(minLength: 48)
        VStack(alignment: .leading, spacing: 4) {
          if let text = item.text, !text.isEmpty { Text(text).font(.ui(.callout)).lineSpacing(5).foregroundStyle(Color.textPrimary) }
          if let images = item.images, images > 0 { Text("\(images) 张图片").font(.ui(.footnote)).foregroundStyle(Color.textSecondary) }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.fillStrong, in: RoundedRectangle(cornerRadius: Metric.radiusGroup))
      }
    case "text":
      MarkdownText(text: item.text ?? "")
    case "thinking":
      VStack(alignment: .leading, spacing: 8) {
        Button { open.toggle() } label: {
          HStack(spacing: 8) {
            Icon("chevron-right", size: 14).rotationEffect(.degrees(open ? 90 : 0))
            Text("思考\(item.ms.map { " \(max(1, Int(($0 / 1000).rounded())))s" } ?? "")").font(.ui(.subheadline))
          }
          .foregroundStyle(Color.textSecondary)
          .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityValue(open ? "已展开" : "已收起")
        if open, let text = item.text { Text(text).font(.ui(.subheadline)).lineSpacing(4).foregroundStyle(Color.textSecondary).padding(.leading, 24) }
      }
    case "tool":
      NavigationLink(value: Route.tool(session: session, item: item.id)) { ToolLine(item: item) }.buttonStyle(.plain)
    case "system":
      Text(item.text ?? "").font(.ui(.footnote)).foregroundStyle(Color.textSecondary).frame(maxWidth: .infinity)
    default:
      Text("未识别的条目").font(.ui(.footnote)).foregroundStyle(Color.textSecondary)
    }
  }
}

private struct ToolLine: View {
  let item: ChatItem

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 8) {
        ToolMark(state: item.state)
        Text(item.name ?? "").font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary)
        Text(item.arg ?? "").font(.mono(.caption)).foregroundStyle(Color.textSecondary).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
        if let diff = item.diff { Counts(added: diff.added, removed: diff.removed) }
      }
      if item.diff == nil, let tail = lastLine(item.output) {
        Text(tail).font(.mono(.caption)).foregroundStyle(item.state == "error" ? Color.statusError : Color.textSecondary).lineLimit(1)
      }
      if let diff = item.diff, item.name != "Write", let hunk = diff.hunks.first {
        MiniDiff(lines: miniLines(hunk.lines))
      }
    }
    .padding(.vertical, 4)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }

  /// A few lines of an Edit's first hunk, from one line before its first change (a hunk opens with 3 of context).
  private func miniLines(_ lines: [String]) -> [String] {
    let first = lines.firstIndex { $0.hasPrefix("+") || $0.hasPrefix("-") } ?? 0
    let from = max(0, first - 1)
    return Array(lines[from..<min(lines.count, from + 6)])
  }
}

/// A tool call's state (Figma 59 Mobile/ToolRow): a turning arc while it runs, a check when done, ✗ in the error colour.
/// Not a session status, so done is neutral.
struct ToolMark: View {
  let state: String?

  var body: some View {
    switch state {
    case "running": Spinner(color: .textSecondary).accessibilityLabel("运行中")
    case "error": Icon("x", size: 14).foregroundStyle(Color.statusError).frame(width: 14, height: 14).accessibilityLabel("出错")
    default: Icon("check", size: 14).foregroundStyle(Color.textSecondary).frame(width: 14, height: 14).accessibilityLabel("完成")
    }
  }
}
