import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createHubClient } from "@/team-bridge/client";
import { fixtureIdentity } from "@/testing/team-bridge-options";
import { TEAM_BRIDGE_FIXTURE_TOKEN } from "@/testing/team-bridge-token";
import { OTHER_TENANT, TENANT } from "./fixtures";

const ANNOUNCED_ADDRESS = /listening on (127\.0\.0\.1:\d+)/;
const servers: ChildProcess[] = [];
afterEach(async () => {
	for (const child of servers.splice(0)) {
		const pid = child.pid;
		if (!pid || child.exitCode !== null) continue;
		const exited = once(child, "exit");
		process.kill(-pid, "SIGTERM");
		await exited;
		expect(() => process.kill(pid, 0)).toThrow();
	}
});
async function fixture(
	variant = "attachments",
	token = TEAM_BRIDGE_FIXTURE_TOKEN,
) {
	// Exercise the supported CLI rather than importing Node-only .ts modules
	// into the app compiler or weakening its module-resolution settings.
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(
				new URL("../../../tools/mock-team-bridge.ts", import.meta.url),
			),
			"dist",
			"0",
		],
		{
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...Object.fromEntries(
					Object.entries(process.env).filter(
						([name]) => !name.startsWith("CMUX_"),
					),
				),
				NODE_ENV: process.env.NODE_ENV ?? "test",
			},
		},
	);
	servers.push(child);
	const url = await new Promise<string>((resolve, reject) => {
		let output = "";
		// Match the existing relay CLI test's startup lease, not a product timeout.
		const timer = setTimeout(
			() => reject(new Error("fixture CLI did not announce its port")),
			15_000,
		);
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			const address = ANNOUNCED_ADDRESS.exec(output)?.[1];
			if (address) {
				clearTimeout(timer);
				resolve(`http://${address}`);
			}
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`fixture exited before port: ${code}`));
		});
	});
	const baseUrl = `${url}/mock-hub/${variant}`;
	return {
		baseUrl,
		hub: createHubClient({
			baseUrl,
			accessToken: async () => token,
		}),
	};
}

