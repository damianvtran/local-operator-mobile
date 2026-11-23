/**
 * Explicitly opted-in WEB QA seam for the community client, riding the Team
 * Bridge seam's gates (`team-bridge-fixture.ts`: fixture build, web, loopback
 * host, a fixture case in the URL). The real screens and the real community
 * client run unchanged against a same-origin mock (`tools/mock-community.ts`),
 * with the same synthetic, unsigned token: no real Radient credential can reach
 * the mock, and no normal or native build can enter this path.
 */
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";

export function communityFixture(): {
	baseUrl: string;
	token: string | null;
} | null {
	const fixture = teamBridgeFixture();
	if (!fixture) return null;
	return {
		/* The client appends `/community/v1` itself (root-relative). */
		baseUrl: `${location.origin}/mock-community/${fixture.world}`,
		token: fixture.token,
	};
}
