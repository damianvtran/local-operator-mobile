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
		expect(controller.getState().outcome).toMatchObject({
			kind: "answered_elsewhere",
			surface: "desktop",
			// U9: the line also carries the host's row, so it can say what the
			// answer left behind for THIS org.
			org: { org: "Example Org", state: "not_sharing" },
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

describe("what a refusal means (R1-2, R1-6)", () => {
	it.each(["approval_decision_conflict", "approval_expired"])(
		"409 %s (the host kept a settled card) is 'changed', even while the status still lists a prompt",
		async (code) => {
			const { controller, clock: c } = await opened({
				acceptGuardConsent: () => {
					throw rejected(409, code);
				},
			});
			c.advance(600);
			await controller.share();
			// The status still shows the prompt (a lagging read): the member must read
			// the info-toned "changed", not "Your choice wasn't saved… try again".
			expect(controller.getState().outcome?.kind).toBe("changed");
		},
	);

	it("404 guard_unavailable on the answer is NOT 'the request changed'", async () => {
		const { controller, clock: c } = await opened({
			acceptGuardConsent: () => {
				throw rejected(404, "guard_unavailable");
			},
		});
		c.advance(600);
		await controller.share();
		expect(controller.getState().outcome?.kind).toBe("failed");
	});

	it("404 guard_unavailable on opening the card is 'unreadable' and re-reads the status", async () => {
		let reads = 0;
		const c = clock();
		const fake = fakeClient({
			guardStatus: () => {
				reads += 1;
				return status({ orgs: [waitingOrg()] });
			},
			guardConsentCard: () => {
				throw rejected(404, "guard_unavailable");
			},
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(controller.getState().outcome?.kind).toBe("card_unreadable");
		expect(reads).toBe(2);
	});

	it.each([
		[404, "approval_not_found"],
		[404, undefined],
		[410, undefined],
	])(
		"%s %s still reads as 'changed' when opening the card",
		async (status_, code) => {
			const c = clock();
			const fake = fakeClient({
				guardStatus: () => status({ orgs: [waitingOrg()] }),
				guardConsentCard: () => {
					throw rejected(status_, code);
				},
			});
			const controller = createGuardController(fake.client, c.now);
			await controller.activate();
			await controller.openConsent(TENANT);
			expect(controller.getState().outcome?.kind).toBe("changed");
		},
	);
});

describe("refresh (R1-5)", () => {
	it("re-reads the status silently and paints a request that arrived meanwhile", async () => {
		let body = status({ orgs: [org()] });
		const fake = fakeClient({ guardStatus: () => body });
		const controller = createGuardController(fake.client);
		await controller.activate();
		body = status({ orgs: [waitingOrg()] });
		await controller.refresh();
		const read = controller.getState().read;
		expect(read.kind === "ready" && read.status.orgs[0]?.prompt).not.toBeNull();
		expect(fake.names()).toEqual(["guardStatus", "guardStatus"]);
	});

	it("never fights an open card, and is a no-op before activation", async () => {
		const fake = fakeClient({
			guardStatus: () => status({ orgs: [waitingOrg()] }),
			guardConsentCard: () => card(),
		});
		const controller = createGuardController(fake.client, clock().now);
		await controller.refresh(); // not activated: no live controller, no read
		expect(fake.names()).toEqual([]);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(controller.getState().consent.phase).toBe("open");
		const before = fake.names().length;
		await controller.refresh();
		expect(fake.names().length).toBe(before);
		controller.closeConsent();
		await controller.refresh(); // closed again: it reads
		expect(fake.names().length).toBe(before + 1);
	});

	it("a refresh failure keeps the last good view", async () => {
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
		await controller.refresh();
		expect(controller.getState().read.kind).toBe("ready");
	});

	it("a non-Team refresh does not re-fetch the trial card", async () => {
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
		await controller.refresh();
		await controller.refresh();
		expect(fake.names().filter((n) => n === "guardNonTeamCard")).toHaveLength(
			1,
		);
		expect(fake.names().filter((n) => n === "guardStatus")).toHaveLength(3);
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

/* ------------------------------------------------------------------------
 * Round-2 remediation (PR #402): security S-1/S-2, UX U1/U2.
 * --------------------------------------------------------------------- */

describe("S-1: the debounce counts from an interactive sheet", () => {
	it("consentShown() restarts the 500 ms window; it only ever moves the stamp later", async () => {
		const { controller, fake, clock: c } = await opened();
		// The sheet is still rising: 400 ms after the state opened, it is shown.
		c.advance(400);
		controller.consentShown();
		// 499 ms after the open would have passed the old stamp; 300 ms after the
		// sheet settled must not.
		c.advance(300);
		expect(await controller.share()).toBe("ignored");
		expect(fake.names()).not.toContain("acceptGuardConsent");
		c.advance(200);
		expect(await controller.share()).toBe("sent");
	});

	it("consentShown() is a no-op with no open card", async () => {
		const fake = fakeClient({ guardStatus: () => status() });
		const controller = createGuardController(fake.client);
		await controller.activate();
		controller.consentShown();
		expect(controller.getState().consent.phase).toBe("closed");
	});
});

describe("S-2: a 200 is believed only when it answers THIS act", () => {
	const settledStatus = (over: Parameters<typeof org>[0] = {}) =>
		status({ orgs: [org({ answered_via: "mobile", ...over })] });
	const twoReads = (second: ReturnType<typeof status>) => {
		let reads = 0;
		return () => (++reads === 1 ? status({ orgs: [waitingOrg()] }) : second);
	};

	it("a share answered with another request's id/tenant/state is not 'shared'", async () => {
		const { controller, clock: c } = await opened({
			guardStatus: twoReads(status({ orgs: [waitingOrg()] })),
			acceptGuardConsent: () => ({
				approval_id: "req_OTHER",
				state: "denied",
				tenant: "other",
			}),
		});
		c.advance(600);
		await controller.share();
		// The host still files the request, so the phone says "not saved"
		// rather than "Sharing with Example Org".
		expect(controller.getState().outcome).toEqual({
			kind: "failed",
			org: "Example Org",
		});
	});

	it("a share answered 200 'denied' (the host's 'no live consent') is not 'shared'", async () => {
		const { controller, clock: c } = await opened({
			guardStatus: twoReads(settledStatus({ state: "not_sharing" })),
			acceptGuardConsent: () => ({
				approval_id: APPROVAL,
				state: "denied",
				tenant: TENANT,
			}),
		});
		c.advance(600);
		await controller.share();
		// The re-read is what the line is built from: not sharing.
		expect(controller.getState().outcome).toEqual({
			kind: "declined",
			org: "Example Org",
		});
	});

	it("a decline answered 200 'approved' is worded by the host's status, not the button", async () => {
		const { controller, clock: c } = await opened({
			guardStatus: twoReads(settledStatus({ state: "sharing" })),
			declineGuardConsent: () => ({
				approval_id: APPROVAL,
				state: "approved",
				tenant: TENANT,
			}),
		});
		c.advance(600);
		await controller.decline();
		expect(controller.getState().outcome).toEqual({
			kind: "shared",
			org: "Example Org",
		});
	});

	it("a matching reply is believed without waiting on a re-read", async () => {
		const { controller, clock: c } = await opened();
		c.advance(600);
		await controller.decline();
		expect(controller.getState().outcome?.kind).toBe("declined");
	});
});

describe("U1: a card another surface already answered", () => {
	it("says what the host now says, not 'changed this request'", async () => {
		let reads = 0;
		const c = clock();
		const fake = fakeClient({
			guardStatus: () =>
				++reads === 1
					? status({ orgs: [waitingOrg()] })
					: status({
							orgs: [org({ state: "sharing", answered_via: "desktop" })],
						}),
			guardConsentCard: () => card({ state: "granted", signable: false }),
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(controller.getState().consent.phase).toBe("closed");
		expect(controller.getState().outcome).toMatchObject({
			kind: "answered_elsewhere",
			surface: "desktop",
			org: { org: "Example Org", state: "sharing" },
		});
	});

	it("an answer this phone's own twin gave reads as the shared/declined line", async () => {
		let reads = 0;
		const c = clock();
		const fake = fakeClient({
			guardStatus: () =>
				++reads === 1
					? status({ orgs: [waitingOrg()] })
					: status({
							orgs: [org({ state: "sharing", answered_via: "mobile" })],
						}),
			guardConsentCard: () => card({ state: "granted", signable: false }),
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(controller.getState().outcome).toEqual({
			kind: "shared",
			org: "Example Org",
		});
	});

	it("a real new revision (another approval id) is still 'changed'", async () => {
		const c = clock();
		const fake = fakeClient({
			guardStatus: () => status({ orgs: [waitingOrg()] }),
			guardConsentCard: () =>
				card({ approval_id: "req_NEW", state: "granted" }),
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		expect(controller.getState().outcome?.kind).toBe("changed");
	});
});

describe("U2: 'Keep current' on a request to collect more keeps sharing", () => {
	const widening = card({
		reason: "widened",
		widening: true,
		asked_scopes: ["admin_share"],
	});
	const widenedOrg = (over: Parameters<typeof org>[0] = {}) =>
		org({
			state: "sharing_pending",
			prompt: {
				approval_id: APPROVAL,
				collection_rev: 8,
				reason: "widened",
				widening: true,
				asked_scopes: ["admin_share"],
				grant_scopes: ["decisions", "task_time", "admin_share"],
			},
			...over,
		});

	it("never says 'Not sharing': the host's re-read words it", async () => {
		let reads = 0;
		const c = clock();
		const fake = fakeClient({
			guardStatus: () =>
				++reads === 1
					? status({ orgs: [widenedOrg()] })
					: status({ orgs: [org({ answered_via: "mobile" })] }),
			guardConsentCard: () => widening,
			declineGuardConsent: () => ({
				approval_id: APPROVAL,
				state: "denied",
				tenant: TENANT,
			}),
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		c.advance(600);
		await controller.decline();
		const outcome = controller.getState().outcome;
		expect(outcome).toEqual({ kind: "shared", org: "Example Org" });
		expect(outcome?.kind).not.toBe("declined");
	});

	it("a widening decline whose re-read fails states nothing false", async () => {
		let reads = 0;
		const c = clock();
		const fake = fakeClient({
			guardStatus: () => {
				if (++reads === 1) return status({ orgs: [widenedOrg()] });
				throw transport();
			},
			guardConsentCard: () => widening,
			declineGuardConsent: () => ({
				approval_id: APPROVAL,
				state: "denied",
				tenant: TENANT,
			}),
		});
		const controller = createGuardController(fake.client, c.now);
		await controller.activate();
		await controller.openConsent(TENANT);
		c.advance(600);
		await controller.decline();
		expect(controller.getState().outcome).toBeNull();
	});

	it("a first request's decline is still 'Not sharing'", async () => {
		const { controller, clock: c } = await opened();
		c.advance(600);
		await controller.decline();
		expect(controller.getState().outcome?.kind).toBe("declined");
	});
});
