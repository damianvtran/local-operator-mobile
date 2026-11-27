import { describe, expect, it } from "vitest";

import { RelayError } from "@/relay";
import { createGuardController } from "./guard-controller";
import {
	APPROVAL,
	card,
	DIGEST_A,
	DIGEST_B,
	nonTeamStatus,
	org,
	status,
	TENANT,
	waitingOrg,
} from "./guard-fixtures";

type Call = { name: string; args: unknown[] };

/** A scripted client: every method records itself, and `script` answers it. A
 *  method with no script entry THROWS, so a call the test did not anticipate is
 *  a failure rather than a silent undefined. */
function fakeClient(script: Record<string, (...args: never[]) => unknown>) {
	const calls: Call[] = [];
	const client = new Proxy(
		{},
		{
			get:
				(_t, name: string) =>
				async (...args: unknown[]) => {
					calls.push({ name, args });
					const fn = script[name];
					if (fn === undefined) throw new Error(`unscripted call ${name}`);
					return (fn as (...a: unknown[]) => unknown)(...args);
				},
		},
	);
	return {
		client: client as never,
		calls,
		names: () => calls.map((c) => c.name),
	};
}

const rejected = (status: number, code?: string) =>
	new RelayError("rejected", "refused", { status, code });
const transport = () => new RelayError("transport", "offline");

/** A clock the test moves, so the 500 ms debounce is exact. */
function clock(start = 1_000_000) {
	let at = start;
	return {
		now: () => at,
		advance: (ms: number) => {
			at += ms;
		},
	};
}

async function opened(
	over: Partial<Parameters<typeof fakeClient>[0]> = {},
	statusBody = status({ orgs: [waitingOrg()] }),
) {
	const c = clock();
	const fake = fakeClient({
		guardStatus: () => statusBody,
		guardConsentCard: () => card(),
		acceptGuardConsent: () => ({
			approval_id: APPROVAL,
			state: "granted",
			tenant: TENANT,
		}),
		declineGuardConsent: () => ({
			approval_id: APPROVAL,
			state: "denied",
			tenant: TENANT,
		}),
		...over,
	});
	const controller = createGuardController(fake.client, c.now);
	await controller.activate();
	await controller.openConsent(TENANT);
	return { controller, fake, clock: c };
}

