import XCTest

// Drives the installed REAL Expo app. The runner controls only the synthetic
// provider's response timing/status; it NEVER sends a native callback itself.
final class SignInAppUITests: XCTestCase {
  @MainActor private lazy var app = XCUIApplication(bundleIdentifier: ProcessInfo.processInfo.environment["APP_ID"]!)
  @MainActor private lazy var springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

  @MainActor func testAlreadySignedInFastPathAndServerError() throws {
    continueAfterFailure = false
    executionTimeAllowance = 900
    _ = try control("/control?mode=failure&hold=true&reset=true")
    app.launch()
    try visible("welcome-screen")
    attach("welcome-brand-initial")
    attach("welcome-brand-settled")
    if ProcessInfo.processInfo.environment["PROOF_THEME"] == "light" {
      // Decline the REAL system authentication prompt, never synthesize a JS
      // cancellation. No provider request is expected before this permission.
      app.buttons["welcome-connect"].tap()
      let cancel = springboard.buttons["Cancel"].firstMatch
      try require(cancel.waitForExistence(timeout: 60), "Missing system consent Cancel")
      cancel.tap()
      try visible("sign-in-try-again")
      attach("cancelled-and-retry")
      XCTAssertEqual(try control("/receipt")["authorize"], 0)
      app.buttons["sign-in-try-again"].tap()
    } else {
      app.buttons["welcome-connect"].tap()
    }
    try consent()
    try text("Signing in…")
    attach("negative-exchanging")
    _ = try control("/release-token")
    try visible("sign-in-try-again")
    attach("token-500-error-and-retry-collapsed")
    XCTAssertEqual(app.buttons["sign-in-diagnostics-toggle"].label, "Show sign-in details")
    app.buttons["sign-in-diagnostics-toggle"].tap()
    XCTAssertEqual(app.buttons["sign-in-diagnostics-toggle"].label, "Hide sign-in details")
    try visible("sign-in-diagnostics")
    let diagnostic = app.descendants(matching: .any).matching(identifier: "sign-in-diagnostics").firstMatch.label
    XCTAssertTrue(diagnostic.contains("RadientAuthError"))
    XCTAssertFalse(diagnostic.contains("127.0.0.1"))
    XCTAssertFalse(diagnostic.contains("proof-code"))
    attach("token-500-error-and-retry")
    let negative = try control("/receipt")
    XCTAssertEqual(negative["authorize"], 1)
    XCTAssertEqual(negative["token"], 1)
    XCTAssertEqual(negative["pkce_verified"], 1)
    XCTAssertEqual(negative["discovery"], 0)

    _ = try control("/control?mode=success&hold=true")
    app.buttons["sign-in-try-again"].tap()
    try consent()
    try text("Signing in…")
    attach("positive-exchanging")
    try releaseAndCaptureTransition()
    try visible("computers-screen")
    try pickerRow()
    attach("positive-tunnel-picker")
    let positive = try control("/receipt")
    XCTAssertEqual(positive["authorize"], 2)
    XCTAssertEqual(positive["pkce_verified"], 2)
    XCTAssertGreaterThanOrEqual(positive["discovery"] ?? 0, 1)
    // A fresh JS process must restore the Keychain grant without opening OAuth.
    // Merely inspecting a mocked write would not prove native persistence.
    app.terminate()
    app.launch()
    try visible("computers-screen")
    try pickerRow()
    let restored = try control("/receipt")
    XCTAssertEqual(restored["authorize"], 2)
    XCTAssertGreaterThan(restored["discovery"] ?? 0, positive["discovery"] ?? 0)
    attach("persisted-grant-restored-picker")
    // Persisted OAuth is not a connected relay. Drive the owner's actual pick,
    // a bad server contract, in-app Retry, then a grant-authenticated list.
    let computer = app.buttons["computer-row-" + String(repeating: "0", count: 32) + "-lop.radienthq.com"]
    XCTAssertTrue(computer.label.contains("Sign-in protected"))
    // A real 403 is disabled OR not-yet-active, never proof of an off toggle.
    _ = try control("/control?session=inactive")
    computer.tap()
    try visible("connection-error-console-link")
    try text("Radient says this tunnel isn't active right now. Check its status in the Radient console.")
    attach("tunnel-inactive-status-guidance")
    _ = try control("/control?session=malformed")
    computer.tap()
    try visible("connection-details-toggle")
    XCTAssertFalse(app.buttons["connection-error-console-link"].exists)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "connection-error-machine-remedy").firstMatch.exists)
    attach("tunnel-contract-error-and-retry")
    app.buttons["connection-details-toggle"].tap()
    try visible("connection-details")
    let details = app.descendants(matching: .any).matching(identifier: "connection-details").firstMatch.label
    XCTAssertTrue(details.contains("TunnelSessionError"))
    XCTAssertFalse(details.contains("fixture-session-code"))
    attach("tunnel-contract-details")
    _ = try control("/control?session=success")
    app.buttons["refusal-sign-in"].tap()
    try visible("home-screen")
    app.buttons["home-sidebar"].tap()
    try visible("conversations-list")
    try visible("session-row-b3535011f562")
    attach("connected-session-list")
    let connected = try control("/receipt")
    XCTAssertEqual(connected["session_code"], 3)
    XCTAssertEqual(connected["session_token"], 1)
    XCTAssertEqual(connected["session_pkce_verified"], 1)
    XCTAssertGreaterThan(connected["relay_requests"] ?? 0, 0)

  }

  @MainActor func testDarkLargestWelcome() throws {
    continueAfterFailure = false
    app.launch()
    try visible("welcome-screen")
    attach("dark-largest-welcome-initial")
    attach("dark-largest-welcome-settled")
    app.terminate()
  }

  @MainActor private func pickerRow() throws {
    // The native row intentionally groups name/status into ONE accessible
    // button. Looking for a standalone StaticText is not a product assertion.
    let id = "computer-row-" + String(repeating: "0", count: 32) + "-lop.radienthq.com"
    try visible(id)
    XCTAssertTrue(app.buttons[id].label.contains("OAuth proof computer"))
  }

  @MainActor private func releaseAndCaptureTransition() throws {
    var times: [Double] = []
    times.append(ProcessInfo.processInfo.systemUptime)
    attach("transition-0-exchanging")
    _ = try control("/release-token")
    for index in 1...3 {
      // Request ~75ms cadence, but publish actual timestamps: screenshot RPC
      // latency is not controllable and must not be described as a faster rate.
      let requested = ProcessInfo.processInfo.systemUptime
      times.append(requested)
      attach("transition-\(index)")
      let remaining = 0.075 - (ProcessInfo.processInfo.systemUptime - requested)
      if remaining > 0 { Thread.sleep(forTimeInterval: remaining) }
    }
    let data = try JSONSerialization.data(withJSONObject: ["requested_interval_seconds": 0.075, "actual_monotonic_starts": times])
    let trace = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
    trace.name = "transition-frame-timing"; trace.lifetime = .keepAlways; add(trace)
  }

  @MainActor private func consent() throws {
    // Same required Springboard handshake as the proven native callback lane.
    // Slow first-launch retirement can present this after five seconds; absence
    // must fail HERE, never silently continue into the exchange assertion.
    let button = springboard.buttons["Continue"].firstMatch
    try require(button.waitForExistence(timeout: 60), "Missing system sign-in consent Continue")
    button.tap()
    // Both callers then require the held exchange stage before releasing tokens.
  }
  @MainActor private func visible(_ id: String) throws {
    let element = app.descendants(matching: .any).matching(identifier: id).firstMatch
    try require(element.waitForExistence(timeout: 90), "Missing app surface: \(id)")
  }
  @MainActor private func text(_ label: String) throws {
    try require(app.staticTexts[label].firstMatch.waitForExistence(timeout: 90), "Missing sign-in stage/picker text")
  }
  @MainActor private func require(_ condition: Bool, _ message: String) throws {
    if !condition {
      attach("failed-app-frame")
      for (name, application) in [("app", app), ("springboard", springboard), ("SafariViewService", XCUIApplication(bundleIdentifier: "com.apple.SafariViewService"))] {
        let value = XCTAttachment(string: application.debugDescription); value.name = name; value.lifetime = .keepAlways; add(value)
      }
      XCTFail(message)
      throw NSError(domain: "SignInProof", code: 1)
    }
  }
  @MainActor private func attach(_ name: String) {
    let value = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); value.name = name; value.lifetime = .keepAlways; add(value)
  }
  private func control(_ path: String) throws -> [String: Int] {
    let expected = expectation(description: "Synthetic provider control")
    let box = ResponseBox()
    var request = URLRequest(url: URL(string: "http://127.0.0.1:54831\(path)")!)
    request.timeoutInterval = 10
    URLSession.shared.dataTask(with: request) { data, response, _ in
      box.store(data, (response as? HTTPURLResponse)?.statusCode)
      expected.fulfill()
    }.resume()
    guard XCTWaiter.wait(for: [expected], timeout: 15) == .completed else { throw NSError(domain: "ProofControlTimeout", code: 1) }
    let (data, status) = box.read()
    XCTAssertEqual(status, 200)
    return (try JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Int]) ?? [:]
  }
}

private final class ResponseBox: @unchecked Sendable {
  private let lock = NSLock()
  private var data: Data?
  private var status: Int?
  func store(_ data: Data?, _ status: Int?) { lock.lock(); defer { lock.unlock() }; self.data = data; self.status = status }
  func read() -> (Data?, Int?) { lock.lock(); defer { lock.unlock() }; return (data, status) }
}
