// Any JSON value: what the protocol leaves open (a tool's input, a request's `data`). Adapted from the author's
// marvis-coding-agent (packages/ios/Marvis/Net/JSONValue.swift, MIT).
import Foundation

enum JSONValue: Codable, Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
    else { self = .object(try c.decode([String: JSONValue].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n): try c.encode(n)
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }

  subscript(key: String) -> JSONValue? {
    if case .object(let o) = self { return o[key] }
    return nil
  }

  var string: String? {
    if case .string(let s) = self { return s }
    return nil
  }

  /// The value as a typed message (a request's `data`, an event's payload); nil when it is not one.
  func decode<T: Decodable>(_ type: T.Type) -> T? {
    guard let data = try? JSONEncoder().encode(self) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  /// An encodable message as a JSON value.
  static func from<T: Encodable>(_ value: T) -> JSONValue {
    guard let data = try? JSONEncoder().encode(value), let json = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
    return json
  }

  var bytes: Data { (try? JSONEncoder().encode(self)) ?? Data("null".utf8) }
}
