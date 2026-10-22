import { describe, expect, it, vi } from "vitest";
import {
	ADA,
	conversation,
	message,
	SELF,
	TENANT,
} from "@/team-bridge/__tests__/fixtures";
import { createMessageSender } from "./message-sender";

function setup() {
	const row = conversation({ id: "conversation-example", kind: "dm" });
	const create = vi.fn().mockResolvedValue(row);
	const send = vi
		.fn()
		.mockResolvedValue(message(1, SELF, "2026-10-21T10:00:00Z"));
	const adopt = vi.fn();
	const isCurrent = vi.fn(() => true);
	const clientRef = vi
		.fn()
		.mockReturnValueOnce("ref-first")
		.mockReturnValueOnce("ref-second");
	const options = {
		tenantId: TENANT,
		conversationId: null,
		target: {
			kind: "person" as const,
			tenantId: TENANT,
			accountId: ADA,
			label: "Example teammate",
		},
		create,
		send,
		adopt,
		isCurrent,
		clientRef,
	};
	return { ...options, run: createMessageSender(options), row };
}

describe("mounted Team Bridge composer", () => {
	it("does not create a DM on open or an empty send", async () => {
		const s = setup();
		expect(s.create).not.toHaveBeenCalled();
		expect(await s.run("  ")).toBe(false);
		expect(s.send).not.toHaveBeenCalled();
		expect(s.create).not.toHaveBeenCalled();
	});
	it("creates only on first send, adopts before send, and sends trimmed body", async () => {
		const s = setup();
		expect(await s.run(" Hello ")).toBe(true);
		expect(s.create).toHaveBeenCalledWith({
			tenantId: TENANT,
			kind: "dm",
			agentCapable: false,
			members: [
				{ account_id: ADA, kind: "human", display_label: "Example teammate" },
			],
		});
		expect(s.adopt).toHaveBeenCalledWith(s.row);
		expect(s.adopt.mock.invocationCallOrder[0]).toBeLessThan(
			s.send.mock.invocationCallOrder[0] as number,
		);
		expect(s.send).toHaveBeenCalledWith(TENANT, s.row.id, "Hello", "ref-first");
	});
	it("retains acknowledged conversation and exact clientRef after lost send response", async () => {
		const s = setup();
		s.send.mockRejectedValueOnce(new Error("Response lost"));
		await expect(s.run("Hello")).rejects.toThrow("Response lost");
		expect(await s.run("Hello")).toBe(true);
		expect(s.create).toHaveBeenCalledTimes(1);
		expect(s.send.mock.calls).toEqual([
			[TENANT, s.row.id, "Hello", "ref-first"],
			[TENANT, s.row.id, "Hello", "ref-first"],
		]);
	});
	it("allocates a new ref when reader changes the failed message", async () => {
		const s = setup();
		s.send.mockRejectedValueOnce(new Error("Offline"));
		await expect(s.run("Hello")).rejects.toThrow();
		await s.run("Different message");
		expect(s.create).toHaveBeenCalledTimes(1);
		expect(s.send).toHaveBeenLastCalledWith(
			TENANT,
			s.row.id,
			"Different message",
			"ref-second",
		);
	});
	it("retries an unacknowledged create without sending early", async () => {
		const s = setup();
		s.create.mockRejectedValueOnce(new Error("Offline"));
		await expect(s.run("Hello")).rejects.toThrow();
		expect(s.send).not.toHaveBeenCalled();
		await s.run("Hello");
		expect(s.create).toHaveBeenCalledTimes(2);
		expect(s.send).toHaveBeenCalledWith(TENANT, s.row.id, "Hello", "ref-first");
	});
	it("does not adopt or send a late create after sign-out or unmount", async () => {
		const s = setup();
		s.create.mockImplementation(async () => {
			s.isCurrent.mockReturnValue(false);
			return s.row;
		});
		expect(await s.run("Hello")).toBe(false);
		expect(s.adopt).not.toHaveBeenCalled();
		expect(s.send).not.toHaveBeenCalled();
	});
	it("suppresses a second send while the first is in flight", async () => {
		const s = setup();
		const first = s.run("Hello");
		expect(await s.run("Hello")).toBe(false);
		await first;
		expect(s.create).toHaveBeenCalledTimes(1);
		expect(s.send).toHaveBeenCalledTimes(1);
	});
	it("existing threads never create another conversation", async () => {
		const s = setup();
		const run = createMessageSender({ ...s, conversationId: s.row.id });
		await run("Hello");
		expect(s.create).not.toHaveBeenCalled();
		expect(s.send).toHaveBeenCalledTimes(1);
	});
	it("sends image-only with an empty body, and keys the retry ref on text AND images", async () => {
		const s = setup();
		expect(await s.run("", [])).toBe(false);
		s.send.mockRejectedValueOnce(new Error("dropped"));
		await expect(s.run(" ", ["batt_1"])).rejects.toThrow("dropped");
		expect(s.send).toHaveBeenLastCalledWith(TENANT, s.row.id, "", "ref-first", [
			"batt_1",
		]);
		// Same payload → same idempotency ref (a safe retry).
		s.send.mockRejectedValueOnce(new Error("dropped"));
		await expect(s.run("", ["batt_1"])).rejects.toThrow("dropped");
		expect(s.send.mock.calls[1]?.[3]).toBe("ref-first");
		// A changed image set is a different message: the hub would refuse the
		// old ref as `client_ref_conflict`, so a new one is minted.
		expect(await s.run("", ["batt_1", "batt_2"])).toBe(true);
		expect(s.send.mock.calls[2]?.[3]).toBe("ref-second");
	});
});
