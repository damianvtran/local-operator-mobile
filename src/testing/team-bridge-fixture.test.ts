import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The viewer capture seam must be as closed as the fixture it rides on: a
 * normal build, a native build, a non-loopback origin or a URL without a
 * fixture case can never open a viewer from the query string.
 */
const platform = vi.hoisted(() => ({ OS: "web" as string }));
vi.mock("react-native", () => ({ Platform: platform }));

const { teamBridgeViewerFixture } = await import(
	"@/testing/team-bridge-fixture"
);

const at = (href: string) => {
	const url = new URL(href);
	vi.stubGlobal("location", {
		hostname: url.hostname,
		search: url.search,
		origin: url.origin,
	});
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	platform.OS = "web";
});

describe("image viewer fixture seam", () => {
	it("opens only in an opted-in web fixture build on loopback with a fixture case", () => {
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "1");
		at("http://127.0.0.1:18743/x?tb-fixture=attachments&tb-viewer=bcm_8:1");
		expect(teamBridgeViewerFixture()).toEqual({ messageId: "bcm_8", index: 1 });
	});

	it("is closed everywhere else", () => {
		at("http://127.0.0.1:18743/x?tb-fixture=attachments&tb-viewer=bcm_8:1");
		expect(teamBridgeViewerFixture()).toBe(null); // not a fixture build
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "1");
		at("https://example.com/x?tb-fixture=attachments&tb-viewer=bcm_8:1");
		expect(teamBridgeViewerFixture()).toBe(null); // not loopback
		at("http://127.0.0.1:18743/x?tb-viewer=bcm_8:1");
		expect(teamBridgeViewerFixture()).toBe(null); // no fixture case
		at("http://127.0.0.1:18743/x?tb-fixture=attachments&tb-viewer=../x:1");
		expect(teamBridgeViewerFixture()).toBe(null); // malformed
		platform.OS = "ios";
		at("http://127.0.0.1:18743/x?tb-fixture=attachments&tb-viewer=bcm_8:1");
		expect(teamBridgeViewerFixture()).toBe(null); // native
	});
});
