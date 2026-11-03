import XCTest

// This file is COMPILED ONLY by the setup workflow. There is deliberately no
// setup path that runs this test, opens a URL, launches the proof or taps UI.
final class RetainedReplayTests: XCTestCase {
  func testExplicitlyAuthorizedSystemOpenAlert() throws {
    continueAfterFailure = false
    let env = ProcessInfo.processInfo.environment
    guard env["LO_REPLAY_MODE"] == "explicit-system-alert-replay",
          let json = env["LO_REPLAY_AUTHORITY_JSON"], let data = json.data(using: .utf8),
          let udid = env["SIMULATOR_UDID"] else { throw ReplayGuardFailure.refused }
    let authority = try JSONDecoder().decode(ReplayAuthority.self, from: data)
    try ReplayGuards.identity(authority, udid: udid, now: Date().timeIntervalSince1970)
    // Public explicit SYSTEM scope, never an interruption monitor or coordinate.
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let alerts = springboard.alerts
    let count = alerts.count
    let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    before.name = "owned-system-alert-before-authorization"
    before.lifetime = .keepAlways
    add(before)
    guard count == 1 else { throw ReplayGuardFailure.refused }
    let alert = alerts.element(boundBy: 0)
    let labels = alert.buttons.allElementsBoundByIndex.map { $0.label }
    // Match visible title exactly; identifiers alone cannot authorize a tap.
    let titles = alert.staticTexts.allElementsBoundByIndex.map { $0.label }
    guard titles == [authority.expectedTitle] else { throw ReplayGuardFailure.refused }
    try ReplayGuards.alert(title: titles[0], buttons: labels, count: count)
    try ReplayGuards.identity(authority, udid: udid, now: Date().timeIntervalSince1970)
    guard alerts.count == 1, alert.buttons.count == 2,
          alert.buttons["Open"].exists, alert.buttons["Cancel"].exists,
          alert.staticTexts.allElementsBoundByIndex.map({ $0.label }) == titles else {
      throw ReplayGuardFailure.refused
    }
    // Exactly one user-equivalent action, available only to a separately granted
    // future replay. Setup build-for-testing never executes this branch.
    alert.buttons["Open"].tap()
  }
}
