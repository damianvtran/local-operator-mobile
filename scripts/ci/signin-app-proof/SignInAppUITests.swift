import XCTest

// Drives the installed REAL Expo app. The runner controls only the synthetic
// provider's response timing/status; it NEVER sends a native callback itself.
final class SignInAppUITests: XCTestCase {
  @MainActor private lazy var app = XCUIApplication(bundleIdentifier: ProcessInfo.processInfo.environment["APP_ID"]!)
  @MainActor private lazy var springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

  @MainActor func testAlreadySignedInFastPathAndServerError() throws {
    continueAfterFailure = false
    executionTimeAllowance = 900
    _ = try control("/control?mode=failure&hold=true")
    app.launch()
    try visible("welcome-screen")
    attach("welcome-brand-initial")
    attach("welcome-brand-settled")
    app.buttons["welcome-connect"].tap()
    consent()
    try text("Signing in…")
    attach("negative-exchanging")
    _ = try control("/release-token")
    try visible("sign-in-try-again")
    app.buttons["sign-in-diagnostics-toggle"].tap()
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
    consent()
    try text("Signing in…")
    attach("positive-exchanging")
    _ = try control("/release-token")
    try visible("computers-screen")
    try text("OAuth proof computer")
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
    try text("OAuth proof computer")
    let restored = try control("/receipt")
    XCTAssertEqual(restored["authorize"], 2)
    XCTAssertGreaterThan(restored["discovery"] ?? 0, positive["discovery"] ?? 0)
    attach("persisted-grant-restored-picker")
  }

  @MainActor private func consent() {
    let button = springboard.buttons["Continue"].firstMatch
    if button.waitForExistence(timeout: 5) { button.tap() }
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
