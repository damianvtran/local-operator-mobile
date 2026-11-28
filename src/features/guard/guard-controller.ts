/**
 * Radient Guard's view state and its five acts, for ONE immutable relay client.
 *
 * What this owns, and what it refuses to. The phone never talks to Radient's
 * `/v1/guard/*` and never grants: it reads the HOST's account of the state
 * (`GET /api/guard`), opens the host's queued consent card, and relays the
 * member's answer to the host, which re-checks the digests, signs with its own
 * key and sends the one grant (RFC §5.2). So the answer this module sends is
 * `{request_digest, disclosure_digest}` read from the card the member saw, or a
 * bare decline — never a scope, a tenant or a signature, and there is no code
 * path that can send "yes" without a card that was read, was `signable`, and was
 * drawn for longer than the debounce.
 *
 * Rules, each one a defect another screen has already had:
 *
 *  1. **The latest read wins.** Every status read takes a ticket and only its
 *     holder may set state, so a slow answer can never paint over a newer one or
 *     over the result of a write.
 *  2. **An answer that fails is reconciled, not assumed.** A dropped connection
 *     after the host signed looks exactly like a refusal; so every failure
 *     re-reads the status and reports what the HOST now says (granted, declined,
 *     answered elsewhere) instead of "nothing changed".
 *  3. **Deciding later is not an answer.** Closing the card sends nothing and
 *     leaves the request pending (RFC §5.2.3: Esc = Decide later).
 *  4. **One write at a time.** `busy` holds the whole surface, so a double tap
 *     cannot send a second revoke or a second answer.
 *  5. **No notification, ever.** Nothing here schedules or requests a local or
 *     push notification; the request is surfaced only by the inbox row and the
 *     Settings section (RFC §5.2.3, "sends no push"). `guard-no-push.test.ts`
 *     pins that for this feature's source.
 */

import { createStore } from "zustand/vanilla";

import { isRelayError, isRelayMissing, type RelayEndpoints } from "@/relay";
import {
	CONSENT_DEBOUNCE_MS,
	consentView,
	type GuardConsentCard,
	type GuardNonTeamCard,
	type GuardOrg,
	type GuardOutcome,
	type GuardStatus,
} from "./guard-model";

type Client = Pick<
	RelayEndpoints,
	| "guardStatus"
	| "guardNonTeamCard"
	| "guardRevoke"
	| "guardShareAgain"
	| "guardConsentCard"
	| "acceptGuardConsent"
	| "declineGuardConsent"
>;

export type GuardRead =
	| { kind: "loading" }
	| { kind: "ready"; status: GuardStatus; card: GuardNonTeamCard | null }
	/** The host does not offer Guard to the phone (older Local Operator): a calm
	 *  state, not an error and not a statement about sharing. */
	| { kind: "unsupported" }
	| { kind: "error" };

export type GuardConsent =
	| { phase: "closed" }
	| { phase: "reading"; tenant: string }
	| {
			phase: "open";
			tenant: string;
			card: GuardConsentCard;
			/** When the card became INTERACTIVE, for the 500 ms input debounce. Stamped
			 *  when the state opens (so a caller that never reports the sheet shown
			 *  still gets a debounce) and RE-stamped by `consentShown()` once the
			 *  sheet has finished rising: the member must see a settled card for the
			 *  full window, not a card still sliding up (security S-1, PR #402). */
			openedAt: number;
	  }
	| {
			phase: "answering";
			tenant: string;
			card: GuardConsentCard;
			answer: "share" | "decline";
	  };

export interface GuardState {
	read: GuardRead;
	consent: GuardConsent;
	/** The tenant a write is in flight for. */
	busy: string | null;
	outcome: GuardOutcome;
}

/** Codes the host answers when the card on disk is no longer the card the member
 *  read (newer revision, already answered, expired, digest mismatch): the request
 *  changed or was answered, so the right move is re-reading, not "try again".
 *  `approval_decision_conflict` / `approval_expired` are the host's own answers
 *  for a card that was already settled (L2d `docs/design/guard-relay-twin.md`
 *  §1: the card is kept with a non-`requested` state and a repeat answer is a
 *  409), so a second device answering first reads as "changed", not "failed". */
const CHANGED_CODES: ReadonlySet<string> = new Set([
	"guard_consent_expected_mismatch",
	"guard_consent_payload_invalid",
	"credential_operation_mismatch",
	"approval_not_pending",
	"approval_already_settled",
	"approval_decision_conflict",
	"approval_expired",
	"approval_not_found",
]);

