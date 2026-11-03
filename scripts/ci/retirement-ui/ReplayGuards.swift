import Foundation

// Public XCTest may inspect SpringBoard only after the HOST has validated the
// retained artifact and freshly sampled the owned process/lease. This is not
// authorization for a personal simulator, account, or arbitrary system alert.
struct ReplayAuthority: Decodable {
  let scope: String
  let deviceUDID: String
  let leaseUDID: String
  let proofPID: Int
  let observedPID: Int
  let sourceSHA: String
  let bundleSHA256: String
  let tarSHA256: String
  let flavor: String
  let bundleID: String
  let artifactID: Int
  let artifactPresent: Bool
  let artifactExpired: Bool
  let expiresAt: Double
  let checkedAt: Double
  let openURLAt: Double
  let expectedTitle: String
  let titleAttested: Bool
}

enum ReplayGuardFailure: Error { case refused }
enum ReplayGuards {
  // Typography must be attested against the retained frame before a replay.
  // Never normalize quotes, guess a title, or accept a localized fallback.
  static let title = "Open in “Local Operator”?"
  static func identity(_ a: ReplayAuthority, udid: String, now: Double) throws {
    guard a.scope == "owned-retirement-proof-system-open-alert-v1",
          a.deviceUDID == udid, a.leaseUDID == udid, !udid.isEmpty,
          a.proofPID > 0, a.observedPID == a.proofPID,
          a.sourceSHA == "78ff786a7ef173560b7fb67e29a9e20eb9ca6f8b",
          a.bundleSHA256 == "9c667250a1e0a8d5dc129495a8f1bd734e201ec5bfbae8bd7b863e4f951574e7",
          a.tarSHA256 == "2e6ce4369dea84a514ba31d8802e9ec36f25dd4f0ace9c36353cba6edc9d1d92",
          a.flavor == "auth-retirement-proof", a.bundleID == "com.localoperator.mobile.retirementproof",
          a.artifactID == 13225164386, a.artifactPresent, !a.artifactExpired,
          a.expiresAt > now, a.checkedAt <= now, now - a.checkedAt <= 60,
          a.openURLAt <= now, now - a.openURLAt <= 60,
          a.titleAttested, a.expectedTitle == title else { throw ReplayGuardFailure.refused }
  }
  static func alert(title: String, buttons: [String], count: Int) throws {
    guard count == 1, title == self.title, buttons.sorted() == ["Cancel", "Open"] else {
      throw ReplayGuardFailure.refused
    }
  }
}
