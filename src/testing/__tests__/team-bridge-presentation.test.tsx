import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useTextScale } = vi.hoisted(() => ({
	useTextScale: vi.fn(() => ({ setPreference: vi.fn() })),
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@/features/auth/connection-provider", () => ({ configStore: {} }));
vi.mock("@/state/ui-store", () => ({ useUiStore: { getState: vi.fn() } }));
vi.mock("@/ui/text-scale-provider", () => ({ useTextScale }));

import { TeamBridgeFixturePresentation } from "@/testing/team-bridge-presentation";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	useTextScale.mockClear();
});
const valid =
	"?tb-fixture=notice_default&tb-flow=mountproof&tb-locale=ur&tb-scale=200";
function render(flag: string, host: string, search: string) {
	vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", flag);
	vi.stubGlobal("location", {
		hostname: host,
		origin: `http://${host}:18808`,
		search,
	});
	return renderToStaticMarkup(createElement(TeamBridgeFixturePresentation));
}

describe("fixture subscriber admission", () => {
	// SSR executes component bodies/hooks, not effects: counting the hook call
	// distinguishes a truly gated child from a subscriber with a no-op effect.
	it.each([
		["0", "localhost", valid],
		["1", "example.com", valid],
		["1", "localhost", "?tb-fixture=../../settings&tb-scale=200"],
		["1", "localhost", "?tb-scale=200"],
	])(
		"mounts no text-scale consumer for refused input %s %s %s",
		(flag, host, search) => {
			expect(render(flag, host, search)).toBe("");
			expect(useTextScale).not.toHaveBeenCalled();
		},
	);
	it("mounts the private subscribing child only for the opted-in loopback fixture", () => {
		expect(render("1", "localhost", valid)).toBe("");
		expect(useTextScale).toHaveBeenCalledTimes(1);
	});
});