/** The host's "Guard is not available here" (non-Team account, or no org has
 *  turned it on): a 404 on every write and consent route that is NOT about the
 *  card. It must never be read as "the request changed". */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
	"guard_unavailable",
	"guard_not_applicable",
	"guard_org_unknown",
]);

const isUnavailable = (error: unknown): boolean =>
	isRelayError(error) &&
	error.status === 404 &&
	error.code !== undefined &&
	UNAVAILABLE_CODES.has(error.code);

/** A 404/410 with no code (an older host or a plain route miss) still means the
 *  card is gone; a 404 that NAMES a Guard-unavailable code does not. */
const isChanged = (error: unknown): boolean =>
	isRelayError(error) &&
	!isUnavailable(error) &&
	(error.status === 404 ||
		error.status === 410 ||
		(error.code !== undefined && CHANGED_CODES.has(error.code)));

/** A request to collect MORE than is already agreed, on the card the member read
 *  (the same predicate `consentView` uses for "Keep current"). */
const isWidening = (card: GuardConsentCard): boolean =>
	card.widening || card.reason === "widened";

/** Does the host's 200 describe THIS answer? The act's own card id and tenant,
 *  and the state the L2d contract returns for that verb (accept → "granted",
 *  decline → "denied", `docs/guard.md` relay table). */
const confirms = (
	reply: { approval_id: string; tenant: string; state: string },
	kind: "share" | "decline",
	card: GuardConsentCard,
): boolean =>
	reply.approval_id === card.approval_id &&
	reply.tenant === card.tenant &&
	reply.state === (kind === "share" ? "granted" : "denied");

/** Re-read cadence while a Guard surface is open and focused. The status read is
 *  a LOCAL host read (the host's own account of Guard; no Radient call), so the
 *  cost is one small relay GET per period, and only while the app is in the
 *  foreground, the screen is focused and the host advertises `features.guard`.
 *  20 s matches the other relay-served screens that cannot be pushed to (the
 *  reply thread's `POLL_MS`); it is a latency trade for "a request that lands
 *  while the screen is open shows up", not a cap on a measured quantity. */
export const GUARD_REFRESH_MS = 20_000;

