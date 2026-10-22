/**
 * Explicitly opted-in WEB QA seam. Never reads the real Radient accessor: a
 * fixture export uses a synthetic, unsigned token and a same-origin mock hub.
 * Normal/native builds cannot enter this path, even with a forged query string.
 * This lets the real screens exercise HTTP failures without signing an account
 * into a capture rig or forwarding a real bearer to a mock server.
 */
import { Platform } from "react-native";

const VALID_CASE = /^[a-z_-]+$/;

/**
 * Design/QA capture seam for the image viewer: `tb-viewer=<messageId>:<index>`
 * opens that message's viewer at that page on load, so a frame of "page 2 of
 * 4" needs no scripted taps. Same gates as `teamBridgeFixture` (fixture build,
 * web, loopback, a fixture case in the URL); `null` everywhere else.
 */
const VIEWER = /^([A-Za-z0-9_-]{1,64}):([0-9])$/;
export function teamBridgeViewerFixture(): {
	messageId: string;
	index: number;
} | null {
	if (!teamBridgeFixture()) return null;
	const match = VIEWER.exec(
		new URLSearchParams(location.search).get("tb-viewer") ?? "",
	);
	return match ? { messageId: match[1] ?? "", index: Number(match[2]) } : null;
}

export function teamBridgeFixture(): {
	baseUrl: string;
	token: string | null;
} | null {
	if (process.env.EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES !== "1") return null;
	if (Platform.OS !== "web" || typeof location === "undefined") return null;
	if (!["localhost", "127.0.0.1"].includes(location.hostname)) return null;
	const scenario = new URLSearchParams(location.search).get("tb-fixture");
	if (!scenario || !VALID_CASE.test(scenario)) return null;
	return {
		baseUrl: `${location.origin}/mock-hub/${scenario}`,
		token:
			scenario === "signed_out"
				? null
				: "fixture.eyJzdWIiOiJhY2N0X3NlbGZfMDAwMSJ9.unsigned-not-a-credential",
	};
}