describe("attachment client over the supported HTTP fixture", () => {
	it("advertises, uploads, binds and renders image-only content through scoped bearer routes", async () => {
		const { hub } = await fixture();
		expect((await hub.status()).attachments?.enabled).toBe(true);
		const page = await hub.listMessages(TENANT, "bcv_humans");
		// The renderer uses each row's conversation, not the selected screen route.
		expect(
			page.messages.every((row) => row.conversation_id === "bcv_humans"),
		).toBe(true); // seeds synthetic authorized images
		const original = await hub.attachmentBytes(
			TENANT,
			"bcv_humans",
			"bcm_7",
			"batt_one",
		);
		const staged = await hub.uploadAttachment(
			TENANT,
			"bcv_humans",
			original.bytes,
		);
		const bound = await hub.send(TENANT, "bcv_humans", {
			body: "",
			clientRef: "synthetic-image-send",
			attachmentIds: [staged.id],
		});
		expect(bound.body).toBe("");
		expect(bound.attachments?.[0]?.id).toBe(staged.id);
		const rendered = await hub.attachmentBytes(
			TENANT,
			"bcv_humans",
			bound.id,
			staged.id,
		);
		expect(rendered.mime).toBe("image/png");
		expect(rendered.bytes).toEqual(original.bytes);
		await expect(
			hub.attachmentBytes(OTHER_TENANT, "bcv_humans", bound.id, staged.id),
		).rejects.toMatchObject({ kind: "refused", status: 403 });
		await expect(
			hub.attachmentBytes(TENANT, "bcv_general", bound.id, staged.id),
		).rejects.toMatchObject({ kind: "not_found", status: 404 });
		await expect(
			hub.attachmentBytes(TENANT, "bcv_humans", "wrong-message", staged.id),
		).rejects.toMatchObject({ kind: "not_found", status: 404 });
	});

	it("refuses invalid bytes, expired auth, deleted staging and wrong-tenant uploads", async () => {
		const { hub, baseUrl } = await fixture();
		await expect(
			hub.uploadAttachment(TENANT, "bcv_humans", new Uint8Array([1, 2, 3])),
		).rejects.toMatchObject({ kind: "invalid", status: 415 });
		await expect(
			hub.uploadAttachment(OTHER_TENANT, "bcv_humans", new Uint8Array([1])),
		).rejects.toMatchObject({ kind: "refused", status: 403 });
		const page = await hub.listMessages(TENANT, "bcv_humans");
		// The renderer uses each row's conversation, not the selected screen route.
		expect(
			page.messages.every((row) => row.conversation_id === "bcv_humans"),
		).toBe(true);
		const original = await hub.attachmentBytes(
			TENANT,
			"bcv_humans",
			"bcm_7",
			"batt_one",
		);
		const staged = await hub.uploadAttachment(
			TENANT,
			"bcv_humans",
			original.bytes,
		);
		await hub.deleteAttachment(TENANT, "bcv_humans", staged.id);
		await expect(
			hub.send(TENANT, "bcv_humans", {
				body: "",
				clientRef: "synthetic-deleted-send",
				attachmentIds: [staged.id],
			}),
		).rejects.toMatchObject({ kind: "not_found" });
		const expired = createHubClient({
			baseUrl,
			accessToken: async () => "synthetic-expired",
		});
		await expect(
			expired.attachmentBytes(TENANT, "bcv_humans", "bcm_7", "batt_one"),
		).rejects.toMatchObject({ kind: "sign_in", status: 401 });
	});

	it("keeps retryable upload and byte failures distinguishable from final refusals", async () => {
		const upload = await fixture("attachments_upload_failed");
		await expect(
			upload.hub.uploadAttachment(TENANT, "bcv_humans", new Uint8Array([1])),
		).rejects.toMatchObject({ kind: "unavailable", status: 503 });
		const download = await fixture("attachments_fetch_error");
		await download.hub.listMessages(TENANT, "bcv_humans");
		await expect(
			download.hub.attachmentBytes(TENANT, "bcv_humans", "bcm_7", "batt_one"),
		).rejects.toMatchObject({ kind: "server", status: 500 });
	});
	it("isolates synthetic world bytes and bindings while retaining real bearer and tenant checks", async () => {
		const token = fixtureIdentity("attachment6", "a");
		const first = await fixture("attachments~attachment6~a~one", token);
		const hub = first.hub;
		await hub.listMessages(TENANT, "bcv_humans");
		const original = await hub.attachmentBytes(
			TENANT,
			"bcv_humans",
			"bcm_7",
			"batt_one",
		);
		const staged = await hub.uploadAttachment(
			TENANT,
			"bcv_humans",
			original.bytes,
		);
		const other = createHubClient({
			baseUrl: first.baseUrl.replace("~a~one", "~b~one"),
			accessToken: async () => fixtureIdentity("attachment6", "b"),
		});
		await expect(
			other.send(TENANT, "bcv_humans", {
				body: "",
				clientRef: "wrong-world",
				attachmentIds: [staged.id],
			}),
		).rejects.toMatchObject({ status: 404 });
		const wrongIdentity = createHubClient({
			baseUrl: first.baseUrl,
			accessToken: async () => fixtureIdentity("attachment6", "b"),
		});
		await expect(wrongIdentity.status()).rejects.toMatchObject({ status: 401 });
		const bound = await hub.send(TENANT, "bcv_humans", {
			body: "",
			clientRef: "world-image",
			attachmentIds: [staged.id],
		});
		expect(
			(await hub.attachmentBytes(TENANT, "bcv_humans", bound.id, staged.id))
				.bytes,
		).toEqual(original.bytes);
		await expect(
			other.attachmentBytes(TENANT, "bcv_humans", bound.id, staged.id),
		).rejects.toMatchObject({ status: 404 });
		const otherOrg = createHubClient({
			baseUrl: first.baseUrl.replace("~one", "~two"),
			accessToken: async () => token,
		});
		await expect(
			otherOrg.uploadAttachment(TENANT, "bcv_humans", original.bytes),
		).rejects.toMatchObject({ status: 403 });
		const secondOrgImage = await otherOrg.uploadAttachment(
			OTHER_TENANT,
			"bcv_humans",
			original.bytes,
		);
		expect(secondOrgImage.state).toBe("staged");
	});

	it("provides deterministic first-upload 500 then success, and a 401 retirement case", async () => {
		const token = fixtureIdentity("retry6", "a");
		const { hub } = await fixture(
			"attachments_upload_retry~retry6~a~one",
			token,
		);
		await hub.listMessages(TENANT, "bcv_humans");
		const original = await hub.attachmentBytes(
			TENANT,
			"bcv_humans",
			"bcm_7",
			"batt_one",
		);
		await expect(
			hub.uploadAttachment(TENANT, "bcv_humans", original.bytes),
		).rejects.toMatchObject({ status: 500, kind: "server" });
		expect(
			(await hub.uploadAttachment(TENANT, "bcv_humans", original.bytes)).state,
		).toBe("staged");
		const retired = await fixture(
			"attachments_upload_unauthorized~retry6~a~one",
			token,
		);
		await expect(
			retired.hub.uploadAttachment(TENANT, "bcv_humans", original.bytes),
		).rejects.toMatchObject({ status: 401, kind: "sign_in" });
	});
});
