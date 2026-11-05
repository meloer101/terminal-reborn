// What the app takes from the Mac's src/shared instead of its own copy (Resources/Shared.json, written and checked by
// src/main/remote/phone-assets.test.ts): status words, agent names, branch-name words, the link's limits.
import Foundation

struct Shared: Decodable, Sendable {
  struct Agent: Decodable, Sendable, Hashable {
    let id: String
    let name: String
    /// Has a logo in Assets.xcassets/Agents; the others show their first letter.
    let mark: Bool
  }
  struct Words: Decodable, Sendable {
    let adjectives: [String]
    let nouns: [String]
  }
  struct Limits: Decodable, Sendable {
    let codeMs: Double
    let textChars: Int
    let photos: Int
    let photoBytes: Int
    let feedPage: Int
  }
  struct Pairing: Decodable, Sendable {
    let alphabet: String
    let length: Int
    let defaultPort: Int
  }
  let statusLabel: [String: String]
  let agents: [Agent]
  let branchWords: Words
  let limits: Limits
  let pairing: Pairing

  static let data: Shared = {
    guard let url = Bundle.main.url(forResource: "Shared", withExtension: "json"), let bytes = try? Data(contentsOf: url),
      let shared = try? JSONDecoder().decode(Shared.self, from: bytes)
    else { fatalError("Resources/Shared.json is missing or malformed: run the phone-assets test with WAVI_WRITE_PHONE_ASSETS=1") }
    return shared
  }()

  static func agent(_ id: String) -> Agent { data.agents.first { $0.id == id } ?? Agent(id: id, name: id, mark: false) }
}
