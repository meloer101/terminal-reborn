// Link.swift's pure parts, with the cases of the Expo app's client.test.ts.
import Foundation
import Testing
@testable import Wavi

@Suite struct LinkTests {
  private func link(_ offer: [String: Any]) -> String {
    "wavi://pair?d=\(WaviCrypto.b64u(try! JSONSerialization.data(withJSONObject: offer)))"
  }

  @Test func readsAPairingLink() {
    let key = WaviCrypto.b64u(Data(repeating: 7, count: 32))
    let offer = Link.parseOffer(link(["v": 1, "name": "MacBook Pro", "urls": ["ws://100.101.1.2:7429", "nope"], "code": "k7q-x3m", "key": key]))
    #expect(offer == PairingOffer(name: "MacBook Pro", urls: ["ws://100.101.1.2:7429"], code: "K7QX3M", key: key))
    #expect(Link.parseOffer(link(["v": 2, "urls": ["ws://a:1"], "code": "K7QX3M", "key": key])) == nil)
    #expect(Link.parseOffer(link(["v": 1, "urls": [], "code": "K7QX3M", "key": key])) == nil)
    #expect(Link.parseOffer("wavi://pair?d=e30") == nil)
  }

  @Test func readsTypedAddressesAndCodes() {
    #expect(Link.addressURL("100.101.2.3", defaultPort: 7429) == "ws://100.101.2.3:7429")
    #expect(Link.addressURL("ws://192.168.1.5:8000/", defaultPort: 7429) == "ws://192.168.1.5:8000")
    #expect(Link.addressURL("a b", defaultPort: 7429) == nil)
    #expect(Link.normalizeCode("k7q-x3m") == "K7QX3M")
    #expect(Link.normalizeCode("K7QX30") == nil)
  }

  @Test func mergesAddressesWithoutDroppingKnownOnes() {
    #expect(Link.mergeURLs(["ws://192.168.1.9:7429"], current: "ws://100.101.1.2:7429", known: ["ws://100.101.1.2:7429", "ws://192.168.1.5:7429"]) == [
      "ws://192.168.1.9:7429", "ws://100.101.1.2:7429", "ws://192.168.1.5:7429"
    ])
    #expect(Link.mergeURLs(["not a url", "ws://a b"], current: nil, known: ["ws://x:1"]) == ["ws://x:1"])
    #expect(Link.mergeURLs((0..<20).map { "ws://10.0.0.\($0):7429" }, current: nil, known: []).count == 8)
  }
}
