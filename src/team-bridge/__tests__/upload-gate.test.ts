import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAttachmentDraft } from "@/features/team-bridge/attachment-draft";
import { t } from "@/i18n";
import {
	attachmentCacheSize,
	clearAttachmentCache,
	loadAttachment,
} from "@/team-bridge/attachments";
import { createHubClient } from "@/team-bridge/client";
import { createTeamBridgeStore } from "@/team-bridge/store";
import { fixtureIdentity } from "@/testing/team-bridge-options";
import { SELF, TENANT } from "./fixtures";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Expected test value to exist");
	return value;
}
const token = `h.${Buffer.from(JSON.stringify({ sub: SELF })).toString("base64url")}.s`;
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]);
afterEach(clearAttachmentCache);
function uploaded() {
	return new Response(
		JSON.stringify({
			msg: "ok",
			result: {
				attachment: {
					id: "batt_uploaded",
					mime: "image/png",
					size: bytes.length,
					width: 1,
					height: 1,
					sha256: "synthetic",
					state: "staged",
					expires_at: "2026-11-10T00:00:00Z",
				},
			},
		}),
		{ status: 201, headers: { "content-type": "application/json" } },
	);
}
function setup(status: number, code: string) {
	const accessToken = vi.fn(async (_options?: { force?: boolean }) => token);
	const fetchImpl = vi.fn(
		async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(JSON.stringify({ error: "Synthetic refusal", code }), {
				status,
				headers: { "content-type": "application/json" },
			}),
	);
	const hub = createHubClient({ accessToken, fetchImpl });
	const bridge = createTeamBridgeStore({ hub: () => hub, accessToken });
	bridge.store.setState({
		gate: "open",
		selfAccountId: SELF,
		threads: {
			private: {
				messages: [],
				state: "ready",
				error: null,
				hasMore: false,
				loadingOlder: false,
				olderError: null,
			},
		},
	});
	const draft = createAttachmentDraft({
		maxCount: 4,
		prepare: async () => ({ bytes, mime: "image/png", width: 1, height: 1 }),
		upload: (data) => bridge.actions.uploadAttachment(TENANT, "c1", data),
		discard: vi.fn(async () => undefined),
		onChange: vi.fn(),
	});
	// Mirrors the gate's unmount: retired private drafts must not publish later.
	const unsubscribe = bridge.store.subscribe((state) => {
		if (state.gate === "signed_out") draft.dispose();
	});
	return { ...bridge, draft, fetchImpl, accessToken, unsubscribe };
}
describe("client → store → attachment draft upload refusals", () => {
	it.each([
		["attachments_upload_unauthorized", [401, 401], "signed_out"],
		["attachments_upload_plan", [403], "plan_required"],
		["attachments_upload_membership", [403], "open"],
		["attachments_upload_retry", [500, 201], "open"],
	] as const)(
		"executes real loopback HTTP through %s",
		async (qaCase, statuses, gate) => {
			// A tiny wire responder keeps Node tooling imports out of the app compiler
			// target; the real source fixture has its own HTTP contract tests.
			let attempts = 0;
			const server = createServer(async (req, res) => {
				for await (const _part of req) {
					/* Drain the real uploaded body. */
				}
				attempts++;
				const status = required(
					statuses[Math.min(attempts - 1, statuses.length - 1)],
				);
				res.writeHead(status, { "content-type": "application/json" });
				res.end(
					status === 201
						? await uploaded().text()
						: JSON.stringify({
								error: "Synthetic refusal",
								code:
									qaCase === "attachments_upload_plan"
										? "bridge_not_available"
										: qaCase === "attachments_upload_membership"
											? "not_a_member"
											: "internal_error",
							}),
				);
			});
			let draft: ReturnType<typeof createAttachmentDraft> | undefined;
			let unsubscribe = () => {};
			try {
				await new Promise<void>((resolve) =>
					server.listen(0, "127.0.0.1", resolve),
				);
				const address = server.address();
				if (!address || typeof address === "string")
					throw new Error("Missing ephemeral address");
				const url = `http://127.0.0.1:${address.port}`;
				const accessToken = vi.fn(async (_options?: { force?: boolean }) =>
					fixtureIdentity("upload-gate", "a"),
				);
				const actualStatuses: number[] = [];
				const hub = createHubClient({
					baseUrl: url,
					accessToken,
					fetchImpl: async (input, init) => {
						const answer = await fetch(input, init);
						actualStatuses.push(answer.status);
						return answer;
					},
				});
				const { store, actions } = createTeamBridgeStore({
					hub: () => hub,
					accessToken,
				});
				store.setState({
					gate: "open",
					selfAccountId: "fixture_upload-gate_a",
				});
				draft = createAttachmentDraft({
					maxCount: 4,
					prepare: async () => ({
						bytes,
						mime: "image/png",
						width: 1,
						height: 1,
					}),
					upload: (data) =>
						actions.uploadAttachment(TENANT, "bcv_humans", data),
					discard: (id) => hub.deleteAttachment(TENANT, "bcv_humans", id),
					onChange: () => {},
				});
				unsubscribe = store.subscribe((state) => {
					if (state.gate === "signed_out") draft?.dispose();
				});
				draft.add([{}]);
				await vi.waitFor(() =>
					expect(
						store.getState().gate === "signed_out" ||
							draft?.chips()[0]?.status === "failed",
					).toBe(true),
				);
				if (qaCase === "attachments_upload_retry") {
					draft.retry(required(draft.chips()[0]).key);
					await vi.waitFor(() =>
						expect(draft?.chips()[0]?.status).toBe("ready"),
					);
				} else if (gate !== "signed_out")
					expect(draft.chips()[0]?.retryable).toBe(false);
				expect(actualStatuses).toEqual(statuses);
				expect(store.getState().gate).toBe(gate);
				expect(
					accessToken.mock.calls.filter(([options]) => options?.force),
				).toHaveLength(gate === "signed_out" ? 1 : 0);
				console.log(
					`${qaCase}: HTTP ${actualStatuses.join(" → ")}; gate=${gate}; forcedRefresh=${accessToken.mock.calls.filter(([options]) => options?.force).length}`,
				);
			} finally {
				unsubscribe();
				draft?.dispose();
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
		},
	);
	it("retires private state once after two 401s and one forced refresh, never upload Retry", async () => {
		const rig = setup(401, "unauthorized");
		await loadAttachment(
			"upload-test",
			async () => "data:image/png;base64,AA==",
		);
		let retirements = 0;
		rig.store.subscribe((s) => {
			if (s.gate === "signed_out") retirements++;
		});
		rig.draft.add([{}]);
		await flush();
		await flush();
		expect(rig.fetchImpl).toHaveBeenCalledTimes(2);
		expect(
			rig.accessToken.mock.calls.filter(([options]) => options?.force),
		).toHaveLength(1);
		expect(rig.store.getState()).toMatchObject({
			gate: "signed_out",
			threads: {},
			attachments: null,
		});
		expect(rig.store.getState().threads).toEqual({});
		expect(attachmentCacheSize()).toBe(0);
		expect(rig.draft.chips()).toEqual([]);
		expect(retirements).toBe(1);
		await expect(
			rig.actions.uploadAttachment(TENANT, "c1", bytes),
		).rejects.toMatchObject({ kind: "sign_in" });
		expect(rig.fetchImpl).toHaveBeenCalledTimes(2);
		rig.unsubscribe();
	});
	it.each([
		[403, "bridge_not_available", "plan_required", false],
		[403, "not_a_member", "open", false],
		[500, "internal_error", "open", true],
	] as const)(
		"keeps %s %s recovery distinct",
		async (status, code, gate, retryable) => {
			const rig = setup(status, code);
			rig.draft.add([{}]);
			await flush();
			await flush();
			expect(rig.store.getState().gate).toBe(gate);
			expect(rig.draft.chips()[0]).toMatchObject({
				status: "failed",
				retryable,
			});
			expect(
				rig.accessToken.mock.calls.filter(([options]) => options?.force),
			).toHaveLength(0);
			expect(rig.fetchImpl).toHaveBeenCalledTimes(1);
			if (retryable) {
				rig.fetchImpl.mockImplementationOnce(async () => uploaded());
				rig.draft.retry(required(rig.draft.chips()[0]).key);
				await flush();
				await flush();
				expect(rig.fetchImpl).toHaveBeenCalledTimes(2);
				expect(rig.draft.chips()[0]).toMatchObject({
					status: "ready",
					attachmentId: "batt_uploaded",
				});
			} else {
				rig.draft.retry(required(rig.draft.chips()[0]).key);
				await flush();
				expect(rig.fetchImpl).toHaveBeenCalledTimes(1);
			}
			if (status === 403)
				expect(rig.draft.chips()[0]?.error).toBe(
					code === "bridge_not_available"
						? t("mobile.team_bridge.gate.plan_required")
						: t("mobile.team_bridge.error.http_status", { status: 403 }),
				);
			rig.unsubscribe();
			rig.draft.dispose();
		},
	);
	it("cleans a late successful upload without publishing into the new account", async () => {
		const rig = setup(401, "unauthorized");
		let resolve!: (response: Response) => void;
		rig.fetchImpl.mockImplementationOnce(
			() =>
				new Promise<Response>((done) => {
					resolve = done;
				}),
		);
		const pending = rig.actions.uploadAttachment(TENANT, "c1", bytes);
		await flush();
		rig.actions.reset();
		rig.store.setState({ gate: "open", selfAccountId: "new-account" });
		rig.fetchImpl.mockImplementationOnce(
			async () => new Response(null, { status: 204 }),
		);
		resolve(uploaded());
		await expect(pending).rejects.toMatchObject({ kind: "sign_in" });
		await flush();
		expect(rig.fetchImpl.mock.calls).toHaveLength(2);
		const [destination, init] = required(rig.fetchImpl.mock.calls[1]);
		expect(String(destination)).toContain(
			"/conversations/c1/attachments/batt_uploaded",
		);
		expect(String(destination)).toContain(`tenant_id=${TENANT}`);
		expect(init?.method).toBe("DELETE");
		expect(rig.store.getState()).toMatchObject({
			gate: "open",
			selfAccountId: "new-account",
		});
		rig.unsubscribe();
		rig.draft.dispose();
	});
	it("ignores a late final 401 from a retired account", async () => {
		const rig = setup(401, "unauthorized");
		let resolve!: (response: Response) => void;
		rig.fetchImpl.mockImplementationOnce(
			() =>
				new Promise<Response>((done) => {
					resolve = done;
				}),
		);
		const pending = rig.actions.uploadAttachment(TENANT, "c1", bytes);
		await flush();
		rig.actions.reset();
		rig.store.setState({ gate: "open", selfAccountId: "new-account" });
		resolve(new Response("{}", { status: 401 }));
		await expect(pending).rejects.toMatchObject({ kind: "sign_in" });
		expect(rig.store.getState()).toMatchObject({
			gate: "open",
			selfAccountId: "new-account",
		});
		rig.unsubscribe();
		rig.draft.dispose();
	});
});
