// The pairing in the Keychain: this device only, readable after the first unlock (so a background wake can connect),
// never in a backup. Adapted from the author's marvis-coding-agent (packages/ios/Marvis/Store/HostStore.swift, MIT).
import Foundation
import Security

enum PairingStore {
  private static var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.wavi.remote", kSecAttrAccount as String: "wavi.pairing"] }

  static func load() -> Pairing? {
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return try? JSONDecoder().decode(Pairing.self, from: data)
  }

  static func save(_ pairing: Pairing) {
    clear()
    var item = base
    item[kSecValueData as String] = try? JSONEncoder().encode(pairing)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }

  static func clear() { SecItemDelete(base as CFDictionary) }
}
