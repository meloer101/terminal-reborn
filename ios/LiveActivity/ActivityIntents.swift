// The Live Activity's buttons (Figma 47C / 47D): 允许 / 拒绝 and a question's options. In both targets, so the system
// runs them in the app's process (launching it in the background when it is not running), where the app reaches the
// Mac and sends the answer as the prompt sheet would (Model/LiveActivities.swift).
import AppIntents
import Foundation

struct AnswerPermissionIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "回答权限请求"
  static let isDiscoverable = false

  @Parameter(title: "请求") var prompt: String
  /// allow-once / deny
  @Parameter(title: "回答") var decision: String

  init() {}

  init(prompt: String, decision: String) {
    self.prompt = prompt
    self.decision = decision
  }

  func perform() async throws -> some IntentResult {
    #if WAVI_APP
      await LiveActivities.answer(prompt: prompt, command: .permission(prompt: prompt, decision: decision))
    #endif
    return .result()
  }
}

struct AnswerQuestionIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "回答提问"
  static let isDiscoverable = false

  @Parameter(title: "提问") var prompt: String
  @Parameter(title: "问题") var question: String
  @Parameter(title: "选项") var option: String

  init() {}

  init(prompt: String, question: String, option: String) {
    self.prompt = prompt
    self.question = question
    self.option = option
  }

  func perform() async throws -> some IntentResult {
    #if WAVI_APP
      await LiveActivities.answer(prompt: prompt, command: .answer(prompt: prompt, answers: [question: option]))
    #endif
    return .result()
  }
}
