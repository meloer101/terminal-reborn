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

  @Test func saysWhyTheMacCannotBeReached() {
    let lan = "ws://192.168.1.5:7429", ts = "ws://100.101.1.2:7429"
    // Refused at once: the Mac answered, nothing listens on the port.
    #expect(Link.offlineReason([lan: .portClosed, ts: .timeout], tailscaleUp: true) == .waviNotRunning)
    // Every address timed out: the Mac sleeps or is off the network.
    #expect(Link.offlineReason([lan: .timeout, ts: .timeout], tailscaleUp: true) == .macAsleep)
    // Only Tailscale addresses, and this phone has no Tailscale address: Tailscale is off here.
    #expect(Link.offlineReason([ts: .timeout], tailscaleUp: false) == .tailscaleOff)
    #expect(Link.offlineReason([ts: .timeout], tailscaleUp: true) == .macAsleep)
    #expect(Link.offlineReason([lan: .noNetwork], tailscaleUp: false) == .noNetwork)
    #expect(Link.offlineReason([:], tailscaleUp: true) == .unknown)
    #expect(Link.offlineReason([lan: .other], tailscaleUp: true) == .unknown)
  }

  @Test func readsTailscaleAddressesAndProtocols() {
    #expect(Link.isTailscale("ws://100.101.1.2:7429"))
    #expect(Link.isTailscale("ws://mac.tail1234.ts.net:7429"))
    #expect(!Link.isTailscale("ws://100.128.0.1:7429"))
    #expect(!Link.isTailscale("ws://192.168.1.5:7429"))
    #expect(Link.isTailscaleIPv4("100.64.0.1") && Link.isTailscaleIPv4("100.127.255.255") && !Link.isTailscaleIPv4("100.63.0.1"))
    #expect(Link.protocolMismatch(mac: nil, phone: 1) == nil)
    #expect(Link.protocolMismatch(mac: 1, phone: 1) == nil)
    #expect(Link.protocolMismatch(mac: 1, phone: 2) == .macOutdated)
    #expect(Link.protocolMismatch(mac: 3, phone: 2) == .phoneOutdated)
  }
}

