// 会话列表 (Figma 61A, states 62A–62D and 63B1–63B3): a small centred title with the connection under it, 等你处理
// first, then by project; each row has its status (shape + text), current action, how long it has waited, project ·
// branch and the agent's mark (no model name, PRD v1.116). Without a link the last list stays, dimmed, under a notice.
import PhotosUI
import SwiftUI

struct SessionsView: View {
  @Environment(AppModel.self) private var model
  @State private var unpairing = false
  @State private var creating = false
  @State private var pickingAvatar = false
  @State private var avatarItem: PhotosPickerItem?

  var body: some View {
    content
      .background(Color.bgApp)
      .navigationTitle("会话")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) {
          Button { unpairing = true } label: {
            VStack(spacing: 2) {
              Text("会话").font(.ui(.headline)).foregroundStyle(Color.textPrimary)
              ConnectionLine(words: model.connection, busy: model.link == .connecting)
            }
          }
          .buttonStyle(.plain)
          .accessibilityHint("连接详情")
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button { creating = true } label: { Icon("plus", size: 20) }
            .disabled(!model.isOpen)
            .accessibilityLabel("新建会话")
        }
      }
      .sheet(isPresented: $creating) { NewSessionView() }
      .confirmationDialog(model.macName, isPresented: $unpairing, titleVisibility: .visible) {
        // My avatar is set here (Figma 64G): the only menu the phone has.
        if MyAvatar.shared.image == nil {
          Button("设置我的头像") { pickingAvatar = true }
        } else {
          Button("更换我的头像") { pickingAvatar = true }
          Button("去掉我的头像") { MyAvatar.shared.remove() }
        }
        Button("取消配对", role: .destructive) { model.forget() }
      } message: {
        Text(dialogText)
      }
      .photosPicker(isPresented: $pickingAvatar, selection: $avatarItem, matching: .images)
      .onChange(of: avatarItem) { _, item in
        guard let item else { return }
        avatarItem = nil
        Task { if let data = try? await item.loadTransferable(type: Data.self) { MyAvatar.shared.set(data) } }
      }
  }

  @ViewBuilder private var content: some View {
    let groups = groupSessions(model.sessions)
    if model.link == .refused {
      EmptyState(title: "\(model.macName) 不认识这台手机", action: "重新配对") { model.forget() }
    } else if groups.isEmpty && model.isOpen {
      EmptyState(title: "Mac 上还没有会话", action: "新建会话") { creating = true }
    } else if groups.isEmpty && model.link == .connecting {
      SkeletonList()
    } else if groups.isEmpty {
      EmptyState(title: model.connection.text, action: "重试") { model.wake() }
    } else {
      list(groups)
    }
  }

  private func list(_ groups: [SessionGroup]) -> some View {
    let stale = !model.isOpen
    return ScrollView {
      // The notice reads the same clock as the rows: offline nothing else changes, so it would keep its first minute.
      TimelineView(.periodic(from: .now, by: 15)) { context in
        let now = context.date.timeIntervalSince1970 * 1000
        VStack(alignment: .leading, spacing: 0) {
          if stale {
            Notice(tone: .warning, message: staleNotice(heardAt: model.heardAt, now: now), action: "重试") { model.wake() }
              .padding(.horizontal, Metric.margin)
              .padding(.top, 4)
          }
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(groups) { group in
              GroupHeader(title: group.title, count: group.rows.count, project: true, attention: group.id == SessionGroup.needsYouId)
              ForEach(group.rows) { row in
                NavigationLink(value: Route.session(row.session.id)) {
                  SessionRow(session: row.session, projectName: row.projectName, now: now, stale: stale)
                }
                .buttonStyle(RowStyle())
              }
            }
          }
        }
      }
      .padding(.bottom, 40)
    }
    .refreshable { await model.refresh() }
  }

  /// The addresses this phone tries (and why each failed while there is no link): what to check when it cannot connect.
  private var dialogText: String {
    var lines = model.addresses.map { a in
      let host = a.url.replacing(/^wss?:\/\//, with: "")
      return a.failure.map { "\(host)：\($0)" } ?? host
    }
    if model.link == .refused { lines.append("这台手机在 Mac 上被撤销了，或者这个地址现在是别的电脑。取消配对后可以重新扫码。") }
    return lines.joined(separator: "\n")
  }
}

