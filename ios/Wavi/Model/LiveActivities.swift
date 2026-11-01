// The app's side of the Live Activity (PRD F22 S2): one activity, kept in step with what Wavi sends while the app can
// hear it (in the foreground and the moments after it leaves); updates while the phone is locked are S3 / S4. The
// island's buttons land in `answer`, in this process.
import ActivityKit
import UIKit

@MainActor
final class LiveActivities {
  private var activity: Activity<WaviActivityAttributes>?
  private var shown: ActivityState?

  /// What the card shows now.
  var current: ActivityState? { shown }

  init() {
    // One left from an earlier launch is this one's; any other (ended, or a duplicate) goes.
    let all = Activity<WaviActivityAttributes>.activities
    activity = all.first { Self.live($0) }
    shown = activity?.content.state
    Self.end(all.filter { $0.id != activity?.id })
  }

  /// Still on screen and updatable: active, or stale (a finished session's card past its recent window).
  private static func live(_ activity: Activity<WaviActivityAttributes>) -> Bool {
    activity.activityState == .active || activity.activityState == .stale
  }

  private static func end(_ activities: [Activity<WaviActivityAttributes>]) {
    for activity in activities { Task { await activity.end(nil, dismissalPolicy: .immediate) } }
  }

  /// What Wavi said changed (or the phone was unpaired: nil ends it). `alert` lights the island up when the app is not
  /// in front (a prompt Wavi had not listed before; the app shows its own sheet). The task is the update, for a caller
  /// that has to wait for it (an intent, before the system suspends the app again).
  @discardableResult
  func show(_ state: ActivityState?, mac: String, alert: Bool = false) -> Task<Void, Never>? {
    guard state != shown else { return nil }
    shown = state
    guard let state else {
      let ending = activity
      activity = nil
      return Task { await ending?.end(nil, dismissalPolicy: .immediate) }
    }
    // A finished or failed session goes stale once it is no longer recent.
    let stale = state.kind == .done || state.kind == .error ? state.since.addingTimeInterval(ActivityLimits.recentMs / 1000) : nil
    let content = ActivityContent(state: state, staleDate: stale)
    if let activity, Self.live(activity) {
      let config = alert && state.prompt != nil && UIApplication.shared.applicationState != .active
        ? AlertConfiguration(title: "\(state.kind == .permission ? "等你确认" : "等你回答")", body: "\(state.title)", sound: .default) : nil
      return Task { await activity.update(content, alertConfiguration: config) }
    }
    // Starting is allowed only in the foreground; in the background this fails and the next change (or coming back to
    // the foreground) tries again.
    Self.end(Activity<WaviActivityAttributes>.activities)
    activity = ActivityAuthorizationInfo().areActivitiesEnabled
      ? try? Activity.request(attributes: WaviActivityAttributes(mac: mac), content: content, pushType: nil) : nil
    if activity == nil { shown = nil }
    return nil
  }

  /// 允许 / 拒绝 / an option from the island or the Lock Screen.
  static func answer(prompt: String, command: PhoneCommand) async {
    await AppModel.shared.answerFromActivity(prompt: prompt, command: command)
  }
}
