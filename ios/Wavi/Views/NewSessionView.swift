// 新建会话 (Figma 45H): the fields of the desktop's sheet (PRD F4) — project, 工作目录 (new worktree / current folder),
// the branch it starts from and its name, the agent — plus an optional first message. The Mac's window creates it the
// same way its own sheet does (src/renderer/remote/handler.ts); the phone then opens it.
import SwiftUI

struct NewSessionView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var project: String?
  @State private var data: Info?
  @State private var loadError: String?
  @State private var workdir = "worktree"
  @State private var base: String?
  @State private var branch = ""
  @State private var agent = "claude"
  @State private var prompt = ""
  @State private var busy = false
  @State private var error: String?

  private struct Info: Decodable {
    let info: NewSessionInfo
    let agents: [String]
  }

  private struct Created: Decodable { let session: String? }

  var body: some View {
    NavigationStack {
      Form {
        Picker("项目", selection: $project) {
          ForEach(model.sessions.projects) { Text($0.name).tag(Optional($0.id)) }
        }
        if let loadError { Text(loadError).foregroundStyle(Color.statusError) }
        if let data {
          Section {
            Picker("工作目录", selection: $workdir) {
              Text("新 worktree").tag("worktree")
              Text("当前目录").tag("current")
            }
            .pickerStyle(.segmented)
            .disabled(!data.info.repo)
            if workdir == "worktree" {
              Picker("基于", selection: $base) {
                let local = data.info.branches.filter { !$0.remote }
                let remote = data.info.branches.filter(\.remote)
                Section("本地分支") { ForEach(local, id: \.name) { Text($0.name).font(.mono(14)).tag(Optional($0.name)) } }
                if !remote.isEmpty { Section("远程分支") { ForEach(remote, id: \.name) { Text($0.name).font(.mono(14)).tag(Optional($0.name)) } } }
              }
              LabeledContent("分支名") {
                TextField("", text: $branch).font(.mono(14)).multilineTextAlignment(.trailing).autocorrectionDisabled().textInputAutocapitalization(.never)
              }
              if let problem = branchProblem(data) { Text(problem).foregroundStyle(Color.statusError) }
            }
          }
          Section {
            if data.agents.isEmpty {
              LabeledContent("智能体", value: "Mac 上没有安装智能体")
            } else {
              // A menu of our own: the system picker draws the chosen agent's mark flush against its name.
              LabeledContent("智能体") {
                Menu {
                  Picker("智能体", selection: $agent) {
                    ForEach(data.agents, id: \.self) { id in
                      Label { Text(Shared.agent(id).name) } icon: { AgentMark(agent: id, size: 16) }.tag(id)
                    }
                  }
                } label: {
                  HStack(spacing: 8) {
                    AgentMark(agent: agent, size: 16)
                    Text(Shared.agent(agent).name)
                    Image(systemName: "chevron.up.chevron.down").font(.footnote.weight(.medium)).foregroundStyle(Color.textTertiary)
                  }
                  .foregroundStyle(Color.textPrimary)
                }
              }
            }
          }
          Section("首条消息") {
            TextField("", text: $prompt, axis: .vertical).lineLimit(4...8)
          }
        } else if loadError == nil {
          ProgressView().frame(maxWidth: .infinity)
        }
        if let error { Text(error).foregroundStyle(Color.statusError) }
      }
      .navigationTitle("新建会话")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await create() } } label: { if busy { ProgressView() } else { Text("创建") } }
            .disabled(!ready || busy)
        }
      }
    }
    .onAppear {
      if project == nil { project = model.sessions.sessions.max { $0.activity < $1.activity }?.projectId ?? model.sessions.projects.first?.id }
    }
    .task(id: project) { await load() }
  }

  private var ready: Bool {
    guard let data, project != nil, data.agents.contains(agent) else { return false }
    return workdir == "current" || (base != nil && branchProblem(data) == nil)
  }

  /// Empty or already a local branch; anything else git refuses comes back from the Mac.
  private func branchProblem(_ data: Info) -> String? {
    if branch.trimmingCharacters(in: .whitespaces).isEmpty { return "要填分支名" }
    return data.info.branches.contains { !$0.remote && $0.name == branch } ? "已经有这个分支" : nil
  }

  private func load() async {
    guard let project else { return }
    data = nil
    loadError = nil
    let result = await model.call(.newSessionInfo(project: project))
    guard let next = result.decode(Info.self) else {
      loadError = result.error ?? "没有读到这个项目"
      return
    }
    data = next
    workdir = next.info.repo ? "worktree" : "current"
    base = next.info.defaultBranch ?? next.info.currentBranch ?? next.info.branches.first { !$0.remote }?.name
    branch = generateBranchName(prefix: next.info.prefix, taken: Set(next.info.branches.map(\.name)))
    if !next.agents.contains(agent) { agent = next.agents.first ?? "claude" }
  }

  private func create() async {
    guard ready, let project else { return }
    busy = true
    error = nil
    let worktree = workdir == "worktree"
    let result = await model.call(.newSession(project: project, workdir: workdir, agent: agent, base: worktree ? base : nil, branch: worktree ? branch.trimmingCharacters(in: .whitespaces) : nil, prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : prompt))
    busy = false
    if let failure = result.error {
      error = failure
      return
    }
    model.opening = result.decode(Created.self)?.session
    dismiss()
  }
}
