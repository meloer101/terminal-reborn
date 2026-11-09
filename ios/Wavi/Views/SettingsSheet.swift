// 会话设置 (Figma 64A–64F, 模式 per 67C / 67D): a pill over the composer says the session's model · effort · 模式 (permission); tapping it opens
// a sheet with one row each, and a page per row to pick from. Only this session changes, never the agent's defaults.
// A terminal session mid-turn is locked until the turn ends (64E); an agent whose terminal has no way to change them
// for one session only shows them (64F).
import SwiftUI

/// Permission levels that run tools without asking (64C marks them with a shape and words, not colour alone).
private let unasked: Set<String> = ["auto", "full-access", "danger-full-access", "always-approve"]

private func kindLabel(_ kind: String) -> String {
  switch kind {
  case "model": "模型"
  case "effort": "思考程度"
  default: "模式"
  }
}

/// The pill over the composer (64A): Opus 5.5 · 高 · 询问 ⌄; dimmed while locked.
struct SettingsPill: View {
  let session: RemoteSession
  let settings: SessionSettings
  @State private var open = false

  var body: some View {
    Button { open = true } label: {
      HStack(spacing: 6) {
        ForEach(Array(settings.items.enumerated()), id: \.offset) { index, item in
          if index > 0 { Text("·").foregroundStyle(Color.textSecondary) }
          Text(item.currentLabel).foregroundStyle(index == 0 ? Color.textPrimary : Color.textSecondary)
            .fontWeight(index == 0 ? .medium : .regular)
        }
        Icon("chevron-down", size: 14).foregroundStyle(Color.textSecondary)
      }
      .font(.ui(.footnote))
      .lineLimit(1)
      .padding(.leading, 12)
      .padding(.trailing, 10)
      .frame(minHeight: 32)
      // Glass like the composer under it: the conversation scrolls beneath both.
      .glass(16, interactive: true)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .opacity(settings.locked != nil ? 0.4 : 1)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityLabel("会话设置")
    .accessibilityValue(settings.items.map(\.currentLabel).joined(separator: "，"))
    .sheet(isPresented: $open) { SessionSettingsSheet(session: session.id) }
  }
}

/// The sheet (64B): rows of the three settings; a page per row (64C / 64D).
struct SessionSettingsSheet: View {
  let session: String
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var page: String?
  @State private var busy: String?
  @State private var error: String?

  var body: some View {
    let remote = model.session(session)
    let settings = remote?.settings
    FittedSheet {
      VStack(alignment: .leading, spacing: 12) {
        if let settings, let page, let item = settings.items.first(where: { $0.kind == page }) {
          header(kindLabel(page), back: true)
          if let error { Notice(tone: .danger, message: error) }
          group(item.values.map { value in
            Row(label: value.label, checked: value.value == item.current, busy: busy == value.value,
              risky: item.kind == "permission" && unasked.contains(value.value)) { pick(item, value) }
          })
        } else if let settings {
          header("会话设置", back: false)
          if settings.locked != nil {
            Notice(tone: .info, message: "这一轮结束后可以改")
          } else if settings.readOnly == true, let remote {
            Notice(tone: .info, message: "终端里的 \(Shared.agent(remote.agent).name) 不能只改这个会话")
          }
          let editable = settings.locked == nil && settings.readOnly != true
          group(settings.items.map { item in
            Row(label: kindLabel(item.kind), value: item.currentLabel, chevron: editable, dimmed: settings.locked != nil) {
              if editable { page = item.kind }
            }
          })
        } else {
          header("会话设置", back: false)
          Notice(tone: .info, message: "这个会话不能在手机上改")
        }
      }
    } actions: {
      EmptyView()
    }
  }

  private func header(_ title: String, back: Bool) -> some View {
    HStack(spacing: 8) {
      if back {
        Button { page = nil; error = nil } label: { Icon("chevron-left", size: 20).frame(width: 36, height: 36) }
          .buttonStyle(.plain).foregroundStyle(Color.textPrimary).accessibilityLabel("返回")
      }
      Text(title).font(.ui(.headline)).foregroundStyle(Color.textPrimary)
    }
    .frame(minHeight: 36)
  }

  private func group(_ rows: [Row]) -> some View {
    VStack(spacing: 0) {
      ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
        row
        if index < rows.count - 1 { Rectangle().fill(Color.hairline).frame(height: 1).padding(.leading, 16) }
      }
    }
    .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusGroup))
  }

  private func pick(_ item: SessionSettings.Item, _ value: SessionSettings.Value) {
    guard busy == nil, value.value != item.current else { page = nil; return }
    busy = value.value
    error = nil
    Task {
      let result = await model.call(.setSetting(session: session, kind: item.kind, value: value.value))
      busy = nil
      if let failure = result.error { error = "没有改成：\(failure)" } else { page = nil }
    }
  }
}

/// One row: a label, then its value and chevron (64B), or a check before the label (64C / 64D).
private struct Row: View {
  let label: String
  var value: String?
  var checked: Bool?
  var busy = false
  var chevron = false
  var dimmed = false
  var risky = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        if let checked {
          Group {
            if busy { Spinner(color: .textSecondary) } else if checked { Icon("check", size: 20).foregroundStyle(Color.textPrimary) } else { Color.clear }
          }
          .frame(width: 20, height: 20)
        }
        Text(label).font(.ui(.callout)).foregroundStyle(Color.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
        if risky {
          HStack(spacing: 4) {
            Icon("triangle-alert", size: 14)
            Text("不再询问").font(.ui(.footnote, medium: true))
          }
          .foregroundStyle(Color.noticeWarning)
        }
        if let value { Text(value).font(.ui(.callout)).foregroundStyle(Color.textSecondary).lineLimit(1) }
        if chevron { Icon("chevron-right", size: 14).foregroundStyle(Color.textSecondary) }
      }
      .padding(.leading, 16)
      .padding(.trailing, 12)
      .frame(minHeight: 52)
      .contentShape(Rectangle())
    }
    .buttonStyle(RowStyle())
    .opacity(dimmed ? 0.4 : 1)
    .accessibilityAddTraits(checked == true ? .isSelected : [])
  }
}
