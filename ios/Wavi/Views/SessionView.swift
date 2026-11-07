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
        EmptyState(title: model.connection.text, action: "重试") { model.wake() }
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
        let blocks = transcriptBlocks(conversation?.feed.items ?? [], receipts: model.receipts[id] ?? [],
          turnOpen: session.status == .running || session.status == .needsYou)
        ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
          VStack(alignment: .leading, spacing: 8) {
            if startsTurn(blocks, at: index) { AgentAvatar(agent: session.agent) }
            BlockRow(block: block, session: id)
          }
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
            Notice(tone: .info, message: model.connection.text)
          } else {
            Notice(tone: .warning, message: model.connection.text, action: "重试") { model.wake() }
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

/// The agent's first block after a message of the user's (or the first on screen) carries its mark above it.
private func startsTurn(_ blocks: [TranscriptBlock], at index: Int) -> Bool {
  func isUser(_ block: TranscriptBlock) -> Bool { if case .item(let item) = block { item.kind == "user" } else { false } }
  if case .receipt = blocks[index] { return false }
  guard !isUser(blocks[index]) else { return false }
  return index == 0 || isUser(blocks[index - 1])
}

/// The agent's mark in a 24 solid circle, alone on its row (Figma 64A).
private struct AgentAvatar: View {
  let agent: String
  @ScaledMetric(relativeTo: .body) private var side: CGFloat = 24

  var body: some View {
    AgentMark(agent: agent, size: side * 0.58, color: .solidOn)
      .frame(width: side, height: side)
      .background(Color.solidFill, in: Circle())
  }
}

/// My avatar, alone on its row on the right; nothing when none is set (Figma 64A).
private struct MyAvatarView: View {
  @ScaledMetric(relativeTo: .body) private var side: CGFloat = 24

  var body: some View {
    if let image = MyAvatar.shared.image {
      Image(uiImage: image).resizable().scaledToFill().frame(width: side, height: side).clipShape(Circle())
        .accessibilityHidden(true)
    }
  }
}

/// One block of the conversation (Figma 62E): an item, a folded run of tool calls, a turn's totals or an answer.
private struct BlockRow: View {
  let block: TranscriptBlock
  let session: String

  var body: some View {
    switch block {
    case .item(let item): FeedRow(item: item, session: session)
    case .tools(let run): ToolGroupRow(run: run, session: session)
    case .turn(let turn):
      NavigationLink(value: Route.turn(session: session, tools: turn.tools)) { TurnRow(turn: turn) }.buttonStyle(.plain)
    case .receipt(let receipt):
      HStack(spacing: 8) {
        Icon(receipt.onPhone ? "smartphone" : "square-terminal", size: 14)
        Text(receipt.text).font(.ui(.footnote)).lineLimit(1)
      }
      .foregroundStyle(Color.textSecondary)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 4)
      .accessibilityElement(children: .combine)
    }
  }
}

/// Consecutive tool calls as one line that says what they did; open, the calls in an inset box that scrolls on its own
/// past 156 (a running run starts open).
private struct ToolGroupRow: View {
  let run: ToolRun
  let session: String
  @State private var open: Bool?
  @State private var height: CGFloat = 0

  var body: some View {
    let expanded = open ?? run.running
    VStack(alignment: .leading, spacing: 8) {
      Button { open = !expanded } label: {
        HStack(spacing: 8) {
          Icon("chevron-right", size: 14).rotationEffect(.degrees(expanded ? 90 : 0))
          Text(run.summary).font(.ui(.subheadline)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
          if run.showCounts { Counts(added: run.added, removed: run.removed) }
        }
        .foregroundStyle(Color.textSecondary)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityValue(expanded ? "已展开" : "已收起")
      if expanded {
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(run.items) { item in
              NavigationLink(value: Route.tool(session: session, item: item.id)) { ToolLine(item: item, compact: true) }.buttonStyle(.plain)
            }
          }
          .padding(.horizontal, 12)
          .padding(.vertical, 4)
          .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        }
        .frame(height: min(max(height, 1), 156))
        .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
      }
    }
  }
}

/// The end of a turn that changed files: one place to see what it changed (Figma 59 Mobile/TurnSummary).
private struct TurnRow: View {
  let turn: TurnChange

  var body: some View {
    HStack(spacing: 8) {
      Icon("file", size: 16).foregroundStyle(Color.textPrimary)
      Text("这一轮改了 \(turn.files) 个文件").font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary)
      Spacer(minLength: 0)
      Counts(added: turn.added, removed: turn.removed)
      Icon("chevron-right", size: 14).foregroundStyle(Color.textSecondary)
    }
    .padding(12)
    .background(Color.fillSubtle, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
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
      VStack(alignment: .trailing, spacing: 8) {
        MyAvatarView()
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
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
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
  /// Inside a run's box: no MiniDiff.
  var compact = false

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
      if !compact, let diff = item.diff, item.name != "Write", let hunk = diff.hunks.first {
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
