import { describe, expect, it } from "vitest";

import type { RadientTokens, TunnelSession } from "@/connection";
import {
	oauthSetFromTokens,
	sessionFromTunnelSet,
	tokensFromOauthSet,
	tunnelSetFromSession,
} from "@/connection";

import { adoptableSession, planRestore } from "./radient-restore";

/**
 * The cold start's decisions, and the record round trip they depend on.
 *
 * R3-3's failure modes are all SILENT in a diff — a restore that trusts a stale token
 * behaves exactly like one that verified it until the first refused request — so they
 * are pinned here by value rather than left to a comment. The hand-off itself, and the
 * live control-plane calls, cannot be exercised without a device and a Radient account;
 * what CAN be is every branch this file decides, and the two conversions that would
 * otherwise be the place a field name drifts.
 */

const NOW = 1_800_000_000_000;

const tokens = (over: Partial<RadientTokens> = {}): RadientTokens => ({
	access: "access-token",
	refresh: "refresh-token",
	expires_at: NOW + 60_000,
	account_label: "damian",
	scope: "openid profile email offline_access",
	token_type: "Bearer",
	...over,
});

const session = (over: Partial<TunnelSession> = {}): TunnelSession => ({
	grant: "grant",
	grantExpiresAt: NOW + 300_000,
	refreshHandle: "handle",
	refreshExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
	hostname: "abc-lop.example.invalid",
	tunnelId: "tunnel-1",
	mintedAt: NOW,
	...over,
});

const machine = { tunnelId: "tunnel-1", hostname: "abc-lop.example.invalid" };

describe("what a cold start does with a stored grant", () => {
	it("is a first run when nothing is stored", () => {
		expect(planRestore(null, NOW)).toEqual({ kind: "none" });
	});

	it("adopts a grant that is still good", () => {
		const stored = tokens();
		// `expires_at` already carries the skew, so "in the future" IS "usable".
		expect(planRestore(stored, NOW)).toEqual({ kind: "adopt", tokens: stored });
	});

	it("refreshes a lapsed grant that has a rolling token", () => {
		// Expired an hour ago: the access token is dead, the refresh token is not.
		const stored = tokens({ expires_at: NOW - 3_600_000 });
		expect(planRestore(stored, NOW)).toEqual({
			kind: "refresh",
			tokens: stored,
		});
	});

	it("discards a lapsed grant that has nothing to renew it", () => {
		// No refresh token: only a browser hand-off can get another grant, so the
		// record must go rather than be retried on every launch.
		expect(
			planRestore(tokens({ expires_at: NOW - 1, refresh: null }), NOW),
		).toEqual({ kind: "discard" });
	});

	it("treats the expiry boundary as expired, matching the layer's own check", () => {
		// One arithmetic, in `accessTokenNeedsRefresh`: exactly-at-the-boundary is
		// expired, and this must not disagree with the connection layer about it.
		expect(planRestore(tokens({ expires_at: NOW }), NOW)).toEqual({
			kind: "refresh",
			tokens: tokens({ expires_at: NOW }),
		});
	});
});

describe("what a cold start does with a stored tunnel session", () => {
	it("adopts a session for this computer whose handle is alive", () => {
		const stored = session();
		expect(adoptableSession(stored, machine, NOW)).toBe(stored);
	});

	it("refuses a session whose handle is past its absolute life", () => {
		// Past the 30-day handle: only a fresh sign-in plus a re-mint can help, and
		// adopting it would put a 401 in front of the reader instead of a sign-in.
		const stored = session({ refreshExpiresAt: NOW - 1 });
		expect(adoptableSession(stored, machine, NOW)).toBeNull();
	});

	it("refuses a session minted for another computer", () => {
		// Both names, because the pair is the computer: adopting a session for a
		// different tunnel would authenticate against the wrong machine.
		expect(
			adoptableSession(session({ tunnelId: "tunnel-2" }), machine, NOW),
		).toBeNull();
		expect(
			adoptableSession(
				session({ hostname: "other-lop.example.invalid" }),
				machine,
				NOW,
			),
		).toBeNull();
	});

	it("adopts nothing when nothing is stored", () => {
		expect(adoptableSession(null, machine, NOW)).toBeNull();
	});

	it("a live grant is not enough if the handle is gone", () => {
		// The two expiries are independent facts: a freshly refreshed grant says
		// nothing about the 30-day handle's life.
		const stored = session({
			grantExpiresAt: NOW + 300_000,
			refreshExpiresAt: NOW,
		});
		expect(adoptableSession(stored, machine, NOW)).toBeNull();
	});
});

describe("the stored record round trip", () => {
	it("keeps every field of a grant, including the one whose absence signs a reader out", () => {
		// `refresh` is the field a lossy conversion would drop, and dropping it turns
		// the next launch into a browser hand-off.
		const original = tokens();
		expect(tokensFromOauthSet(oauthSetFromTokens(original))).toEqual(original);
	});

	it("keeps every field of a tunnel session", () => {
		const original = session();
		expect(sessionFromTunnelSet(tunnelSetFromSession(original))).toEqual(
			original,
		);
	});

	it("round-trips a null refresh token rather than inventing one", () => {
		const original = tokens({ refresh: null });
		expect(tokensFromOauthSet(oauthSetFromTokens(original)).refresh).toBeNull();
	});
});
