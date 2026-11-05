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
  static let source = "2989876958f6c605f6756f59b15519456516faa7"
  static let bundle = "7808c4279c3590230b464aca1ebd3e00902f09ab3f9d2a06f2ab9b3e8429f985"
  static let tar = "0b1d9e8fec58d3d3b87aab4d96b0ea5cf8c184ac2886f51f3536f6429e239b4e"
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