describe("reads", () => {
	it("a Team account makes exactly one request: the host's local status", async () => {
		const fake = fakeClient({ guardStatus: () => status() });
		const controller = createGuardController(fake.client);
		await controller.activate();
		expect(fake.names()).toEqual(["guardStatus"]);
		expect(controller.getState().read.kind).toBe("ready");
	});

	it("a non-Team account reads the status and the card's trial length — nothing else", async () => {
		const fake = fakeClient({
			guardStatus: () => nonTeamStatus(),
			guardNonTeamCard: () => ({
				trial_days: 14,
				org: null,
				url: "https://console.radienthq.com/dashboard/team",
			}),
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		expect(fake.names()).toEqual(["guardStatus", "guardNonTeamCard"]);
		// The §14' invariant at the phone's seam: the card is not a Guard write.
		for (const forbidden of [
			"acceptGuardConsent",
			"declineGuardConsent",
			"guardRevoke",
			"guardShareAgain",
			"guardConsentCard",
		])
			expect(fake.names()).not.toContain(forbidden);
	});

	it("a card read that fails still shows the card (See Radient Team), never an error", async () => {
		const fake = fakeClient({
			guardStatus: () => nonTeamStatus(),
			guardNonTeamCard: () => {
				throw transport();
			},
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		expect(controller.getState().read).toMatchObject({
			kind: "ready",
			card: null,
		});
	});

	it("404 is 'unsupported' (calm), anything else is an error", async () => {
		for (const [error, kind] of [
			[rejected(404), "unsupported"],
			[transport(), "error"],
			[rejected(500), "error"],
		] as const) {
			const fake = fakeClient({
				guardStatus: () => {
					throw error;
				},
			});
			const controller = createGuardController(fake.client);
			await controller.activate();
			expect(controller.getState().read.kind).toBe(kind);
		}
	});

	it("a silent refresh that fails keeps the last good view", async () => {
		let fail = false;
		const fake = fakeClient({
			guardStatus: () => {
				if (fail) throw transport();
				return status();
			},
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		fail = true;
		await controller.reload({ silent: true });
		expect(controller.getState().read.kind).toBe("ready");
	});

	it("the latest read wins over a slower earlier one", async () => {
		const resolvers: Array<(value: unknown) => void> = [];
		const fake = fakeClient({
			guardStatus: () => new Promise((resolve) => resolvers.push(resolve)),
		});
		const controller = createGuardController(fake.client);
		const first = controller.activate();
		const second = controller.reload({ silent: true });
		resolvers[1]?.(status({ this_computer: "NEW" }));
		await second;
		resolvers[0]?.(status({ this_computer: "OLD" }));
		await first;
		const read = controller.getState().read;
		expect(read.kind === "ready" && read.status.this_computer).toBe("NEW");
	});
});

describe("the consent card: what the phone may send", () => {
	it("opening reads the card the status named, and sends nothing", async () => {
		const { controller, fake } = await opened();
		expect(controller.getState().consent.phase).toBe("open");
		expect(fake.calls.find((c) => c.name === "guardConsentCard")?.args).toEqual(
			[APPROVAL],
		);
		expect(fake.names()).not.toContain("acceptGuardConsent");
	});

	it("an answer inside the 500 ms debounce is ignored and sends NOTHING", async () => {
		const { controller, fake, clock: c } = await opened();
		c.advance(499);
		expect(await controller.share()).toBe("ignored");
		expect(await controller.decline()).toBe("ignored");
		expect(fake.names()).not.toContain("acceptGuardConsent");
		expect(fake.names()).not.toContain("declineGuardConsent");
		expect(controller.getState().consent.phase).toBe("open");
	});

	it("after the debounce, 'Share' sends ONLY the two digests of the card that was read", async () => {
		const { controller, fake, clock: c } = await opened();
		c.advance(500);
		expect(await controller.share()).toBe("sent");
		const accept = fake.calls.find(
			(call) => call.name === "acceptGuardConsent",
		);
		expect(accept?.args).toEqual([
			APPROVAL,
			{ request_digest: DIGEST_A, disclosure_digest: DIGEST_B },
		]);
		// No scope, no tenant, no signature can ride along (RFC §5.2.2).
		expect(Object.keys((accept?.args[1] as object) ?? {}).sort()).toEqual([
			"disclosure_digest",
			"request_digest",
		]);
		expect(controller.getState().outcome).toEqual({
			kind: "shared",
			org: "Example Org",
		});
		expect(controller.getState().consent.phase).toBe("closed");
	});

	it("'Don't share' sends a bare decline: no digests, no scopes", async () => {
		const { controller, fake, clock: c } = await opened();
		c.advance(600);
		expect(await controller.decline()).toBe("sent");
		expect(
			fake.calls.find((call) => call.name === "declineGuardConsent")?.args,
		).toEqual([APPROVAL]);
		expect(fake.names()).not.toContain("acceptGuardConsent");
		expect(controller.getState().outcome?.kind).toBe("declined");
	});

	it("'Decide later' closes the card, sends nothing, and the request stays pending", async () => {
		const { controller, fake } = await opened();
		controller.closeConsent();
		expect(controller.getState().consent.phase).toBe("closed");
		const writes = fake
			.names()
			.filter((n) => /accept|decline|revoke|shareAgain/i.test(n));
		expect(writes).toEqual([]);
		// Still pending: a re-read says so and the card can be reopened.
		await controller.reload({ silent: true });
		const read = controller.getState().read;
		expect(read.kind === "ready" && read.status.orgs[0]?.prompt).not.toBeNull();
	});

	it("a card the host will not sign (signable: false) cannot be shared from the phone", async () => {
		const {
			controller,
			fake,
			clock: c,
		} = await opened({
			guardConsentCard: () => card({ signable: false, refusal: "x" }),
		});
		c.advance(900);
		expect(await controller.share()).toBe("refused");
		expect(fake.names()).not.toContain("acceptGuardConsent");
	});

	it("a scope this build cannot describe cannot be consented to here", async () => {
		const {
			controller,
			fake,
			clock: c,
		} = await opened({
			guardConsentCard: () =>
				card({ asked_scopes: ["decisions", "keystrokes"] }),
		});
		c.advance(900);
		expect(await controller.share()).toBe("refused");
		expect(fake.names()).not.toContain("acceptGuardConsent");
	});

	it("a card for a different request than the status named is a stale pointer", async () => {
		const c = clock();
		const fake = fakeClient({
			guardStatus: () => status({ orgs: [waitingOrg()] }),
			guardConsentCard: () => card({ approval_id: "req_OTHER" }),
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(controller.getState().consent.phase).toBe("closed");
		expect(controller.getState().outcome?.kind).toBe("changed");
	});

	it("a card already answered (state ≠ requested) is not offered", async () => {
		const c = clock();
		const fake = fakeClient({
			guardStatus: () => status({ orgs: [waitingOrg()] }),
			guardConsentCard: () => card({ state: "approved" }),
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(controller.getState().consent.phase).toBe("closed");
		expect(controller.getState().outcome?.kind).toBe("changed");
	});

	it("a prompt with no approval id (no operator key) cannot be opened from the phone", async () => {
		const bare = waitingOrg();
		if (bare.prompt) bare.prompt.approval_id = null;
		const fake = fakeClient({ guardStatus: () => status({ orgs: [bare] }) });
		const controller = createGuardController(fake.client);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(fake.names()).toEqual(["guardStatus"]);
		expect(controller.getState().consent.phase).toBe("closed");
	});

	it("an answer with no open card is ignored (no grant without a card that was read)", async () => {
		const fake = fakeClient({
			guardStatus: () => status({ orgs: [waitingOrg()] }),
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		expect(await controller.share()).toBe("ignored");
		expect(fake.names()).toEqual(["guardStatus"]);
	});

	it("a double press sends ONE answer", async () => {
		const gate: { release?: () => void } = {};
		const {
			controller,
			fake,
			clock: c,
		} = await opened({
			acceptGuardConsent: () =>
				new Promise((resolve) => {
					gate.release = () =>
						resolve({
							approval_id: APPROVAL,
							state: "granted",
							tenant: TENANT,
						});
				}),
		});
		c.advance(600);
		const first = controller.share();
		expect(await controller.share()).toBe("ignored");
		gate.release?.();
		await first;
		expect(fake.names().filter((n) => n === "acceptGuardConsent")).toHaveLength(
			1,
		);
	});
});

describe("a failed answer is reconciled with the host, not assumed", () => {
	it("the connection dropped but the host DID grant: say shared", async () => {
		let reads = 0;
		const { controller, clock: c } = await opened({
			guardStatus: () =>
				++reads === 1
					? status({ orgs: [waitingOrg()] })
					: status({ orgs: [org({ state: "sharing" })] }),
			acceptGuardConsent: () => {
				throw transport();
			},
		});
		c.advance(600);
		await controller.share();
		expect(controller.getState().outcome).toEqual({
			kind: "shared",
			org: "Example Org",
		});
	});

	it("the request is still pending: say the choice was not saved", async () => {
		const { controller, clock: c } = await opened({
			acceptGuardConsent: () => {
				throw transport();
			},
		});
		c.advance(600);
		await controller.share();
		expect(controller.getState().outcome).toEqual({
			kind: "failed",
			org: "Example Org",
		});
	});

	it("another surface answered first: say where", async () => {
		let reads = 0;
		const { controller, clock: c } = await opened({
			guardStatus: () =>
				++reads === 1
					? status({ orgs: [waitingOrg()] })
					: status({
							orgs: [org({ state: "not_sharing", answered_via: "desktop" })],
						}),
			acceptGuardConsent: () => {
				throw rejected(409, "approval_already_settled");
			},
		});
		c.advance(600);
		await controller.share();
		expect(controller.getState().outcome).toEqual({
			kind: "answered_elsewhere",
			surface: "desktop",
		});
	});

	it("the host refused a stale digest: say the request changed and re-read", async () => {
		let reads = 0;
		const { controller, clock: c } = await opened({
			guardStatus: () => {
				reads += 1;
				return status({ orgs: [waitingOrg()] });
			},
			acceptGuardConsent: () => {
				throw rejected(409, "guard_consent_expected_mismatch");
			},
		});
		c.advance(600);
		await controller.share();
		expect(controller.getState().outcome?.kind).toBe("changed");
		expect(reads).toBeGreaterThan(1);
	});
});

describe("stop sharing and share again", () => {
	it("revoke calls the host once and reports what the host confirmed", async () => {
		const fake = fakeClient({
			guardStatus: () => status(),
			guardRevoke: () => ({
				tenant: TENANT,
				status: "revoked",
				code: "",
				org: null,
			}),
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		await controller.revoke(TENANT);
		expect(fake.calls.filter((c) => c.name === "guardRevoke")).toEqual([
			{ name: "guardRevoke", args: [TENANT] },
		]);
		expect(controller.getState().outcome).toEqual({
			kind: "revoked",
			org: "Example Org",
		});
	});

	it("a revoke Radient has not confirmed is 'revoke_pending', not 'revoked'", async () => {
		const fake = fakeClient({
			guardStatus: () => status(),
			guardRevoke: () => ({
				tenant: TENANT,
				status: "revoke_pending",
				code: "guard_signed_out",
				org: null,
			}),
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		await controller.revoke(TENANT);
		expect(controller.getState().outcome?.kind).toBe("revoke_pending");
	});

	it("revoke is not sent for an org the host says cannot be stopped, or an unknown tenant", async () => {
		const fake = fakeClient({
			guardStatus: () =>
				status({ orgs: [org({ state: "not_sharing", can_revoke: false })] }),
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		await controller.revoke(TENANT);
		await controller.revoke("someone_else");
		expect(fake.names()).toEqual(["guardStatus"]);
	});

	it("a 409 'nothing to stop' is not shown as a failure", async () => {
		const fake = fakeClient({
			guardStatus: () => status(),
			guardRevoke: () => {
				throw rejected(409, "guard_not_sharing");
			},
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		await controller.revoke(TENANT);
		expect(controller.getState().outcome).toBeNull();
	});

	it("share-again is sent only where the host offers it; it grants nothing itself", async () => {
		const stopped = org({
			state: "not_sharing",
			can_revoke: false,
			can_share_again: true,
		});
		const fake = fakeClient({
			guardStatus: () => status({ orgs: [stopped] }),
			guardShareAgain: () => ({ tenant: TENANT, org: null }),
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		await controller.shareAgain(TENANT);
		expect(fake.names()).toContain("guardShareAgain");
		expect(fake.names()).not.toContain("acceptGuardConsent");
		expect(controller.getState().outcome?.kind).toBe("share_again");
	});

	it("share-again is not sent when the host says it would refuse it", async () => {
		const fake = fakeClient({
			guardStatus: () =>
				status({
					orgs: [org({ state: "not_sharing", can_share_again: false })],
				}),
		});
		const controller = createGuardController(fake.client);
		await controller.activate();
		await controller.shareAgain(TENANT);
		expect(fake.names()).toEqual(["guardStatus"]);
	});
});

describe("lifecycle", () => {
	it("an answer that lands after the screen is gone paints nothing", async () => {
		const gate: { release?: () => void } = {};
		const { controller, clock: c } = await opened({
			acceptGuardConsent: () =>
				new Promise((resolve) => {
					gate.release = () =>
						resolve({
							approval_id: APPROVAL,
							state: "granted",
							tenant: TENANT,
						});
				}),
		});
		c.advance(600);
		const pending = controller.share();
		controller.deactivate();
		const before = controller.getState().outcome;
		gate.release?.();
		await pending;
		expect(controller.getState().outcome).toBe(before);
	});

	it("an unactivated controller sends nothing", async () => {
		const fake = fakeClient({});
		const controller = createGuardController(fake.client);
		await controller.openConsent(TENANT);
		await controller.revoke(TENANT);
		await controller.shareAgain(TENANT);
		expect(fake.names()).toEqual([]);
	});
});
