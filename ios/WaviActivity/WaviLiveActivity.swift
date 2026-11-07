// The Live Activity as Figma 47 / 47′ draws it: the Dynamic Island's compact / minimal / expanded presentations (always on
// black, so in the dark tokens) and the Lock Screen card (the phone's appearance). Times count on their own between
// updates; buttons are the intents in LiveActivity/ActivityIntents.swift.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct WaviActivityBundle: WidgetBundle {
  var body: some Widget { WaviLiveActivity() }
}

struct WaviLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WaviActivityAttributes.self) { context in
      LockCard(state: context.state)
        .activityBackgroundTint(Color.activityBackground)
        .activitySystemActionForegroundColor(Color.textPrimary)
        .widgetURL(ActivityLink.url(session: context.state.session))
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          StatusWord(state: state).frame(maxHeight: .infinity).padding(.leading, 6).dark()
        }
        DynamicIslandExpandedRegion(.trailing) {
          Age(state: state).frame(maxHeight: .infinity).padding(.trailing, 6).dark()
        }
        DynamicIslandExpandedRegion(.bottom) {
          ActivityBody(state: state, island: true).padding(.horizontal, 6).padding(.top, 4).dark()
        }
      } compactLeading: {
        Glyph(kind: state.kind).dark()
      } compactTrailing: {
        CompactValue(state: state).dark()
      } minimal: {
        Glyph(kind: state.kind).dark()
      }
      .keylineTint(state.kind.waiting ? Color.statusAttention : nil)
      .widgetURL(ActivityLink.url(session: state.session))
    }
  }
}

extension WaviActivityAttributes.ContentState.Kind {
  var waiting: Bool { self == .permission || self == .question }

  var status: SessionStatus {
    switch self {
    case .permission, .question: .needsYou
    case .running: .running
    case .done: .doneUnread
    case .error: .error
    case .idle: .idle
    }
  }

  /// 空闲 is no status colour: the text colour (black / white), not grey.
  var color: Color {
    switch self {
    case .permission, .question: .statusAttention
    case .running: .statusWorking
    case .done: .statusDone
    case .error: .statusError
    case .idle: .textPrimary
    }
  }
}

private extension View {
  /// The island is black in either appearance.
  func dark() -> some View { environment(\.colorScheme, .dark) }
}

/// The status glyph at the island's 16 pt.
private struct Glyph: View {
  let kind: WaviActivityAttributes.ContentState.Kind

  var body: some View {
    Group {
      // The app's idle ring is grey; here it is in the text colour (Figma 47′).
      if kind == .idle {
        Circle().stroke(Color.textPrimary, lineWidth: 1.5).frame(width: 6.5, height: 6.5).frame(width: 14, height: 14)
      } else {
        StatusGlyph(status: kind.status)
      }
    }
    .scaleEffect(16 / 14).frame(width: 16, height: 16)
  }
}

/// `2分钟`, counting on its own; rounded up, so a prompt that just arrived reads 1分钟 rather than 0. A counting text is
/// as wide as the widest value it could take, so it gets a width of its own (`12分钟` fits).
private struct Elapsed: View {
  let since: Date
  var width: CGFloat = 48

  var body: some View {
    Text(.currentDate, format: .offset(to: since.addingTimeInterval(-59), allowedFields: [.minute, .hour, .day], maxFieldCount: 1, sign: .never)
      .locale(Locale(identifier: "zh_Hans_CN")))
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .frame(maxWidth: width, alignment: .trailing)
  }
}

/// Compact trailing: how long it has waited, how many run, or the outcome — in the status colour, next to the glyph.
private struct CompactValue: View {
  let state: WaviActivityAttributes.ContentState

  var body: some View {
    Group {
      switch state.kind {
      case .permission, .question: Elapsed(since: state.since, width: 44).font(.ui(.footnote, medium: true))
      case .running: Text("\(state.runningCount)").font(.mono(.subheadline, medium: true)).foregroundStyle(Color.textPrimary)
      case .done: Text("完成").font(.ui(.footnote, medium: true))
      case .error: Text("出错").font(.ui(.footnote, medium: true))
      case .idle: Text("空闲").font(.ui(.footnote, medium: true))
      }
    }
    .foregroundStyle(state.kind.color)
    .monospacedDigit()
  }
}