/// The connection under a screen title (Figma 59 Mobile/ConnectionTitle): the words say it, the small mark is never
/// the only signal.
struct ConnectionLine: View {
  let words: ConnectionWords
  var busy = false

  var body: some View {
    let color: Color = switch words.tone {
    case .quiet: .textSecondary
    case .warning: .noticeWarning
    case .danger: .noticeDanger
    }
    HStack(spacing: 8) {
      if busy { Spinner(color: .textSecondary) } else if words.tone != .quiet { Circle().fill(color).frame(width: 6, height: 6) }
      Text(words.text).foregroundStyle(color)
    }
    .font(.ui(.footnote))
    .lineLimit(1)
  }
}

/// A group of rows. `project`: a project (or 等你处理) in the session list, which outranks the session rows under it;
/// otherwise a quiet subsection label (未提交 / 已提交 in Git · 变更). Its label sits closer to its rows than to the
/// group above (24 above, 8 below).
struct GroupHeader: View {
  let title: String
  let count: Int
  var project = false
  var attention = false
  var countLabel: String?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(title).font(project ? .ui(.headline) : .ui(.subheadline, medium: true)).foregroundStyle(project ? Color.textPrimary : Color.textSecondary)
      Text(countLabel ?? "\(count)").font(project ? .ui(.footnote) : .ui(.subheadline)).foregroundStyle(attention ? Color.statusAttention : Color.textSecondary)
    }
    .padding(.horizontal, Metric.margin)
    .padding(.top, 24)
    .padding(.bottom, 8)
    .accessibilityElement(children: .combine)
  }
}

private struct SessionRow: View {
  let session: RemoteSession
  let projectName: String?
  let now: Double
  var stale = false

  var body: some View {
    let waiting = session.status == .needsYou
    HStack(alignment: .top, spacing: 12) {
      StatusGlyph(status: session.status).padding(.top, 3).opacity(stale ? 0.4 : 1)
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(session.title).font(.ui(.callout, medium: true)).foregroundStyle(Color.textPrimary).lineLimit(1)
          Spacer(minLength: 0)
          Text(rowTime(session, now: now)).font(.ui(.footnote)).monospacedDigit().foregroundStyle(Color.textSecondary)
        }
        Text(session.action ?? session.status.label).font(.ui(.subheadline)).foregroundStyle(waiting ? Color.statusAttention : Color.textSecondary).lineLimit(1)
        HStack(spacing: 8) {
          Text([projectName, session.branch].compactMap { $0 }.joined(separator: " · ")).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).lineLimit(1)
          Spacer(minLength: 0)
          AgentMark(agent: session.agent, size: 14)
        }
      }
      .opacity(stale ? 0.5 : 1)
    }
    .padding(.horizontal, Metric.margin)
    .padding(.vertical, 12)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

/// The first load (Figma 63B1): rows' shapes while the list is on its way.
private struct SkeletonList: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Capsule().fill(Color.fillStrong).frame(width: 72, height: 14).padding(.horizontal, Metric.margin).padding(.top, 24).padding(.bottom, 12)
      ForEach([180, 140, 200, 120, 160, 150], id: \.self) { w in
        HStack(alignment: .top, spacing: 12) {
          Circle().fill(Color.fillStrong).frame(width: 14, height: 14)
          VStack(alignment: .leading, spacing: 8) {
            Capsule().fill(Color.fillStrong).frame(width: CGFloat(w), height: 12)
            Capsule().fill(Color.fillSubtle).frame(width: CGFloat(w + 60), height: 10)
            Capsule().fill(Color.fillSubtle).frame(width: CGFloat(w - 40), height: 10)
          }
        }
        .padding(.horizontal, Metric.margin)
        .padding(.vertical, 16)
      }
      Spacer()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityLabel("正在读取会话")
  }
}

/// A list row's pressed state: the subtle fill, no dimming of the text.
struct RowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.background(configuration.isPressed ? Color.fillSubtle : .clear)
  }
}
