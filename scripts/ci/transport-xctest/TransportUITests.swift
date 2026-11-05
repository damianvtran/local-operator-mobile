import XCTest
import UIKit

// The carrier is only a UI-test host. Every transport observation is made by
// operating the UNCHANGED installed Release app; URLSession below is CONTROL
// traffic to a separate supervisor listener and never supplies native proof.
final class TransportUITests: XCTestCase {
  @MainActor private lazy var app = XCUIApplication(bundleIdentifier: ProcessInfo.processInfo.environment["REAL_APP_ID"]!)

  @MainActor func testPairedTransport() throws {
    try transportProof(negativeOnly: false)
  }

  @MainActor func testNegativeControl() throws {
    try transportProof(negativeOnly: true)
  }

  @MainActor private func transportProof(negativeOnly: Bool) throws {
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
    for index in (negativeOnly ? [0] : [0, 1]) {
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
    try enterExactURL(url, field: field, label: label)
    inputCheckpoint("before-return", field: field, expected: url, label: label)
    XCTAssertEqual(field.value as? String, url, "Literal URL must be exact BEFORE Return")
    let key = app.keyboards.buttons["Return"].firstMatch
    let lowerKey = app.keyboards.buttons["return"].firstMatch
    XCTAssertTrue(key.exists || lowerKey.exists, "Missing actual Return key")
    if key.exists { key.tap() } else if lowerKey.exists { lowerKey.tap() }
    inputCheckpoint("after-return-immediate", field: field, expected: url, label: label)
    let exact = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", url), object: field)
    let settled = XCTWaiter.wait(for: [exact], timeout: 2) == .completed
    inputCheckpoint("after-return-settled", field: field, expected: url, label: label)
    XCTAssertTrue(settled, "Literal URL did not settle after Return")
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

  // Run42023917700 requested the full URL but lost `ttp://1`; QA observed
  // the field below the keyboard. This discriminates delivery from Return:
  // real visible input, one acknowledged exact prefix at a time, no rewrites,
  // retries, clipboard/state injection, or speculative product Input change.
  @MainActor private func enterExactURL(_ url: String, field: XCUIElement, label: String) throws {
    field.tap()
    let keyboard = app.keyboards.firstMatch
    XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "Keyboard must actually appear")
    let scrolls = app.scrollViews.containing(.textField, identifier: "custom-url-field")
    XCTAssertEqual(scrolls.count, 1, "Require the unique app scroll container owning the field")
    let scroll = scrolls.firstMatch
    XCTAssertTrue(scroll.exists && scroll.isHittable, "Actual owning ScrollView must be reachable")
    var visibleKeyboardTop = keyboardOcclusionTop(keyboard)
    var previousProgress: CGFloat = 0
    for adjustment in 0..<2 {
      XCTAssertTrue(keyboard.exists && scroll.exists && scroll.isHittable, "Positioning cannot refocus a dismissed keyboard or a lost app container")
      visibleKeyboardTop = keyboardOcclusionTop(keyboard)
      let remainingClearance = field.frame.maxY - (visibleKeyboardTop - 8)
      if remainingClearance < 0 && field.isHittable { break }
      if adjustment == 1 {
        XCTAssertTrue(previousProgress > 1 && remainingClearance >= 0, "Additional adjustment requires measured first progress AND remaining occlusion")
      }
      // QA42031766877 proved keyboard.minY-24 hit the system Passwords bar.
      // Run42037732071 moved the fresh negative field258pt but still needed41pt.
      // The first prose anchor has moved near the header by then: do not repeat
      // that long gesture. One short continuation may use the visible URL label
      // only after measured progress; no movement/clearance failure ends the test.
      let note = adjustment == 0
        ? scroll.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Free and needs no account")).firstMatch
        : scroll.staticTexts.matching(NSPredicate(format: "label == %@", "Public URL")).firstMatch
      XCTAssertTrue(note.exists && note.isHittable, "Require visible app-owned positioning anchor")
      let start = CGPoint(x: note.frame.midX, y: note.frame.midY)
      let end = CGPoint(x: start.x, y: max(scroll.frame.minY + 24,
        adjustment == 0 ? app.frame.minY + 200 : start.y - max(48, remainingClearance + 16)))
      XCTAssertTrue(scroll.frame.contains(start) && scroll.frame.contains(end) && start.y < visibleKeyboardTop - 16 && end.y < start.y - 44, "Gesture must stay in real app content above the visible accessory")
      let before = field.frame
      let geometry: [String: Any] = ["scrollFrame": NSCoder.string(for: scroll.frame),
        "targetFrame": NSCoder.string(for: note.frame), "scrollHittable": scroll.isHittable,
        "start": [start.x, start.y], "end": [end.x, end.y], "visibleKeyboardTop": visibleKeyboardTop,
        "adjustment": adjustment, "remainingClearanceBefore": remainingClearance,
        "offsetGap": "Public XCUI does not expose UIScrollView.contentOffset; field-frame delta is measured instead"]
      inputCheckpoint("gesture-before", field: field, expected: "", label: label, geometry: geometry)
      let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
      origin.withOffset(CGVector(dx: start.x - app.frame.minX, dy: start.y - app.frame.minY)).press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: end.x - app.frame.minX, dy: end.y - app.frame.minY)))
      var after = geometry
      previousProgress = before.minY - field.frame.minY
      after["fieldDeltaY"] = -previousProgress
      after["remainingClearanceAfter"] = field.frame.maxY - (keyboardOcclusionTop(keyboard) - 8)
      after["scrollFrameAfter"] = NSCoder.string(for: scroll.frame)
      inputCheckpoint("gesture-after", field: field, expected: "", label: label, geometry: after)
      XCTAssertLessThan(field.frame.minY, before.minY - 1, "No vertical field movement after the ONE app-content drag")
    }
    XCTAssertTrue(keyboard.exists, "Keyboard disappeared after positioning; stop without refocus/retry")
    visibleKeyboardTop = keyboardOcclusionTop(keyboard)
    inputCheckpoint("positioned-empty", field: field, expected: "", label: label, geometry: ["visibleKeyboardTop": visibleKeyboardTop])
    XCTAssertTrue(keyboard.exists && field.isHittable && field.frame.maxY < visibleKeyboardTop - 8, "Field must be visibly above the actual keyboard AND accessory")
    field.tap()
    let initial = field.value as? String ?? ""
    // Native accessibility can report its placeholder as an empty value. Never
    // infer emptiness merely from an http prefix or erase unverified content.
    XCTAssertTrue(initial.isEmpty || initial == field.placeholderValue, "Fresh URL field must be empty")
    var prefix = ""
    for character in url {
      prefix += String(character)
      field.typeText(String(character))
      let acknowledged = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", prefix), object: field)
      guard XCTWaiter.wait(for: [acknowledged], timeout: 2) == .completed else {
        inputCheckpoint("prefix-failure-\(prefix.count)", field: field, expected: prefix, label: label)
        XCTFail("Missing acknowledged exact prefix; stop before any connection Test")
        throw NSError(domain: "TransportInputPrerequisite", code: 1)
      }
      // The first acknowledged character verifies keyboard delivery/focus on
      // THIS field without private/unsupported hasKeyboardFocus KVC queries.
    }
  }

  @MainActor private func keyboardOcclusionTop(_ keyboard: XCUIElement) -> CGFloat {
    let accessory = app.buttons["Passwords"].firstMatch
    // AX Keyboard excludes the observed ~43pt accessory. If AX does not expose
    // that button, reserve a conservative96pt band; never call AX.minY the
    // complete visible occluder or proceed with the field hidden beneath it.
    return min(keyboard.frame.minY, accessory.exists ? accessory.frame.minY : keyboard.frame.minY - 96)
  }

  @MainActor private func inputCheckpoint(_ stage: String, field: XCUIElement, expected: String, label: String, geometry: [String: Any] = [:]) {
    let keyboard = app.keyboards.firstMatch
    let actual = field.value as? String ?? ""
    var record: [String: Any] = ["stage": stage, "actual": actual, "expected": expected,
      "exact": actual == expected, "fieldFrame": NSCoder.string(for: field.frame),
      "keyboardPresent": keyboard.exists, "keyboardFrame": keyboard.exists ? NSCoder.string(for: keyboard.frame) : "absent",
      "selectionGap": "Public XCTest field API does not expose UIKit selectedTextRange; not inferred"]
    record.merge(geometry) { _, measured in measured }
    // Original xcresult already explicitly retains synthetic fixture addresses;
    // keep exact values HERE, not in purportedly scrubbed stdout event fields.
    let data = try! JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
    attachment.name = "input-\(stage)-\(label)"; attachment.lifetime = .keepAlways; add(attachment)
    attach("input-\(stage)-\(label)")
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
