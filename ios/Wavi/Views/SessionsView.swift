// 会话列表 (Figma 45B / 46B): the Mac's sessions, 等你处理 first, then by project; each row has its status (shape + text),
// its current action, how long it has waited, project · branch and the agent's mark (no model name, PRD v1.116).
import SwiftUI

struct SessionsView: View {
  @Environment(AppModel.self) private var model
  @State private var unpairing = false
  @State private var creating = false

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        macLine
        let groups = groupSessions(model.sessions)
        if groups.isEmpty && model.isOpen {
          Text("Mac 上还没有会话").font(.ui(15)).foregroundStyle(Color.textTertiary).padding(.horizontal, 20).padding(.top, 24)
        }
        TimelineView(.periodic(from: .now, by: 15)) { context in
          let now = context.date.timeIntervalSince1970 * 1000
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(groups) { group in
              GroupHeader(title: group.title, count: group.rows.count, project: true)
              ForEach(group.rows) { row in
                NavigationLink(value: Route.session(row.session.id)) {
                  SessionRow(session: row.session, projectName: row.projectName, now: now)
                }
                .buttonStyle(RowStyle())
              }
            }
          }
        }
      }
      .padding(.bottom, 40)
    }
    .background(Color.bgApp)
    .refreshable { await model.refresh() }
    .navigationTitle("会话")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button { creating = true } label: { Icon("plus", size: 22) }
          .disabled(!model.isOpen)
          .accessibilityLabel("新建会话")
      }
    }
    .sheet(isPresented: $creating) { NewSessionView() }
    .confirmationDialog(model.macName, isPresented: $unpairing, titleVisibility: .visible) {
      Button("取消配对", role: .destructive) { model.forget() }
    } message: {
      Text(dialogText)
    }
  }

  private var macLine: some View {
    Button { unpairing = true } label: {
      HStack(spacing: 8) {
        Icon("smartphone")
        Text(location).font(.ui(13)).lineLimit(1)
      }
      .foregroundStyle(model.link == .refused ? Color.statusError : Color.textTertiary)
    }
    .buttonStyle(.plain)
    .padding(.horizontal, 20)
    .padding(.bottom, 4)
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

  private var location: String {
    switch model.link {
    case .open(let url): return "\(model.macName) · \(viaOf(url))"
    case .connecting: return "\(model.macName) · 连接中…"
    case .refused: return "\(model.macName) 不认识这台手机"
    case .offline: return "Mac 上的 Wavi 没有运行"
    }
  }
}

/// A group of rows. `project`: a project (or 等你处理) in the session list, which outranks the session rows under it;
/// otherwise a quiet subsection label (未提交 / 已提交 in Git · 变更).
struct GroupHeader: View {
  let title: String
  let count: Int
  var project = false

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(title).font(project ? .ui(17, 600) : .ui(13, 500)).foregroundStyle(project ? Color.textPrimary : Color.textSecondary)
      Text("\(count)").font(.mono(13)).foregroundStyle(Color.textTertiary)
    }
    .padding(.horizontal, 20)
    .padding(.top, 24)
    .padding(.bottom, 8)
  }
}

private struct SessionRow: View {
  let session: RemoteSession
  let projectName: String?
  let now: Double

  var body: some View {
    let waiting = session.status == .needsYou
    HStack(alignment: .top, spacing: 12) {
      StatusGlyph(status: session.status).padding(.top, 3)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text(session.title).font(.ui(16)).foregroundStyle(Color.textPrimary).lineLimit(1)
          Spacer(minLength: 0)
          Text(rowTime(session, now: now)).font(.mono(12)).foregroundStyle(Color.textTertiary)
        }
        Text(session.action ?? session.status.label).font(.ui(14)).foregroundStyle(waiting ? Color.statusAttention : Color.textSecondary).lineLimit(1)
        HStack(spacing: 8) {
          Text([projectName, session.branch].compactMap { $0 }.joined(separator: " · ")).font(.mono(12)).foregroundStyle(Color.textTertiary).lineLimit(1)
          Spacer(minLength: 0)
          AgentMark(agent: session.agent)
        }
      }
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 12)
    .contentShape(Rectangle())
  }
}

/// A list row's pressed state: the hover fill, no dimming of the text.
struct RowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.background(configuration.isPressed ? Color.bgHover : .clear)
  }
}
