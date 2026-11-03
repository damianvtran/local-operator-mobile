import XCTest

/// Compiled by setup, executed only by a separately granted seed replay. The
/// query grant precedes ANY SpringBoard query; an observe-only branch never
/// requests tap authority. Host measurements, not environment JSON, authorize.
final class RetainedReplayTests: XCTestCase {
  private func observation(_ springboard: XCUIApplication) -> PromptObservation {
    let alerts = springboard.alerts
    guard alerts.count == 1 else { return PromptObservation(count: alerts.count, titles: [], buttons: []) }
    let alert = alerts.element(boundBy: 0)
    return PromptObservation(count: 1,
      titles: alert.staticTexts.allElementsBoundByIndex.map { ReplayGuards.scalars($0.label) },
      buttons: alert.buttons.allElementsBoundByIndex.map { ReplayGuards.scalars($0.label) })
  }
  private func capture(_ name: String) {
    let frame = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    frame.name = name; frame.lifetime = .keepAlways; add(frame)
  }
  func testSingleSeedReplay() async throws {
    continueAfterFailure = false
    let environment = ProcessInfo.processInfo.environment
    guard let mode = environment["LO_REPLAY_MODE"], ["observe-only", "seed-replay"].contains(mode) else { throw ReplayGuardFailure.refused }
    let host = try ReplayHostClient(environment: environment)
    _ = try await host.request("runner-ready")
    let query = try await host.request("before-observe")
    try host.useQuery(query)
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let before = observation(springboard)
    capture("owned-system-alert-before")
    _ = try await host.request("observed", observation: before)
    // Physically separate branch: no authorize-tap request/call in observe-only.
    if mode == "observe-only" { return }
    guard ReplayGuards.exact(before) else { throw ReplayGuardFailure.refused }
    let grant = try await host.request("authorize-tap", observation: before)
    let current = observation(springboard)
    guard ReplayGuards.exact(current), current.fingerprint == before.fingerprint else { throw ReplayGuardFailure.refused }
    try host.consume(grant, observation: current)
    springboard.alerts.element(boundBy: 0).buttons["Open"].tap()
    capture("owned-system-alert-after")
    _ = try await host.request("after-tap")
  }
}