/// 等你确认 / 3 个运行中 / 完成 …: glyph and word, never colour alone.
private struct StatusWord: View {
  let state: WaviActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 6) {
      Glyph(kind: state.kind)
      Text(word).font(.ui(.footnote, medium: true)).foregroundStyle(state.kind.color).lineLimit(1)
    }
  }

  private var word: String {
    switch state.kind {
    case .permission: "等你确认"
    case .question: "等你回答"
    case .running: "\(state.runningCount) 个运行中"
    case .done: "完成"
    case .error: "出错"
    case .idle: "空闲"
    }
  }
}

/// 已等 2分钟 while it waits, how long ago it finished; nothing for the running list (each row has its own).
private struct Age: View {
  let state: WaviActivityAttributes.ContentState

  var body: some View {
    Group {
      if state.kind.waiting {
        HStack(spacing: 4) {
          Text("已等")
          Elapsed(since: state.since)
        }
      } else if state.kind != .running {
        Elapsed(since: state.since)
      }
    }
    .font(.ui(.caption, medium: true))
    .foregroundStyle(Color.textSecondary)
    .lineLimit(1)
  }
}

/// The Lock Screen: the island's expanded content with its status line on top.
private struct LockCard: View {
  let state: WaviActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        StatusWord(state: state)
        Spacer(minLength: 8)
        Age(state: state)
      }
      ActivityBody(state: state, island: false)
    }
    .padding(14)
  }
}

/// Under the status line: the session and what it waits on (with the buttons that answer it), or the running ones.
private struct ActivityBody: View {
  let state: WaviActivityAttributes.ContentState
  let island: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if state.kind == .running {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(state.running, id: \.id) { row in
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: 8) {
                AgentMark(agent: row.agent, size: 16)
                Text(row.title).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary).lineLimit(1)
                Spacer(minLength: 8)
                Elapsed(since: row.since).font(.ui(.caption, medium: true)).foregroundStyle(Color.textSecondary)
              }
              Text(row.action).font(.ui(.footnote, medium: true)).foregroundStyle(Color.textSecondary).lineLimit(1).padding(.leading, 24)
            }
          }
        }
      } else {
        HStack(spacing: 8) {
          if !state.agent.isEmpty { AgentMark(agent: state.agent, size: 16) }
          Text(state.title).font(.ui(.callout, medium: true)).foregroundStyle(Color.textPrimary).lineLimit(1)
        }
        // A failed answer takes the detail's line: the expanded island has no room for another (160 pt at most).
        Group {
          if let failure = state.failure {
            Text(failure).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.statusError).lineLimit(1)
          } else {
            detail
          }
        }
        .padding(.leading, state.agent.isEmpty ? 0 : 24)
        if state.answerable, let prompt = state.prompt {
          buttons(prompt).padding(.top, 8)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private var detail: some View {
    if state.kind == .permission {
      HStack(spacing: 6) {
        Text(state.detail).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textSecondary)
        if let subject = state.subject { Text(subject).font(.mono(medium: true)).foregroundStyle(Color.textPrimary).truncationMode(.middle) }
      }
      .lineLimit(1)
    } else {
      Text(state.detail).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textSecondary).lineLimit(2)
    }
  }

  @ViewBuilder private func buttons(_ prompt: String) -> some View {
    HStack(spacing: 8) {
      if state.kind == .permission {
        Button(intent: AnswerPermissionIntent(prompt: prompt, decision: "deny")) { label("拒绝", primary: false) }
        Button(intent: AnswerPermissionIntent(prompt: prompt, decision: "allow-once")) { label("允许", primary: true) }
      } else {
        ForEach(state.options, id: \.self) { option in
          Button(intent: AnswerQuestionIntent(prompt: prompt, question: state.detail, option: option)) { label(option, primary: false) }
        }
        if state.more {
          Link(destination: ActivityLink.url(session: state.session)) { label("更多", primary: false) }
        }
      }
    }
    .buttonStyle(.plain)
  }

  private func label(_ text: String, primary: Bool) -> some View {
    Text(text).font(.ui(.subheadline, medium: true)).lineLimit(1).minimumScaleFactor(0.8)
      .foregroundStyle(primary ? Color.solidOn : Color.textPrimary)
      .frame(maxWidth: .infinity, minHeight: 40)
      .padding(.horizontal, 8)
      .background(primary ? Color.solidFill : Color.activityButton, in: shape)
  }

  /// Concentric with the island (a capsule) or the Lock Screen card (24 − its 14 margin).
  private var shape: AnyShape { island ? AnyShape(Capsule()) : AnyShape(RoundedRectangle(cornerRadius: 10)) }
}
