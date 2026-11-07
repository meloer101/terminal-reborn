// Diffs (Figma 63C7 / 63C8): the full numbered view (old / new gutters, sign, code; hunk rows), the few-line MiniDiff
// under an Edit row in the conversation (61B), the tool detail (an Edit's diff, or another tool's 输入 and 输出) and one
// file of Git · 变更.
import SwiftUI

struct DiffView: View {
  let rows: [DiffRow]

  var body: some View {
    ScrollView([.horizontal, .vertical]) {
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
          switch row {
          case .hunk(let text):
            HStack(spacing: 0) {
              Color.clear.frame(width: 92)
              Text(text).foregroundStyle(Color.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
            .background(Color.fillSubtle)
          case .line(let sign, let old, let new, let code):
            HStack(spacing: 0) {
              Text(old.map(String.init) ?? "").frame(width: 36, alignment: .trailing).foregroundStyle(Color.textSecondary)
              Text(new.map(String.init) ?? "").frame(width: 36, alignment: .trailing).foregroundStyle(Color.textSecondary)
              Text(sign == "-" ? "−" : String(sign)).frame(width: 20).foregroundStyle(sign == "+" ? Color.diffAddFg : sign == "-" ? Color.diffDelFg : Color.textSecondary)
              Text(code).foregroundStyle(Color.textPrimary).padding(.trailing, 16)
            }
            .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
            .background(sign == "+" ? Color.diffAddBg : sign == "-" ? Color.diffDelBg : .clear)
          }
        }
      }
      .font(.mono(.caption))
      .fixedSize(horizontal: true, vertical: false)
    }
    .background(Color.bgGrouped)
  }
}

/// The first lines of an Edit, under its row.
struct MiniDiff: View {
  let lines: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
        let sign = line.first == "+" || line.first == "-" ? line.first! : " "
        HStack(spacing: 8) {
          Text(sign == "-" ? "−" : String(sign)).foregroundStyle(sign == "+" ? Color.diffAddFg : sign == "-" ? Color.diffDelFg : Color.textSecondary)
          Text(String(line.dropFirst())).foregroundStyle(sign == " " ? Color.textSecondary : Color.textPrimary).lineLimit(1)
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .background(sign == "+" ? Color.diffAddBg : sign == "-" ? Color.diffDelBg : .clear)
      }
    }
    .font(.mono(.caption))
    .padding(.vertical, 8)
    .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
  }
}

private struct NavTitle: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(spacing: 2) {
      Text(title).font(.ui(.headline)).foregroundStyle(Color.textPrimary).lineLimit(1)
      Text(subtitle).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).lineLimit(1)
    }
  }
}

/// 工具详情 (45D): an Edit / Write as its full numbered diff; any other tool call as its input and output.
struct ToolView: View {
  let session: String
  let item: String
  @Environment(AppModel.self) private var model

  var body: some View {
    let tool = model.watching == session ? model.conversation?.feed.items.first { $0.id == item && $0.kind == "tool" } : nil
    Group {
      if let tool, let diff = tool.diff {
        VStack(spacing: 0) {
          DiffView(rows: hunkRows(diff.hunks))
          if diff.truncated { Text("只显示了前 400 行").font(.ui(.footnote)).foregroundStyle(Color.textSecondary).frame(maxWidth: .infinity).padding(12).background(Color.bgGrouped) }
        }
        .toolbar {
          ToolbarItem(placement: .principal) {
            let (name, dir) = splitPath(diff.path)
            NavTitle(title: name, subtitle: [dir, tool.name ?? "", "\(diff.hunks.count) 处"].filter { !$0.isEmpty }.joined(separator: " · "))
          }
          ToolbarItem(placement: .topBarTrailing) { Counts(added: diff.added, removed: diff.removed) }
        }
      } else if let tool {
        ScrollView {
          VStack(alignment: .leading, spacing: 8) {
            Text("输入").font(.ui(.footnote, medium: true)).foregroundStyle(Color.textSecondary)
            Text(tool.arg ?? "").font(.mono()).lineSpacing(4).foregroundStyle(Color.textPrimary).textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
            if let output = tool.output, !output.isEmpty {
              Text("输出").font(.ui(.footnote, medium: true)).foregroundStyle(Color.textSecondary).padding(.top, 16)
              Text(output).font(.mono(.caption)).lineSpacing(4).foregroundStyle(tool.state == "error" ? Color.statusError : Color.textPrimary).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
            }
          }
          .padding(Metric.margin)
        }
        .toolbar {
          ToolbarItem(placement: .principal) { NavTitle(title: tool.name ?? "工具", subtitle: tool.state == "running" ? "运行中" : tool.state == "error" ? "出错" : "完成") }
        }
      } else {
        EmptyState(title: "这次工具调用不在当前的对话里")
      }
    }
    .background(Color.bgApp)
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// One file of Git · 变更, drawn like 45D: `git diff` as numbered rows.
struct FileDiffView: View {
  let session: String
  let path: String
  let scope: String
  let oldPath: String?
  let untracked: Bool
  @Environment(AppModel.self) private var model
  @State private var rows: [DiffRow]?
  @State private var error: String?

  private struct Text_: Decodable { let text: String? }

  var body: some View {
    let (name, dir) = splitPath(path)
    Group {
      if let rows {
        if rows.isEmpty { EmptyState(title: "没有可显示的文本改动") } else { DiffView(rows: rows) }
      } else if let error {
        EmptyState(title: error)
      } else {
        Spinner(color: .textSecondary).frame(maxWidth: .infinity, maxHeight: .infinity).accessibilityLabel("正在读取改动")
      }
    }
    .background(Color.bgApp)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .principal) { NavTitle(title: name, subtitle: [dir, scope == "committed" ? "已提交" : "未提交"].filter { !$0.isEmpty }.joined(separator: " · ")) }
    }
    .task {
      let result = await model.call(.diff(session: session, path: path, scope: scope, oldPath: oldPath, untracked: untracked))
      if let data = result.decode(Text_.self) { rows = unifiedRows(data.text ?? "") } else { error = result.error ?? "没有读到改动" }
    }
  }
}
