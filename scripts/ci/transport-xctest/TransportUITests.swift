import XCTest
import UIKit

// The carrier is only a UI-test host. Every transport observation is made by
// operating the UNCHANGED installed Release app; URLSession below is CONTROL
// traffic to a separate supervisor listener and never supplies native proof.
final class TransportUITests: XCTestCase {
  @MainActor private lazy var app = XCUIApplication(bundleIdentifier: ProcessInfo.processInfo.environment["REAL_APP_ID"]!)

  @MainActor func testPairedTransport() throws {
    continueAfterFailure = false
    executionTimeAllowance = 700
    emit(["event": "method-entered", "runnerPID": ProcessInfo.processInfo.processIdentifier])
    app.launch()
    try visible("welcome-screen")
    attach("welcome-ready")
    emit(["event": "welcome-ready"])
    _ = try control("/begin")
    app.buttons["welcome-custom-url"].tap()
    try visible("own-tunnel-screen")
    let authorities = ["loopback-ipv4", "published-local"]
    let urls = [ProcessInfo.processInfo.environment["IP_URL"]!, ProcessInfo.processInfo.environment["LOCAL_URL"]!]
    var successful: Int?
    for index in 0..<2 {
      if index != 0 { try freshForm() }
      let before = try control("/counts?authority=\(authorities[index])")["completed401"] ?? 0
      let verdict = try attempt(urls[index], label: authorities[index], scrollUp: false)
      let after = try control("/counts?authority=\(authorities[index])")["completed401"] ?? 0
      let matching = verdict == "password-refused" && after > before
      emit(["event": "authority", "authority": authorities[index], "verdict": verdict, "matching401": matching])
      if matching && successful == nil { successful = index }
    }
    guard let index = successful else { XCTFail("Neither authority proved native GET401; stop without a fake negative control"); return }
    let beforeClose = try control("/counts?authority=\(authorities[index])")["completed401"] ?? 0
    XCTAssertEqual(try control("/close")["closed"], 1)
    emit(["event": "listener-closed"])
    // Re-enter the real form so a previous authority's unreachable text cannot
    // satisfy this negative. No extra request is made until its Test tap.
    try freshForm()
    let negative = try attempt(urls[index], label: "negative-" + authorities[index], scrollUp: false)
    let afterClose = try control("/counts?authority=\(authorities[index])")["completed401"] ?? 0
    emit(["event": "negative", "authority": authorities[index], "verdict": negative, "matching401": afterClose > beforeClose])
    XCTAssertEqual(negative, "unreachable", "Closed SAME listener must produce actual unreachable UI, not stale password refusal")
    XCTAssertEqual(afterClose, beforeClose, "Closed-listener control must not gain a new401")
  }

  @MainActor private func freshForm() throws {
    let back = app.buttons["own-tunnel-back"].firstMatch
    XCTAssertTrue(back.waitForExistence(timeout: 5)); back.tap()
    try visible("welcome-screen")
    app.buttons["welcome-custom-url"].tap()
    try visible("own-tunnel-screen")
    XCTAssertFalse(app.staticTexts["Not yet"].exists, "Fresh form must not retain a stale verdict")
  }

