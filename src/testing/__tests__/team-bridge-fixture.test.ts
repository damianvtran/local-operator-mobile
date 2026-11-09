import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { Platform } from "react-native";
import { accountIdFromToken } from "@/connection/radient-identity";
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";
import { fixtureOptions } from "@/testing/team-bridge-options";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	Platform.OS = "web";
});
const search =
	"?tb-fixture=notice_default&tb-flow=review4&tb-account=b&tb-org=two&tb-locale=ur&tb-scale=200&tb-theme=dark";
function page(hostname = "localhost") {
	vi.stubGlobal("location", {
		hostname,
		origin: `http://${hostname}:18808`,
		search,
	});
}

describe("opted-in loopback fixture controls", () => {
	it("refuses all query overrides in a production export", () => {
		page();
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "0");
		expect(teamBridgeFixture()).toBeNull();
	});
	it("refuses remote origins and native platforms even in a fixture export", () => {
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "1");
		page("example.com");
		expect(teamBridgeFixture()).toBeNull();
		page();
		Platform.OS = "ios";
		expect(teamBridgeFixture()).toBeNull();
	});
	it("selects only synthetic scoped identities and supported presentation values", () => {
		page();
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "1");
		const fixture = teamBridgeFixture();
		expect(fixture).toMatchObject({
			locale: "ur",
			scale: "200",
			theme: "dark",
		});
		expect(accountIdFromToken(fixture?.token ?? "")).toBe("fixture_review4_b");
		expect(fixture?.baseUrl).toContain("notice_default~review4~b~two");
		expect(
			fixtureOptions(search.replace("review4", "review5"))?.token,
		).not.toBe(fixture?.token);
		expect(
			fixtureOptions(search.replace("tb-account=b", "tb-account=a"))?.token,
		).not.toBe(fixture?.token);
		expect(
			fixtureOptions("?tb-fixture=notice_default&tb-locale=xx&tb-scale=999"),
		).toMatchObject({ locale: "en", scale: "100" });
		expect(fixtureOptions("?tb-fixture=../../settings")).toBeNull();
	});
});
