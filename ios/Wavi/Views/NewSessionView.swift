// 新建会话 (Figma 61F, states 63F1–63F5; the system Form, v1.119): the fields of the desktop's sheet (PRD F4) — project, 工作目录 (new worktree / current folder),
// the branch it starts from and its name, the agent and its model (67A / 67B: the agent's own list, from the Mac) — plus an optional first message. The Mac's window creates it the
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
  /// The agent's models (not GUI: no row; none listed: only 默认) and the one picked (nil: the agent's default).
  @State private var models: AgentModels?
  @State private var pickedModel: String?
  @State private var prompt = ""
  @State private var busy = false
  @State private var error: String?

  private struct Info: Decodable {
    let info: NewSessionInfo
    let agents: [String]
  }

  private struct Created: Decodable { let session: String? }

  private struct AgentModels: Decodable {
    struct Model: Decodable { let value: String; let label: String }
    /// nil from a Mac older than v1.161's row: an empty list then means no row.
    let gui: Bool?
    let models: [Model]
    let current: String?
  }

  var body: some View {
    NavigationStack {
      Form {
        Picker("项目", selection: $project) {
          ForEach(model.sessions.projects) { Text($0.name).tag(Optional($0.id)) }
        }
        if let error { Notice(tone: .danger, message: "没有建成：\(error)").listRowInsets(EdgeInsets()).listRowBackground(Color.clear) }
        if let loadError { Text(loadError).foregroundStyle(Color.noticeDanger) }
        if let data {
          Section {
            Picker("工作目录", selection: $workdir) {
              Text("新 worktree").tag("worktree")
              Text("当前目录").tag("current")
            }
            .pickerStyle(.segmented)
            .disabled(!data.info.repo)
            if !data.info.repo { LabeledContent("工作目录", value: "不是 git 仓库，只能在当前目录") }
            if workdir == "worktree" {
              Picker("基于", selection: $base) {
                let local = data.info.branches.filter { !$0.remote }
                let remote = data.info.branches.filter(\.remote)
                Section("本地分支") { ForEach(local, id: \.name) { Text($0.name).font(.mono()).tag(Optional($0.name)) } }
                if !remote.isEmpty { Section("远程分支") { ForEach(remote, id: \.name) { Text($0.name).font(.mono()).tag(Optional($0.name)) } } }
              }
              LabeledContent("分支名") {
                TextField("", text: $branch).font(.mono()).multilineTextAlignment(.trailing).autocorrectionDisabled().textInputAutocapitalization(.never)
              }
              if let problem = branchProblem(data) { Text(problem).font(.ui(.footnote)).foregroundStyle(Color.noticeDanger) }
            }
          }
          Section {
            if data.agents.isEmpty {
              LabeledContent("智能体") { Text("Mac 上没有安装").foregroundStyle(Color.noticeDanger) }
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
                    Image(systemName: "chevron.up.chevron.down").font(.footnote.weight(.medium)).foregroundStyle(Color.textSecondary)
                  }
                  .foregroundStyle(Color.textPrimary)
                }
              }
              modelRow
            }
          }
          Section("首条消息") {
            TextField("", text: $prompt, axis: .vertical).lineLimit(4...8)
          }
        } else if loadError == nil {
          Spinner(color: .textSecondary).frame(maxWidth: .infinity).accessibilityLabel("正在读取项目")
        }
      }
      .scrollContentBackground(.hidden)
      .background(Color.bgApp)
      .navigationTitle("新建会话")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await create() } } label: { if busy { Spinner(color: .textPrimary) } else { Text("创建") } }
            .disabled(!ready || busy)
        }
      }
    }
    .onAppear {
      if project == nil { project = model.sessions.sessions.max { $0.activity < $1.activity }?.projectId ?? model.sessions.projects.first?.id }
    }
    .task(id: project) { await load() }
    .task(id: agent) { await loadModels() }
  }

  /// 模型 under 智能体 (67A); a menu like the agent's (67B). Only 默认 when a GUI agent lists none (one that names its
  /// models only once a session runs, or the Mac could not ask it); no row for an agent that runs only in a terminal.
  @ViewBuilder private var modelRow: some View {
    if models == nil {
      LabeledContent("模型") { Spinner(color: .textSecondary) }.accessibilityLabel("正在读取模型")
    } else if let models, models.models.isEmpty, models.gui == true {
      LabeledContent("模型", value: "默认")
    } else if let models, !models.models.isEmpty {
      LabeledContent("模型") {
        Menu {
          Picker("模型", selection: $pickedModel) {
            if models.current == nil { Text("默认").tag(String?.none) }
            ForEach(models.models, id: \.value) { Text($0.label).tag(Optional($0.value)) }
          }
        } label: {
          HStack(spacing: 8) {
            Text(models.models.first { $0.value == pickedModel }?.label ?? "默认")
            Image(systemName: "chevron.up.chevron.down").font(.footnote.weight(.medium)).foregroundStyle(Color.textSecondary)
          }
          .foregroundStyle(Color.textPrimary)
        }
      }
    }
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

  /// Asking an agent that has not run yet can take a few seconds on the Mac; 创建 does not wait for it (the agent's default).
  private func loadModels() async {
    let asked = agent
    models = nil
    pickedModel = nil
    let result = await model.call(.agentModels(agent: asked))
    guard asked == agent else { return }
    // Not read: the agent starts with its default, so the row says so.
    let next = result.decode(AgentModels.self) ?? AgentModels(gui: true, models: [], current: nil)
    models = next
    pickedModel = next.current
  }

  private func create() async {
    guard ready, let project else { return }
    busy = true
    error = nil
    let worktree = workdir == "worktree"
    let result = await model.call(.newSession(project: project, workdir: workdir, agent: agent, base: worktree ? base : nil, branch: worktree ? branch.trimmingCharacters(in: .whitespaces) : nil, prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : prompt, model: pickedModel))
    busy = false
    if let failure = result.error {
      error = failure
      return
    }
    model.opening = result.decode(Created.self)?.session
    dismiss()
  }
}
