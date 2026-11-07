import { describe, expect, it, vi } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import type { SavedComputer } from "@/connection/saved-computers";
import {
	coldStartComputer,
	resumeComputerOnColdStart,
} from "./cold-start-computer";

/* Synthetic ids only. */
const computer = (
	tunnelId: string,
	overrides: Partial<DiscoveredComputer> = {},
): DiscoveredComputer => ({
	tunnelId,
	name: tunnelId,
	deviceId: "synthetic-device",
	hostname: `${tunnelId}.example.invalid`,
	status: "ready",
	rawStatus: "active",
	supportsLocalOperator: true,
	billing: { eligible: null, message: null },
	updatedAt: 0,
	...overrides,
});
const radient = (
	tunnelId: string,
	lastUsedAt: number,
	hidden = false,
): SavedComputer => ({
	id: `saved-${tunnelId}`,
	transport: "radient",
	tunnelId,
	hostname: `${tunnelId}.example.invalid`,
	name: tunnelId,
	account: null,
	addedAt: 1,
	lastUsedAt,
	hidden,
	identity: null,
});
const custom = (lastUsedAt: number): SavedComputer => ({
	id: "saved-custom",
	transport: "custom",
	baseUrl: "https://own.example.invalid",
	allowInsecure: false,
	name: "Own",
	addedAt: 1,
	lastUsedAt,
	hidden: false,
	identity: null,
});

describe("coldStartComputer", () => {
	it("reopens the most recently used computer that is listed and ready", () => {
		const decision = coldStartComputer({
			computers: [computer("t1"), computer("t2")],
			saved: [radient("t1", 5), radient("t2", 9)],
		});
		expect(decision).toEqual({ kind: "last", computer: computer("t2") });
	});

	it("opens the only usable computer when nothing was used", () => {
		expect(
			coldStartComputer({ computers: [computer("t1")], saved: [] }),
		).toEqual({ kind: "only", computer: computer("t1") });
	});

	it("falls back to the only computer when the last id is stale", () => {
		expect(
			coldStartComputer({
				computers: [computer("t1")],
				saved: [radient("removed-since", 9)],
			}),
		).toEqual({ kind: "only", computer: computer("t1") });
	});

	it("shows the picker for a stale last id among several computers", () => {
		expect(
			coldStartComputer({
				computers: [computer("t1"), computer("t2")],
				saved: [radient("removed-since", 9)],
			}),
		).toEqual({ kind: "picker" });
	});

	it("shows the picker with zero computers", () => {
		expect(
			coldStartComputer({ computers: [], saved: [radient("t1", 9)] }),
		).toEqual({ kind: "picker" });
	});

	it("shows the picker with several computers and no history", () => {
		expect(
			coldStartComputer({
				computers: [computer("t1"), computer("t2")],
				saved: [],
			}),
		).toEqual({ kind: "picker" });
	});

	it("does not reopen a last computer that is not ready or lacks Local Operator", () => {
		for (const unusable of [
			computer("t1", { status: "suspended" }),
			computer("t1", { status: "gone" }),
			computer("t1", { supportsLocalOperator: false }),
		]) {
			expect(
				coldStartComputer({
					computers: [unusable, computer("t2"), computer("t3")],
					saved: [radient("t1", 9)],
				}),
			).toEqual({ kind: "picker" });
		}
	});

	it("never counts an unusable computer toward 'only one'", () => {
		expect(
			coldStartComputer({
				computers: [computer("t1"), computer("t2", { status: "provisioning" })],
				saved: [],
			}),
		).toEqual({ kind: "only", computer: computer("t1") });
	});

	it("never auto-opens a computer the reader removed", () => {
		expect(
			coldStartComputer({
				computers: [computer("t1")],
				saved: [radient("t1", 9, true)],
			}),
		).toEqual({ kind: "picker" });
		/* A hidden last entry does not shadow an older visible one. */
		expect(
			coldStartComputer({
				computers: [computer("t1"), computer("t2")],
				saved: [radient("t1", 9, true), radient("t2", 3)],
			}),
		).toEqual({ kind: "last", computer: computer("t2") });
	});

	it("does not pick a Radient computer over a more recent own tunnel unless only one is listed", () => {
		expect(
			coldStartComputer({
				computers: [computer("t1"), computer("t2")],
				saved: [custom(10), radient("t1", 5)],
			}),
		).toEqual({ kind: "picker" });
	});
});

describe("resumeComputerOnColdStart", () => {
	const deps = (
		overrides: Partial<Parameters<typeof resumeComputerOnColdStart>[0]> = {},
	) => {
		const select = vi.fn(async () => undefined);
		return {
			select,
			deps: {
				signedIn: () => true,
				routed: () => false,
				refused: () => false,
				ownTunnelPending: () => false,
				computers: () => [computer("t1")],
				readSaved: async () => [] as SavedComputer[],
				select,
				isCancelled: () => false,
				...overrides,
			},
		};
	};

	it("selects the decided computer", async () => {
		const { deps: input, select } = deps();
		await expect(resumeComputerOnColdStart(input)).resolves.toEqual({
			kind: "only",
			computer: computer("t1"),
		});
		expect(select).toHaveBeenCalledWith(computer("t1"));
	});

	it("selects nothing for the picker", async () => {
		const { deps: input, select } = deps({ computers: () => [] });
		await expect(resumeComputerOnColdStart(input)).resolves.toEqual({
			kind: "picker",
		});
		expect(select).not.toHaveBeenCalled();
	});

	it.each([
		["no restored account", { signedIn: () => false }],
		["a route already exists", { routed: () => true }],
		["a refusal is showing", { refused: () => true }],
		["an own tunnel awaits its password", { ownTunnelPending: () => true }],
		["the cold start was interrupted", { isCancelled: () => true }],
	])("does nothing when %s", async (_label, override) => {
		const readSaved = vi.fn(async () => [] as SavedComputer[]);
		const { deps: input, select } = deps({ ...override, readSaved });
		await expect(resumeComputerOnColdStart(input)).resolves.toBeNull();
		expect(readSaved).not.toHaveBeenCalled();
		expect(select).not.toHaveBeenCalled();
	});

	it("yields to a tap or sign-out that lands during the registry read", async () => {
		let routed = false;
		const { deps: input, select } = deps({
			routed: () => routed,
			readSaved: async () => {
				routed = true;
				return [];
			},
		});
		await expect(resumeComputerOnColdStart(input)).resolves.toBeNull();
		expect(select).not.toHaveBeenCalled();
	});
});
