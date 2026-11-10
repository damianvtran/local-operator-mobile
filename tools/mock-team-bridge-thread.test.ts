import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { messagePageSchema } from "../src/team-bridge/contract";
import { TEAM_BRIDGE_FIXTURE_TOKEN } from "../src/testing/team-bridge-token";
import { createTeamBridgeFixture } from "./mock-team-bridge";

const servers: ReturnType<typeof createTeamBridgeFixture>[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function rig() {
	const server = createTeamBridgeFixture({ root: resolve("dist") });
	servers.push(server);
	return (await server.listen()).url;
}
const get = (url: string, path: string) =>
	fetch(`${url}${path}`, {
		headers: { authorization: `Bearer ${TEAM_BRIDGE_FIXTURE_TOKEN}` },
	});
const api = "/mock-hub/thread_polish/v1/messaging";

describe("thread polish real HTTP evidence contract", () => {
	it("returns long names and exclusive newest-first paginated history through actual routes", async () => {
		const url = await rig();
		const rows = await get(
			url,
			`${api}/conversations?tenant_id=ten_0123456789abcdef`,
		);
		expect(rows.status).toBe(200);
		const listing = (await rows.json()).result.conversations;
		expect(
			listing.find((row: { id: string }) => row.id === "bcv_humans").name,
		).toBe("international-partnerships-and-launch-planning");
		expect(
			listing.find((row: { id: string }) => row.id === "bcv_group").name,
		).toContain("cross-organisation");
		const page = async (before = "") => {
			const response = await get(
				url,
				`${api}/conversations/bcv_humans/messages?tenant_id=ten_0123456789abcdef${before}`,
			);
			expect(response.status).toBe(200);
			return messagePageSchema.parse((await response.json()).result);
		};
		const latest = await page();
		expect(latest.messages).toHaveLength(50);
		expect(latest.messages[0]?.seq).toBe(80);
		expect(latest.messages.at(-1)?.seq).toBe(31);
		expect(latest.has_more).toBe(true);
		const older = await page("&before_seq=31");
		expect(older.messages).toHaveLength(30);
		expect(older.messages[0]?.seq).toBe(30);
		expect(older.has_more).toBe(false);
	});
	it("keeps admitted empty threads distinct from an empty organization", async () => {
		const url = await rig();
		const response = await get(
			url,
			"/mock-hub/thread_empty/v1/messaging/conversations/bcv_humans/messages?tenant_id=ten_0123456789abcdef",
		);
		expect(response.status).toBe(200);
		expect(
			messagePageSchema.parse((await response.json()).result).messages,
		).toEqual([]);
	});
	it("serves named group and DM targets at real 320/200 geometry without modifying app rows", async () => {
		const url = await rig();
		for (const conversation of ["group", "dm"]) {
			const response = await fetch(
				`${url}/__phone?case=thread_polish&thread=1&conversation=${conversation}&width=320&scale=200`,
			);
			expect(response.status).toBe(200);
			const html = await response.text();
			expect(html).toContain("width:320px;height:844px");
			expect(html).toContain("tb-scale=200");
			expect(html).toContain("scrollTop:e.scrollTop");
		}
	});
});
