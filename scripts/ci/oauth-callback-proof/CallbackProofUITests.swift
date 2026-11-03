import XCTest

/// The runner drives only the real system/browser UI. Its single URLSession
/// request is the fixture provider's /begin control, NEVER the production
/// listener. Driver startup precedes app launch; no in-app tap, ephemeral-session
/// override, interruption monitor or product-assertion retry can hide a failure.
final class CallbackProofUITests: XCTestCase {
  // The hosted SDK isolates application proxies to MainActor. Isolate UI work,
  // not the nonisolated XCTestCase superclass or URLSession completion queue.
  @MainActor private lazy var app = XCUIApplication(bundleIdentifier: "dev.localoperator.oauthproof")
  @MainActor private lazy var safari = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
  @MainActor private lazy var springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  private enum ProofFailure: Error { case failed }

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor func testLegacy() throws { try run(mode: "legacy") }
  @MainActor func testPositive() throws { try run(mode: "positive") }
  @MainActor func testCancel() throws { try run(mode: "cancel") }
  @MainActor func testTimeout() throws { try run(mode: "timeout") }

  @MainActor private func run(mode: String) throws {
    // This marker is also a fail-closed retry guard if a partial xcresult cannot
    // report a started test. A running case is never eligible for another attempt.
    print("PROOF_TEST_STARTED \(mode)")
    let environment = ProcessInfo.processInfo.environment
    let runId = try XCTUnwrap(environment["PROOF_RUN_ID"] ?? environment["TEST_RUNNER_PROOF_RUN_ID"])
    app.launchEnvironment = ["PROOF_MODE": mode, "PROOF_RUN_ID": runId]
    app.launch()
    let ready = app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label == %@", "proof.status", "Ready \(mode)")).firstMatch
    try require(ready.waitForExistence(timeout: 60), "Fresh fixture Ready label did not appear")
    let value = try XCTUnwrap(ready.value as? String)
    let port = try XCTUnwrap(UInt16(value))
    try beginFromRunner(port: port)
    let title = mode == "cancel" || mode == "timeout" ? "Synthetic callback waiting" : "Complete test sign-in"
    try acceptConsentIfPresented(pageTitle: title)
    let link = try waitForElement(timeout: 60, description: "Browser page \(title)") {
      self.firstBrowserElement { $0.links[title].firstMatch }
    }
    attach(name: "\(mode)-browser-ready")

    if mode == "positive" || mode == "legacy" {
      link.tap()
    }
    if mode == "legacy" {
      let refused = NSPredicate(format: "label MATCHES %@", "(?i).*(connect|cannot open|can.t open).*")
      _ = try waitForElement(timeout: 10, description: "Actual Safari connection-refused page") {
        self.firstBrowserElement { $0.staticTexts.matching(refused).firstMatch }
      }
      attach(name: "legacy-browser")
    }
    if mode == "cancel" { try tapSheetCancel() }
    // The native deadline is still its production five minutes; this is only
    // the observer's bound, not a timeout override in the transport under test.
    let limit: TimeInterval = mode == "timeout" ? 360 : 90
    let terminal = app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND (label BEGINSWITH %@ OR label BEGINSWITH %@)", "proof.status", "PASS \(mode)", "FAIL \(mode)")).firstMatch
    try require(terminal.waitForExistence(timeout: limit), "No native terminal result for \(mode)")
    try require(terminal.label == "PASS \(mode)", "Native case failed: \(terminal.label)")
    // Legacy intentionally receives no session callback: its sheet can still
    // cover the app. Native result identity/label is authoritative, not a tap
    // activation point. Browser controls above still require genuine hittability.
    attach(name: "\(mode)-returned")
  }

  @MainActor private func beginFromRunner(port: UInt16) throws {
    let url = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/begin"))
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    request.httpMethod = "GET"
    let received = expectation(description: "Fixture begin response")
    URLSession.shared.dataTask(with: request) { data, response, _ in
      // Only the exact acknowledgement fulfils the wait: no shared mutable flag
      // crosses from the URLSession queue into the UI actor.
      if (response as? HTTPURLResponse)?.statusCode == 200 && data.flatMap({ String(data: $0, encoding: .utf8) }) == "begin" {
        received.fulfill()
      }
    }.resume()
    try require(XCTWaiter.wait(for: [received], timeout: 15) == .completed, "Fixture /begin did not acknowledge begin")
  }

  @MainActor private func acceptConsentIfPresented(pageTitle: String) throws {
    let consent = springboard.buttons["Continue"].firstMatch
    let appears = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      consent.exists || self.firstBrowserElement { $0.links[pageTitle].firstMatch } != nil
    }, object: nil)
    try require(XCTWaiter.wait(for: [appears], timeout: 60) == .completed, "Neither system consent nor browser page appeared")
    if consent.waitForExistence(timeout: 1) { consent.tap() }
  }

  @MainActor private func tapSheetCancel() throws {
    // Explicit lookup order is part of the architecture decision; hierarchy
    // attachments settle OS-specific ownership without retrying a failed tap.
    let cancel = try waitForElement(timeout: 15, description: "System sheet Cancel") {
      self.firstBrowserElement { $0.buttons["Cancel"].firstMatch }
    }
    cancel.tap()
  }

  @MainActor private func firstBrowserElement(_ query: @MainActor (XCUIApplication) -> XCUIElement) -> XCUIElement? {
    for application in [app, safari, springboard] {
      let element = query(application)
      if element.exists && element.isHittable { return element }
    }
    return nil
  }

  @MainActor private func waitForElement(timeout: TimeInterval, description: String, query: @escaping @MainActor () -> XCUIElement?) throws -> XCUIElement {
    var found: XCUIElement?
    let appears = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      found = query()
      return found != nil
    }, object: nil)
    try require(XCTWaiter.wait(for: [appears], timeout: timeout) == .completed, description)
    return try XCTUnwrap(found)
  }

  @MainActor private func require(_ condition: Bool, _ message: String, file: StaticString = #filePath, line: UInt = #line) throws {
    if !condition {
      attachHierarchies()
      XCTFail(message, file: file, line: line)
      throw ProofFailure.failed
    }
  }

  @MainActor private func attach(name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  @MainActor private func attachHierarchies() {
    for (name, application) in [("app", app), ("SafariViewService", safari), ("springboard", springboard)] {
      let attachment = XCTAttachment(string: application.debugDescription)
      attachment.name = "\(name)-hierarchy"
      attachment.lifetime = .keepAlways
      add(attachment)
    }
  }
}
