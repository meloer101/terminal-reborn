// 会话页 · 聊天视图 (Figma 45C / 46C): the session's conversation from its transcript, newest at the bottom; what the agent
// is doing right now (its text reaches the transcript only once a block is written, PRD §6.16); the composer floating
// over it as glass; and the sheet for what it waits for. The branch button opens Git · 变更.
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
      } else {
        Text(model.isOpen ? "这个会话已经不在 Mac 上了" : "Mac 上的 Wavi 没有运行").font(.ui(15)).foregroundStyle(Color.textTertiary)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(20)
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
              Text("\(changed)").font(.mono(13))
            }
            .foregroundStyle(Color.textSecondary)
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
      Text(session?.title ?? "会话").font(.ui(16, 500)).foregroundStyle(Color.textPrimary).lineLimit(1)
      if let session {
        HStack(spacing: 6) {
          StatusGlyph(status: session.status)
          if let branch = session.branch { Text(branch).font(.mono(12)).foregroundStyle(Color.textTertiary).lineLimit(1) }
          AgentMark(agent: session.agent)
        }
      }
    }
  }

  private func feed(_ session: RemoteSession) -> some View {
    let conversation = model.conversation
    let prompts = model.prompts.filter { $0.sessionId == id }.sorted { $0.createdAt < $1.createdAt }
    return ScrollView {
      LazyVStack(alignment: .leading, spacing: 16) {
        if conversation?.loading == true { ProgressView().frame(maxWidth: .infinity) }
        ForEach(Array((conversation?.feed.items ?? []).enumerated()), id: \.element.id) { index, item in
          FeedRow(item: item, session: id)
            .onAppear { if index == 0 { Task { await model.loadOlder() } } }
        }
        if session.status == .running, let action = session.action { Live(action: action, since: session.since) }
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 12)
    }
    .defaultScrollAnchor(.bottom)
    // 46′: text never runs under the title; the system's harder edge instead of the soft blur.
    .scrollEdgeEffectStyle(.hard, for: .top)
    .scrollDismissesKeyboard(.interactively)
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
      HStack(spacing: 10) {
        StatusGlyph(status: .running)
        Text(action).font(.ui(14)).foregroundStyle(Color.textSecondary).lineLimit(1)
        if let since { Text(shortAge(context.date.timeIntervalSince1970 * 1000 - since)).font(.mono(13)).foregroundStyle(Color.textTertiary) }
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
          if let text = item.text, !text.isEmpty { Text(text).font(.ui(16)).lineSpacing(5).foregroundStyle(Color.textPrimary) }
          if let images = item.images, images > 0 { Text("\(images) 张图片").font(.ui(13)).foregroundStyle(Color.textTertiary) }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.bgSelected, in: RoundedRectangle(cornerRadius: 14))
      }
    case "text":
      MarkdownText(text: item.text ?? "")
    case "thinking":
      VStack(alignment: .leading, spacing: 6) {
        Button { open.toggle() } label: {
          HStack(spacing: 6) {
            Icon("chevron-right", size: 14).rotationEffect(.degrees(open ? 90 : 0))
            Text("思考\(item.ms.map { " \(max(1, Int(($0 / 1000).rounded())))s" } ?? "")").font(.ui(14))
          }
          .foregroundStyle(Color.textTertiary)
        }
        .buttonStyle(.plain)
        if open, let text = item.text { Text(text).font(.ui(14)).lineSpacing(4).foregroundStyle(Color.textTertiary).padding(.leading, 20) }
      }
    case "tool":
      NavigationLink(value: Route.tool(session: session, item: item.id)) { ToolLine(item: item) }.buttonStyle(.plain)
    case "system":
      Text(item.text ?? "").font(.ui(13)).foregroundStyle(Color.textTertiary)
    default:
      Text("未识别的条目").font(.ui(13)).foregroundStyle(Color.textTertiary)
    }
  }
}

private struct ToolLine: View {
  let item: ChatItem

  var body: some View {
    let glyph: SessionStatus = item.state == "running" ? .running : item.state == "error" ? .error : .doneUnread
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        StatusGlyph(status: glyph)
        Text(item.name ?? "").font(.mono(13, 500)).foregroundStyle(Color.textPrimary)
        Text(item.arg ?? "").font(.mono(13)).foregroundStyle(Color.textSecondary).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
        if let diff = item.diff { Counts(added: diff.added, removed: diff.removed) }
        Icon("chevron-right", size: 14).foregroundStyle(Color.textTertiary)
      }
      if item.diff == nil, let tail = lastLine(item.output) {
        Text(tail).font(.mono(12)).foregroundStyle(item.state == "error" ? Color.statusError : Color.textTertiary).lineLimit(1).padding(.leading, 22)
      }
      if let diff = item.diff, item.name != "Write", let hunk = diff.hunks.first {
        MiniDiff(lines: miniLines(hunk.lines))
      }
    }
    .contentShape(Rectangle())
  }

  /// A few lines of an Edit's first hunk, from one line before its first change (a hunk opens with 3 of context).
  private func miniLines(_ lines: [String]) -> [String] {
    let first = lines.firstIndex { $0.hasPrefix("+") || $0.hasPrefix("-") } ?? 0
    let from = max(0, first - 1)
    return Array(lines[from..<min(lines.count, from + 6)])
  }
}