  @MainActor private func attempt(_ url: String, label: String, scrollUp: Bool) throws -> String {
    let field = try scrollTo("custom-url-field", up: scrollUp)
    field.tap()
    let previous = field.value as? String ?? ""
    if previous.hasPrefix("http") { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count)) }
    field.typeText(url)
    let key = app.keyboards.buttons["Return"].firstMatch
    let lowerKey = app.keyboards.buttons["return"].firstMatch
    if key.exists { key.tap() } else if lowerKey.exists { lowerKey.tap() }
    XCTAssertEqual(field.value as? String, url, "Exact authority must reach the real app field")
    let toggle = try scrollTo("custom-insecure-opt-in", up: false)
    if toggle.label == "Allow a plain http:// address" { toggle.tap() }
    XCTAssertEqual(toggle.label, "Plain http:// is allowed")
    let test = try scrollTo("own-tunnel-test", up: false)
    let started = Date()
    test.tap()
    let ready = NSPredicate(format: "enabled == true AND label == %@", "Test the connection")
    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: test)], timeout: 15), .completed)
    let text = try terminalVerdict()
    let verdict = classify(text)
    attach(label)
    emit(["event": "ui-verdict", "authority": label.hasPrefix("negative-") ? String(label.dropFirst(9)) : label, "verdict": verdict, "elapsedMs": Int(Date().timeIntervalSince(started) * 1000)])
    return verdict
  }

  @MainActor private func terminalVerdict() throws -> String {
    let predicate = NSPredicate(format: "label BEGINSWITH %@ OR label BEGINSWITH %@ OR label BEGINSWITH %@ OR label BEGINSWITH %@ OR label BEGINSWITH %@ OR label BEGINSWITH %@", "That password was not accepted", "That address did not answer", "That host name", "The address could not be reached", "Nothing answered", "That tunnel's certificate")
    for _ in 0..<8 {
      let element = app.staticTexts.matching(predicate).firstMatch
      if element.exists && element.isHittable { return element.label }
      app.swipeUp()
    }
    XCTFail("No actual terminal Own Tunnel verdict"); throw NSError(domain: "TransportProof", code: 1)
  }
  private func classify(_ text: String) -> String {
    if text.hasPrefix("That password was not accepted") { return "password-refused" }
    if text.hasPrefix("That address did not answer") { return "timeout" }
    if text.hasPrefix("That host name") { return "host" }
    if text.hasPrefix("That tunnel's certificate") { return "tls" }
    if text.hasPrefix("The address could not be reached") || text.hasPrefix("Nothing answered") { return "unreachable" }
    return "other"
  }
  @MainActor private func visible(_ id: String) throws {
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: id).firstMatch.waitForExistence(timeout: 30), "Missing actual app marker")
  }
  @MainActor private func scrollTo(_ id: String, up: Bool) throws -> XCUIElement {
    for _ in 0..<12 {
      let e = app.descendants(matching: .any).matching(identifier: id).firstMatch
      if e.exists && e.isHittable { return e }
      if up { app.swipeDown() } else { app.swipeUp() }
    }
    XCTFail("Missing actual app control"); throw NSError(domain: "TransportProof", code: 2)
  }
  @MainActor private func attach(_ name: String) {
    let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
  }
  private func emit(_ row: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
    print("XCT_TRANSPORT " + String(data: data, encoding: .utf8)!)
  }
  // This URLSession is TEST-SUPERVISOR control only. It never targets /api,
  // performs a relay login, or stands in for the installed app's transport.
  private func control(_ path: String) throws -> [String: Int] {
    let expected = expectation(description: "supervisor control")
    let box = ControlBox()
    var req = URLRequest(url: URL(string: ProcessInfo.processInfo.environment["CONTROL_URL"]! + path)!)
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.timeoutInterval = 8
    URLSession.shared.dataTask(with: req) { data, response, _ in
      box.store(data, (response as? HTTPURLResponse)?.statusCode); expected.fulfill()
    }.resume()
    guard XCTWaiter.wait(for: [expected], timeout: 12) == .completed else { throw NSError(domain: "SupervisorControlTimeout", code: 1) }
    let (data, status) = box.read(); XCTAssertEqual(status, 200)
    return (try JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Int]) ?? [:]
  }
}
private final class ControlBox: @unchecked Sendable {
  private let lock = NSLock(); private var data: Data?; private var status: Int?
  func store(_ d: Data?, _ s: Int?) { lock.lock(); defer { lock.unlock() }; data = d; status = s }
  func read() -> (Data?, Int?) { lock.lock(); defer { lock.unlock() }; return (data, status) }
}