export function createGuardController(
	client: Client,
	now = () => Date.now(),
	{ readCard = true }: { readCard?: boolean } = {},
) {
	let active = false;
	let generation = 0;
	const store = createStore<GuardState>(() => ({
		read: { kind: "loading" },
		consent: { phase: "closed" },
		busy: null,
		outcome: null,
	}));
	const owns = (ticket: number) => active && generation === ticket;

	const orgOf = (tenant: string): GuardOrg | undefined => {
		const read = store.getState().read;
		return read.kind === "ready"
			? read.status.orgs.find((org) => org.tenant === tenant)
			: undefined;
	};

	/** One status read (and, for a non-Team account, the card's trial length).
	 *  `silent` keeps the current view while it runs, so a refresh after a write
	 *  never flashes the skeleton. Resolves to the status it painted, or null. */
	const reload = async ({
		silent = false,
	} = {}): Promise<GuardStatus | null> => {
		if (!active) return null;
		const ticket = ++generation;
		if (!silent) store.setState({ read: { kind: "loading" } });
		try {
			const status = await client.guardStatus();
			let card: GuardNonTeamCard | null = null;
			// The card read is the host's ONE network call in this family (the team
			// trial's eligibility, never a Guard route), and only a non-Team account
			// ever makes it: a Team account's Settings is a pure local read.
			// `readCard: false` is the inbox: it has no use for the trial length and
			// must not cost a non-Team account a network read it never shows.
			if (readCard && status.mode === "non_team") {
				// A silent re-read (the foreground/interval refresh) reuses the card
				// it already has: the trial length does not change under a member and
				// re-fetching it every period would put a Radient round trip on a
				// timer for a non-Team account.
				const before = store.getState().read;
				card =
					silent && before.kind === "ready" && before.card !== null
						? before.card
						: await client.guardNonTeamCard().catch(() => null);
			}
			if (!owns(ticket)) return null;
			store.setState({ read: { kind: "ready", status, card } });
			return status;
		} catch (error) {
			if (!owns(ticket)) return null;
			// A silent refresh that fails keeps the last good view; only a first
			// read (or a deliberate reload) is allowed to replace it with an error.
			if (silent && store.getState().read.kind === "ready") return null;
			store.setState({
				read: { kind: isRelayMissing(error) ? "unsupported" : "error" },
			});
			return null;
		}
	};

	/** The foreground/interval refresh: a silent re-read, skipped whenever it
	 *  could only fight something already in flight — the first read, a write, or
	 *  an open consent card (re-painting under a member who is reading the card
	 *  buys nothing; the answer re-reads when it settles). */
	const refresh = async (): Promise<void> => {
		const state = store.getState();
		if (!active || state.read.kind === "loading") return;
		if (state.busy !== null || state.consent.phase !== "closed") return;
		await reload({ silent: true });
	};

	/** After a failed write: ask the host what is true now and say THAT. */
	const reconcile = async (
		tenant: string,
		fallback: GuardOutcome,
		fallbackOrg: string,
	): Promise<void> => {
		const status = await reload({ silent: true });
		const org = status?.orgs.find((row) => row.tenant === tenant);
		if (org === undefined || org.prompt !== null) {
			store.setState({ outcome: fallback });
			return;
		}
		// The request is gone: someone answered it. Name the surface the host says.
		if (org.answered_via !== "" && org.answered_via !== "mobile") {
			// Say which org and what the host now says about sharing, not just who
			// answered (UX U9): "Answered on the desktop app" alone leaves the
			// member guessing whether they are now sharing.
			store.setState({
				outcome: {
					kind: "answered_elsewhere",
					surface: org.answered_via,
					org,
				},
			});
			return;
		}
		store.setState({
			outcome:
				org.state === "sharing" || org.state === "sharing_pending"
					? { kind: "shared", org: fallbackOrg }
					: { kind: "declined", org: fallbackOrg },
		});
	};

	const openConsent = async (tenant: string): Promise<void> => {
		const org = orgOf(tenant);
		const approvalId = org?.prompt?.approval_id ?? null;
		if (!active || org === undefined || approvalId === null) return;
		if (store.getState().busy !== null) return;
		store.setState({ consent: { phase: "reading", tenant }, outcome: null });
		try {
			const card = await client.guardConsentCard(approvalId);
			if (!active) return;
			// The card must be the one the status named, for this org: anything else
			// is a stale pointer and the request really did change.
			if (card.approval_id !== approvalId || card.tenant !== tenant) {
				store.setState({
					consent: { phase: "closed" },
					outcome: { kind: "changed", org: org.org },
				});
				void reload({ silent: true });
				return;
			}
			// The SAME card, already settled (another surface answered between the
			// last status read and this press): nothing changed and there is no new
			// request to look for, so ask the host what is true now and say THAT
			// ("Answered on the desktop app", shared, declined), exactly as a failed
			// answer does (UX U1, PR #402). `changed` stays the fallback if the host
			// still files a prompt for this org.
			if (card.state !== "requested") {
				store.setState({ consent: { phase: "closed" } });
				await reconcile(tenant, { kind: "changed", org: org.org }, org.org);
				return;
			}
			store.setState({
				consent: { phase: "open", tenant, card, openedAt: now() },
			});
		} catch (error) {
			if (!active) return;
			store.setState({
				consent: { phase: "closed" },
				outcome: isChanged(error)
					? { kind: "changed", org: org.org }
					: { kind: "card_unreadable", org: org.org },
			});
			// Changed or unavailable: either way the status is stale, so re-read it
			// (an unavailable host then reads as `unavailable`, not as a card error).
			if (isChanged(error) || isUnavailable(error))
				void reload({ silent: true });
		}
	};

	/** The sheet has finished rising and is interactive: (re)start the 500 ms
	 *  debounce from NOW. The rise (`DURATIONS.slow`) is spent before the member
	 *  can read, so counting from the state change left ~260 ms of settled card
	 *  (RFC §5.2.3 says "within 500 ms of the card rendering"). Only ever moves
	 *  the stamp later; a no-op for any other phase. */
	const consentShown = () => {
		const consent = store.getState().consent;
		if (consent.phase !== "open") return;
		store.setState({ consent: { ...consent, openedAt: now() } });
	};

	/** "Decide later": close the card and send NOTHING. The request stays pending
	 *  on the host and in the inbox. */
	const closeConsent = () => {
		const consent = store.getState().consent;
		if (consent.phase === "answering") return; // an answer is in flight
		store.setState({ consent: { phase: "closed" } });
	};

	const answer = async (
		kind: "share" | "decline",
	): Promise<"sent" | "ignored" | "refused"> => {
		const state = store.getState();
		const consent = state.consent;
		if (!active || consent.phase !== "open" || state.busy !== null)
			return "ignored";
		// RFC §5.2.3: input within 500 ms of the card rendering is ignored.
		if (now() - consent.openedAt < CONSENT_DEBOUNCE_MS) return "ignored";
		// A "yes" needs a card the host would sign and the phone can describe in
		// full; without that the buttons are withheld and a stray call is refused.
		if (kind === "share" && !consentView(consent.card).answerable)
			return "refused";
		const { tenant, card } = consent;
		const orgName = card.org;
		store.setState({
			consent: { phase: "answering", tenant, card, answer: kind },
			busy: tenant,
		});
		try {
			const reply =
				kind === "share"
					? await client.acceptGuardConsent(card.approval_id, {
							request_digest: card.request_digest,
							disclosure_digest: card.disclosure_digest,
						})
					: await client.declineGuardConsent(card.approval_id);
			if (!active) return "sent";
			// A 200 is only believed when it is the answer to THIS card for THIS org
			// and says what the act should leave behind ("granted" for a share,
			// "denied" for a decline). A replayed, crossed or surprising reply is a
			// bug or a hostile relay: the banner must not state the phone's intent,
			// so the host's own status words it (security S-2, PR #402).
			if (!confirms(reply, kind, card)) {
				store.setState({ consent: { phase: "closed" }, busy: null });
				await reconcile(tenant, { kind: "failed", org: orgName }, orgName);
				return "sent";
			}
			store.setState({ consent: { phase: "closed" }, busy: null });
			if (kind === "decline" && isWidening(card)) {
				// "Keep current" on a request to COLLECT MORE does not stop sharing:
				// the host keeps what was already agreed (UX U2). Never say "Not
				// sharing"; let the re-read paint the real indicator.
				store.setState({ outcome: null });
				await reconcile(tenant, null, orgName);
				return "sent";
			}
			store.setState({
				outcome: {
					kind: kind === "share" ? "shared" : "declined",
					org: orgName,
				},
			});
			void reload({ silent: true });
			return "sent";
		} catch (error) {
			if (!active) return "sent";
			store.setState({ consent: { phase: "closed" }, busy: null });
			await reconcile(
				tenant,
				isChanged(error)
					? { kind: "changed", org: orgName }
					: { kind: "failed", org: orgName },
				orgName,
			);
			return "sent";
		}
	};

	const revoke = async (tenant: string): Promise<void> => {
		const org = orgOf(tenant);
		if (!active || org === undefined || !org.can_revoke) return;
		if (store.getState().busy !== null) return;
		store.setState({ busy: tenant, outcome: null });
		try {
			const result = await client.guardRevoke(tenant);
			if (!active) return;
			store.setState({
				busy: null,
				outcome: {
					kind: result.status === "revoked" ? "revoked" : "revoke_pending",
					org: org.org,
				},
			});
		} catch (error) {
			if (!active) return;
			store.setState({
				busy: null,
				// 409 "nothing to stop" means it already stopped: re-read and say so
				// through the indicator rather than a failure sentence.
				outcome:
					isRelayError(error) && error.status === 409
						? null
						: { kind: "failed", org: org.org },
			});
		}
		void reload({ silent: true });
	};

	const shareAgain = async (tenant: string): Promise<void> => {
		const org = orgOf(tenant);
		if (!active || org === undefined || !org.can_share_again) return;
		if (store.getState().busy !== null) return;
		store.setState({ busy: tenant, outcome: null });
		try {
			await client.guardShareAgain(tenant);
			if (!active) return;
			store.setState({
				busy: null,
				outcome: { kind: "share_again", org: org.org },
			});
		} catch {
			if (!active) return;
			store.setState({ busy: null, outcome: { kind: "failed", org: org.org } });
		}
		void reload({ silent: true });
	};

	return Object.assign(store, {
		activate: () => {
			active = true;
			return reload();
		},
		deactivate: () => {
			active = false;
			generation += 1;
		},
		reload,
		refresh,
		openConsent,
		consentShown,
		closeConsent,
		share: () => answer("share"),
		decline: () => answer("decline"),
		revoke,
		shareAgain,
		dismissOutcome: () => store.setState({ outcome: null }),
	});
}

export type GuardController = ReturnType<typeof createGuardController>;
