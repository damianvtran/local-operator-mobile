import XCTest

/// Shares production scalar/decoder/permit code. Source fixtures are not a claim
/// these tests ran on a simulator; the approved runner compile remains pending.
final class ReplayGuardTests: XCTestCase {
  private var exact: PromptObservation {
    PromptObservation(count: 1, titles: [ReplayGuards.scalars(ReplayGuards.title)],
      buttons: [ReplayGuards.scalars("Cancel"), ReplayGuards.scalars("Open")])
  }
  func testScalarFingerprintMatchesHostFixture() {
    XCTAssertTrue(ReplayGuards.exact(exact))
    XCTAssertEqual(exact.fingerprint, "2ba12b990d790f80e5a1df9ac31829274d5b6e1406ca2962eda12398a022ebbb")
    XCTAssertEqual("\u{00e9}", "e\u{0301}")
    XCTAssertNotEqual(ReplayGuards.scalars("\u{00e9}"), ReplayGuards.scalars("e\u{0301}"))
  }
  func testWrongQuotesAndExtraLabelsRefuse() {
    XCTAssertFalse(ReplayGuards.exact(PromptObservation(count: 1,
      titles: [ReplayGuards.scalars("Open in \"Local Operator\"?")], buttons: exact.buttons)))
    XCTAssertFalse(ReplayGuards.exact(PromptObservation(count: 2, titles: exact.titles, buttons: exact.buttons)))
    XCTAssertFalse(ReplayGuards.exact(PromptObservation(count: 1, titles: exact.titles,
      buttons: exact.buttons + [ReplayGuards.scalars("Open")])))
  }
  func testPlainReplySchemaRejectsExtraAuthorityAndOldEnvelopes() {
    XCTAssertThrowsError(try ReplayHostClient.decoded(Data("{\"payload\":\"x\",\"signature\":\"x\"}".utf8)))
    XCTAssertThrowsError(try ReplayHostClient.decoded(Data("{\"proofPID\":123}".utf8)))
  }
  func testUnknownRemoteOriginIsRejectedBeforeNetworking() {
    XCTAssertThrowsError(try ReplayHostClient(environment: ["LO_REPLAY_CONTROL": "https://example.invalid/rpc"]))
  }
  private var measured: HostIdentity {
    HostIdentity(udid: "fixture-owned", pid: 123, label: "fixture-label",
      source: ReplayGuards.source, bundle: ReplayGuards.bundle, hostSource: String(repeating: "c", count: 40))
  }
  private func permit(_ kind: String = "query", issued: Double = 1000,
                      expires: Double = 2000, identity: HostIdentity? = nil) -> HostGrant {
    HostGrant(version: 1, kind: kind, session: "fixture-session", challenge: String(repeating: "a", count: 64),
      issuedAt: issued, expiresAt: expires, phase: "seed", openAt: 900,
      identity: identity ?? measured, fingerprint: exact.fingerprint)
  }
  func testActualUseExpiryIdentityAndClockBoundaries() throws {
    try ReplayGuards.permit(permit(), session: "fixture-session", kind: "query", identity: measured, received: 5, now: 1500, uptime: 6)
    XCTAssertThrowsError(try ReplayGuards.permit(permit(), session: "fixture-session", kind: "query", identity: measured, received: 5, now: 2000, uptime: 6))
    XCTAssertThrowsError(try ReplayGuards.permit(permit(), session: "wrong", kind: "query", identity: measured, received: 5, now: 1500, uptime: 6))
    XCTAssertThrowsError(try ReplayGuards.permit(permit(), session: "fixture-session", kind: "tap", identity: measured, received: 5, now: 1500, uptime: 6))
    XCTAssertThrowsError(try ReplayGuards.permit(permit(), session: "fixture-session", kind: "query", identity: measured, received: 5, now: 1500, uptime: 8))
    XCTAssertThrowsError(try ReplayGuards.permit(permit(issued: .nan), session: "fixture-session", kind: "query", identity: measured, received: 5, now: 1500, uptime: 6))
    let changed = HostIdentity(udid: measured.udid, pid: 456, label: measured.label,
      source: measured.source, bundle: measured.bundle, hostSource: measured.hostSource)
    XCTAssertThrowsError(try ReplayGuards.permit(permit(identity: changed), session: "fixture-session", kind: "query", identity: measured, received: 5, now: 1500, uptime: 6))
  }
  func testActualClientConsumesOneLocalTapAndFailedAttemptCannotRetry() throws {
    let environment = ["LO_REPLAY_CONTROL": "http://127.0.0.1:23456/rpc", "LO_REPLAY_SESSION": "fixture-session",
      "LO_REPLAY_BEARER": "fixture-only", "LO_REPLAY_RUNNER_SOURCE": String(repeating: "c", count: 40), "SIMULATOR_UDID": measured.udid]
    let now = Date().timeIntervalSince1970 * 1000
    let tap = permit("tap", issued: now - 1, expires: now + 1000)
    let client = try ReplayHostClient(environment: environment)
    client.identity = measured; client.lastReceiptUptime = ProcessInfo.processInfo.systemUptime
    try client.consume(tap, observation: exact)
    XCTAssertThrowsError(try client.consume(tap, observation: exact))
    let failed = try ReplayHostClient(environment: environment)
    failed.identity = measured; failed.lastReceiptUptime = ProcessInfo.processInfo.systemUptime
    XCTAssertThrowsError(try failed.consume(tap, observation: PromptObservation(count: 0, titles: [], buttons: [])))
    XCTAssertThrowsError(try failed.consume(tap, observation: exact))
  }
}
