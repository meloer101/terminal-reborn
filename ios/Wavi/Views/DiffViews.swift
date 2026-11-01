// Diffs as Figma 45 draws them: the full numbered view of 45D (old / new gutters, sign, code; hunk rows), the few-line
// MiniDiff under an Edit row in the conversation (45C), the tool detail (45D) and one file of Git · 变更.
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
              Text(text).foregroundStyle(Color.textTertiary)
            }
            .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
            .background(Color.bgHover)
          case .line(let sign, let old, let new, let code):
            HStack(spacing: 0) {
              Text(old.map(String.init) ?? "").frame(width: 36, alignment: .trailing).foregroundStyle(Color.textTertiary)
              Text(new.map(String.init) ?? "").frame(width: 36, alignment: .trailing).foregroundStyle(Color.textTertiary)
              Text(sign == "-" ? "−" : String(sign)).frame(width: 20).foregroundStyle(sign == "+" ? Color.diffAddFg : sign == "-" ? Color.diffDelFg : Color.textTertiary)
              Text(code).foregroundStyle(Color.termFg).padding(.trailing, 16)
            }
            .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
            .background(sign == "+" ? Color.diffAddBg : sign == "-" ? Color.diffDelBg : .clear)
          }
        }
      }
      .font(.mono(12))
      .fixedSize(horizontal: true, vertical: false)
    }
    .background(Color.bgInset)
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
          Text(sign == "-" ? "−" : String(sign)).foregroundStyle(sign == "+" ? Color.diffAddFg : sign == "-" ? Color.diffDelFg : Color.textTertiary)
          Text(String(line.dropFirst())).foregroundStyle(sign == " " ? Color.textSecondary : Color.textPrimary).lineLimit(1)
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .background(sign == "+" ? Color.diffAddBg : sign == "-" ? Color.diffDelBg : .clear)
      }
    }
    .font(.mono(12))
    .padding(.vertical, 8)
    .background(Color.bgInset, in: RoundedRectangle(cornerRadius: 8))
  }
}

private struct NavTitle: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(spacing: 2) {
      Text(title).font(.ui(16, 500)).foregroundStyle(Color.textPrimary).lineLimit(1)
      Text(subtitle).font(.mono(12)).foregroundStyle(Color.textTertiary).lineLimit(1)
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
          if diff.truncated { Text("只显示了前 400 行").font(.ui(13)).foregroundStyle(Color.textTertiary).frame(maxWidth: .infinity).padding(12).background(Color.bgInset) }
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
          VStack(alignment: .leading, spacing: 12) {
            Text(tool.arg ?? "").font(.mono(13)).lineSpacing(6).foregroundStyle(Color.textPrimary).textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading).padding(14).background(Color.bgInset, in: RoundedRectangle(cornerRadius: 10))
            if let output = tool.output, !output.isEmpty {
              Text(output).font(.mono(12)).lineSpacing(5).foregroundStyle(tool.state == "error" ? Color.statusError : Color.termFg).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(14).background(Color.bgInset, in: RoundedRectangle(cornerRadius: 10))
            }
          }
          .padding(20)
        }
        .toolbar {
          ToolbarItem(placement: .principal) { NavTitle(title: tool.name ?? "工具", subtitle: tool.state == "running" ? "运行中" : tool.state == "error" ? "出错" : "完成") }
        }
      } else {
        Color.clear
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
        if rows.isEmpty { message("没有可显示的文本改动") } else { DiffView(rows: rows) }
      } else if let error {
        message(error)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).padding(20)
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

  private func message(_ text: String) -> some View {
    Text(text).font(.ui(15)).foregroundStyle(Color.textTertiary).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(20)
  }
}
