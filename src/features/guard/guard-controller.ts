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
			/** When the card finished rendering, for the 500 ms input debounce. */
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
 *  read (newer revision, already answered, digest mismatch): the request changed
 *  or was answered, so the right move is re-reading, not "try again". */
const CHANGED_CODES: ReadonlySet<string> = new Set([
	"guard_consent_expected_mismatch",
	"guard_consent_payload_invalid",
	"credential_operation_mismatch",
	"approval_not_pending",
	"approval_already_settled",
]);

const isChanged = (error: unknown): boolean =>
	isRelayError(error) &&
	(error.status === 404 ||
		error.status === 410 ||
		(error.code !== undefined && CHANGED_CODES.has(error.code)));

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
				card = await client.guardNonTeamCard().catch(() => null);
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
			store.setState({
				outcome: { kind: "answered_elsewhere", surface: org.answered_via },
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
			// The card must be the one the status named, for this org, and still
			// waiting for an answer: anything else is a stale pointer.
			if (
				card.approval_id !== approvalId ||
				card.tenant !== tenant ||
				card.state !== "requested"
			) {
				store.setState({
					consent: { phase: "closed" },
					outcome: { kind: "changed", org: org.org },
				});
				void reload({ silent: true });
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
			if (isChanged(error)) void reload({ silent: true });
		}
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
			if (kind === "share") {
				await client.acceptGuardConsent(card.approval_id, {
					request_digest: card.request_digest,
					disclosure_digest: card.disclosure_digest,
				});
			} else {
				await client.declineGuardConsent(card.approval_id);
			}
			if (!active) return "sent";
			store.setState({
				consent: { phase: "closed" },
				busy: null,
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
		openConsent,
		closeConsent,
		share: () => answer("share"),
		decline: () => answer("decline"),
		revoke,
		shareAgain,
		dismissOutcome: () => store.setState({ outcome: null }),
	});
}

export type GuardController = ReturnType<typeof createGuardController>;
