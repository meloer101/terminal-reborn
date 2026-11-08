// The app's side of the Live Activity (PRD F22 S2): one activity, kept in step with what Wavi sends while the app can
// hear it (in the foreground and the moments after it leaves); updates while the phone is locked are S3 / S4. The
// island's buttons land in `answer`, in this process.
import ActivityKit
import UIKit

@MainActor
final class LiveActivities {
  private var activity: Activity<WaviActivityAttributes>?
  private var shown: ActivityState?
  private var pushedAt: Date?

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
    // The same card again is not sent (Wavi lists sessions every 250 ms); only its stale date is renewed, at half the
    // window, so a card that stays the same while the Mac is there does not read 已过期.
    func card(_ s: ActivityState?) -> ActivityState? {
      var s = s
      s?.updated = nil
      return s
    }
    let fresh = pushedAt.map { Date().timeIntervalSince($0) < ActivityLimits.recentMs / 2000 } ?? false
    if card(state) == card(shown), state == nil || fresh { return nil }
    shown = state
    pushedAt = Date()
    guard let state else {
      let ending = activity
      activity = nil
      return Task { await ending?.end(nil, dismissalPolicy: .immediate) }
    }
    // A finished or failed session goes stale once it is no longer recent, 空闲 once its half hour is up (the app may be
    // suspended then and end it only when it next runs).
    // Waiting and running cards go stale when nothing has refreshed them for a while (the Mac is gone, or the app is
    // suspended): the card then says 已过期 and when it was last updated (Figma 62I) instead of passing old news as live.
    let stale: Date? = switch state.kind {
    case .done, .error: state.since.addingTimeInterval(ActivityLimits.recentMs / 1000)
    case .idle: state.since.addingTimeInterval(ActivityLimits.idleMs / 1000)
    default: Date().addingTimeInterval(ActivityLimits.recentMs / 1000)
    }
    let content = ActivityContent(state: state, staleDate: stale)
    if let activity, Self.live(activity) {
      let config = alert && state.prompt != nil && UIApplication.shared.applicationState != .active
        ? AlertConfiguration(title: "\(state.kind == .permission ? "等你确认" : "等你回答")", body: "\(state.title)", sound: .default) : nil
      return Task { await activity.update(content, alertConfiguration: config) }
    }
    // 空闲 only lets a card end quietly; it never opens one.
    guard state.kind != .idle else {
      shown = nil
      return nil
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
