/**
 * Explicitly opted-in WEB QA seam. Never reads the real Radient accessor: a
 * fixture export uses a synthetic, unsigned token and a same-origin mock hub.
 * Normal/native builds cannot enter this path, even with a forged query string.
 * This lets the real screens exercise HTTP failures without signing an account
 * into a capture rig or forwarding a real bearer to a mock server.
 */
import { Platform } from "react-native";
import { fixtureOptions } from "@/testing/team-bridge-options";
import { TEAM_BRIDGE_FIXTURE_TOKEN } from "@/testing/team-bridge-token";

export function teamBridgeFixture() {
	if (process.env.EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES !== "1") return null;
	if (Platform.OS !== "web" || typeof location === "undefined") return null;
	if (!["localhost", "127.0.0.1"].includes(location.hostname)) return null;
	const options = fixtureOptions(location.search);
	if (!options) return null;
	return {
		...options,
		token:
			options.token === undefined ? TEAM_BRIDGE_FIXTURE_TOKEN : options.token,
		baseUrl: `${location.origin}/mock-hub/${options.world}`,
	};
}
