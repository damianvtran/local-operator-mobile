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
    try heldExchange("negative-exchanging", pkceVerified: 1)
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
    try heldExchange("positive-exchanging", pkceVerified: 2)
    try releaseAndCaptureTransition()
    // 2026-11-19: baseline 84621b99e auto-opens the sole usable computer.
    // Run 44537393006 reached Home, not the obsolete pre-Nov-12 picker.
    try visible("home-screen")
    try visible("notification-primer-not-now")
    app.buttons["notification-primer-not-now"].tap()
    try connectedHome()
    attach("positive-auto-open-home")
    let positive = try control("/receipt")
    XCTAssertEqual(positive["authorize"], 2)
    XCTAssertEqual(positive["pkce_verified"], 2)
    XCTAssertGreaterThanOrEqual(positive["discovery"] ?? 0, 1)
    // Replaces the obsolete picker's "Sign-in protected" badge assertion with
    // proof of that property: authenticated code mint, verified tunnel PKCE,
    // and grant-cookie-only relay traffic, not just a transport label.
    XCTAssertEqual(positive["session_code"], 1)
    XCTAssertEqual(positive["session_token"], 1)
    XCTAssertEqual(positive["session_pkce_verified"], 1)
    XCTAssertGreaterThan(positive["relay_requests"] ?? 0, 0)
    // A fresh JS process must restore the Keychain grant without opening OAuth.
    // Merely inspecting a mocked write would not prove native persistence.
    app.terminate()
    app.launch()
    try connectedHome()
    let restored = try control("/receipt")
    XCTAssertEqual(restored["authorize"], 2)
    XCTAssertGreaterThan(restored["discovery"] ?? 0, positive["discovery"] ?? 0)
    // A named Home alone could be cached: require a NEW authenticated tunnel
    // exchange and relay traffic after restart, without another OAuth grant.
    XCTAssertEqual(restored["session_code"], 2)
    XCTAssertEqual(restored["session_token"], 2)
    XCTAssertEqual(restored["session_pkce_verified"], 2)
    XCTAssertGreaterThan(restored["relay_requests"] ?? 0, positive["relay_requests"] ?? 0)
    attach("persisted-grant-reconnected-home")
    // The old picker tap initiated a fresh route. With auto-open, a second cold
    // start does that honestly; changing the fixture cannot break an ALREADY
    // authenticated relay. Keep the 403 -> malformed -> successful Retry rows.
    app.terminate()
    _ = try control("/control?session=inactive")
    app.launch()
    try visible("home-screen")
    try visible("connection-error-console-link")
    // The mock lists this computer with no billing and status active, so the
    // 403 cannot be split by cause: the neutral copy, still no command.
    try text("Radient didn't allow phone access to OAuth proof computer right now.")
    attach("tunnel-inactive-status-guidance")
    let inactive = try control("/receipt")
    XCTAssertEqual(inactive["authorize"], 2)
    XCTAssertEqual(inactive["session_code"], 3)
    XCTAssertEqual(inactive["session_token"], 2)
    // A 403 console remedy deliberately has no Retry button. The old picker
    // row was a NEW admission attempt; restart likewise reopens the saved
    // computer without pretending that the console remedy is a retry action.
    app.terminate()
    _ = try control("/control?session=malformed")
    app.launch()
    try visible("home-screen")
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
    let malformed = try control("/receipt")
    XCTAssertEqual(malformed["session_code"], 4)
    XCTAssertEqual(malformed["session_token"], 2)
    _ = try control("/control?session=success")
    app.buttons["refusal-sign-in"].tap()
    try visible("home-screen")
    app.buttons["home-sidebar"].tap()
    try visible("conversations-list")
    try visible("session-row-b3535011f562")
    attach("connected-session-list")
    let connected = try control("/receipt")
    XCTAssertEqual(connected["authorize"], 2)
    XCTAssertEqual(connected["session_code"], 5)
    XCTAssertEqual(connected["session_token"], 3)
    XCTAssertEqual(connected["session_pkce_verified"], 3)
    XCTAssertGreaterThan(connected["relay_requests"] ?? 0, restored["relay_requests"] ?? 0)

  }

  @MainActor func testDarkLargestWelcome() throws {
    continueAfterFailure = false
    app.launch()
    try visible("welcome-screen")
    attach("dark-largest-welcome-initial")
    attach("dark-largest-welcome-settled")
    app.terminate()
  }

  @MainActor private func connectedHome() throws {
    try visible("home-screen")
    // The chip carries computer identity on Home; the actual populated list and
    // provider receipts distinguish a live route from a merely mounted screen.
    try visible("computers-button")
    XCTAssertTrue(app.buttons["computers-button"].label.contains("OAuth proof computer"))
    app.buttons["home-sidebar"].tap()
    try visible("conversations-list")
    try visible("session-row-b3535011f562")
    app.buttons["sidebar-close"].tap()
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
    // Both callers then wait for the held exchange (`heldExchange`) before releasing tokens.
  }
  @MainActor private func visible(_ id: String) throws {
    let element = app.descendants(matching: .any).matching(identifier: id).firstMatch
    try require(element.waitForExistence(timeout: 90), "Missing app surface: \(id)")
  }
  /// Waits until the app's REAL token request is parked at the provider, then
  /// captures the exchanging frame. The provider counts `pkce_verified` and saves
  /// the receipt BEFORE it holds the response, so the count reaching `pkceVerified`
  /// means the app sent its verified exchange and is now in the exchanging stage
  /// (`onCallbackReceived` reports it before the request starts).
  ///
  /// WHY NOT `text("Signing in…")` (PR #341 diagnosis). The release must happen
  /// inside the app's 20 s exchange deadline (`RADIENT_OAUTH.requestTimeoutMs`,
  /// 6610ef81), but the accessibility snapshot taken right after the system
  /// browser dismisses stalls on SafariViewService's invalid remote element
  /// (`kAXErrorInvalidUIElement`): one existence check measured 8.3 s and 31.5 s
  /// on the last green proof (41868425996, Nov 4, before that deadline existed),
  /// 31.2 s on 44524064527 (macos-26) and 70.4 s on 44505768707 (xcode-27). Past
  /// 20 s the app correctly ends the held exchange as "We could not finish
  /// signing in." and the proof fails on its own synchronization. The receipt is
  /// read over loopback HTTP, never through accessibility, so it cannot stall.
  /// The stage copy remains visible in the attached frame.
  @MainActor private func heldExchange(_ name: String, pkceVerified: Int) throws {
    let deadline = Date().addingTimeInterval(60)
    var held = false
    while Date() < deadline {
      if (try control("/receipt")["pkce_verified"] ?? 0) >= pkceVerified { held = true; break }
      Thread.sleep(forTimeInterval: 0.25)
    }
    try require(held, "Token exchange never reached the provider (pkce_verified < \(pkceVerified))")
    attach(name)
  }
  @MainActor private func text(_ label: String) throws {
    try require(app.staticTexts[label].firstMatch.waitForExistence(timeout: 90), "Missing sign-in stage/picker text")
  }
  @MainActor private func require(_ condition: Bool, _ message: String) throws {
    if !condition {
      attach("failed-app-frame")
      attachSignInDiagnostics()
      for (name, application) in [("app", app), ("springboard", springboard), ("SafariViewService", XCUIApplication(bundleIdentifier: "com.apple.SafariViewService"))] {
        let value = XCTAttachment(string: application.debugDescription); value.name = name; value.lifetime = .keepAlways; add(value)
      }
      XCTFail(message)
      throw NSError(domain: "SignInProof", code: 1)
    }
  }
  /// SELF-DIAGNOSIS on failure (PR #341, run 44505768707). A failed proof used to
  /// end on "We could not finish signing in." with no cause: the panel's stage
  /// trail (`sign-in-diagnostics.ts`) already records each stage and an allowlisted
  /// error CLASS, never a message, URL or token, so it is safe to publish. Open
  /// the disclosure the reader would open and attach its text, plus the provider's
  /// count receipt, so the next failure names the stage that failed and its class.
  /// Never throws: this runs inside `require`'s failure path.
  @MainActor private func attachSignInDiagnostics() {
    let toggle = app.buttons["sign-in-diagnostics-toggle"].firstMatch
    var lines = ["toggle exists: \(toggle.exists)"]
    if toggle.exists {
      if toggle.label == "Show sign-in details" { toggle.tap() }
      let region = app.descendants(matching: .any).matching(identifier: "sign-in-diagnostics").firstMatch
      if region.waitForExistence(timeout: 10) {
        lines.append("trail:\n" + region.label)
      } else {
        lines.append("trail: disclosure did not open")
      }
      attach("failed-sign-in-details")
    }
    if let receipt = try? control("/receipt") {
      lines.append("receipt: " + receipt.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " "))
    }
    let text = lines.joined(separator: "\n")
    // Also on stdout, so the job log carries the cause without opening the xcresult.
    print("[signin-proof-diagnostics]\n" + text)
    let value = XCTAttachment(string: text); value.name = "sign-in-diagnostics"; value.lifetime = .keepAlways; add(value)
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
