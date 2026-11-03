import Foundation
import CryptoKit

enum ReplayGuardFailure: Error { case refused }
struct PromptObservation {
  let count: Int
  let titles: [[UInt32]]
  let buttons: [[UInt32]]
  var object: [String: Any] { ["scope": "system-open-alert-v1", "count": count, "titles": titles, "buttons": buttons] }
  var fingerprint: String {
    let rows: ([[UInt32]]) -> String = { $0.map { $0.map(String.init).joined(separator: ",") }.joined(separator: ";") }
    let encoded = "system-open-alert-v1|\(count)|\(titles.count)|\(rows(titles))|\(buttons.count)|\(rows(buttons))"
    return SHA256.hash(data: Data(encoded.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}
/// Scalar arrays deliberately avoid Swift's canonical-equivalent String ==.
/// Observation is permitted by a live QUERY grant BEFORE title attestation.
/// Only an exact observation plus a new fresh host TAP permit can authorize action.
enum ReplayGuards {
  static let source = "78ff786a7ef173560b7fb67e29a9e20eb9ca6f8b"
  static let bundle = "9c667250a1e0a8d5dc129495a8f1bd734e201ec5bfbae8bd7b863e4f951574e7"
  static let tar = "2e6ce4369dea84a514ba31d8802e9ec36f25dd4f0ace9c36353cba6edc9d1d92"
  static let title = "Open in “Local Operator”?"
  static func scalars(_ value: String) -> [UInt32] { value.unicodeScalars.map { $0.value } }
  static func exact(_ value: PromptObservation) -> Bool {
    value.count == 1 && value.titles == [scalars(title)] && value.buttons.count == 2 &&
      value.buttons.map { $0.map(String.init).joined(separator: ",") }.sorted() ==
      [scalars("Cancel"), scalars("Open")].map { $0.map(String.init).joined(separator: ",") }.sorted()
  }
  /// The SAME pure predicate is exercised by XCTest fixtures and both actual
  /// use sites. A response accepted earlier is not authority after expiry.
  static func permit(_ grant: HostGrant, session: String, kind: String,
                     identity: HostIdentity?, received: TimeInterval,
                     now: Double = Date().timeIntervalSince1970 * 1000,
                     uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) throws {
    guard grant.version == 1, grant.phase == "seed", grant.session == session,
          grant.kind == kind, grant.identity != nil, grant.identity == identity,
          grant.issuedAt.isFinite, grant.expiresAt.isFinite, now.isFinite,
          uptime.isFinite, received.isFinite, uptime >= received, uptime - received <= 2,
          now >= grant.issuedAt, now < grant.expiresAt, now - grant.issuedAt <= 2000 else {
      throw ReplayGuardFailure.refused
    }
  }
}
