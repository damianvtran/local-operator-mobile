import { useCallback, useEffect, useMemo, useState } from "react";

import type { Capabilities } from "@/contracts";
import { type ForComputer, heldOn } from "@/features/home/home-defaults";
import {
	type IdentityRoster,
	identityRoster,
	noteStartTargetSupport,
	pushRecent,
	recentsFrom,
	recentsKey,
	resolveStartTarget,
	type StartTarget,
	type StartTargetSupport,
	startTargetSupport,
	startTargetsOffered,
} from "@/features/home/start-targets";
import { t } from "@/i18n";
import type { RelayEndpoints, StartSessionRequest } from "@/relay/endpoints";
import { preferenceStore } from "@/state/preferences";

/**
 * The home's agent/team state: the relay's licence, the reader's choice, the
 * roster behind the sheet, and the recents — everything the identity pill, the
 * More row and the "Start this chat with" sheet read.
 *
 * WHY A HOOK. `home.tsx` already holds three pickers' worth of per-computer
 * state with careful ordering rules; the target follows the SAME rules (tagged
 * per computer with `ForComputer`, committed through `homeStartSelection`), and
 * keeping its reads here keeps that file's effects about folders and models.
 * The decisions themselves are pure and tested in `start-targets.ts`.
 */
export function useStartTarget(input: {
	/** The computer this home is on (`null` = a custom route). */
	computer: string | null;
	client: RelayEndpoints | null;
	capabilities: Capabilities | null;
	/** `liveFrameAt` from the list store: `null` until THIS daemon has spoken.
	 *  A warm-cache paint restores capabilities from disk, and those are the last
	 *  session's — never a licence to put a field on the wire. */
	liveFrameAt: number | null;
	/** The sheet is open: the roster is read lazily, on first open (spec §7). */
	sheetOpen: boolean;
}) {
	const { computer, client, capabilities, liveFrameAt, sheetOpen } = input;
	/** What the relay licenses as a cached frame says: enough to SHOW the pill.
	 *  The wire uses `support` (live only), below. */
	const shown = useMemo(() => startTargetSupport(capabilities), [capabilities]);
	const support: StartTargetSupport | null =
		liveFrameAt !== null ? shown : null;
	const offered = startTargetsOffered(shown);

	/* Publish the LIVE licence to the start gate (`gatedStart`), which is the
	 *  one path a start body leaves by — including a restored record replayed
	 *  before this screen renders. */
	useEffect(() => {
		if (client === null) return;
		noteStartTargetSupport(client, support);
	}, [client, support]);

	/** The reader's pick on a computer; `null` before any pick in this mount.
	 *  Tagged so a pick on computer A reads as nothing on B in the very render
	 *  the switch lands in (D-S19), the folder state's R2-1 rule. */
	const [choice, setChoice] = useState<ForComputer<StartTarget | null> | null>(
		null,
	);
	const pickedHere = choice !== null && choice.computer === computer;

	const [roster, setRoster] = useState<ForComputer<IdentityRoster> | null>(
		null,
	);
	const [rosterFailed, setRosterFailed] = useState<ForComputer<true> | null>(
		null,
	);
	const [attempt, setAttempt] = useState(0);
	const [settled, setSettled] = useState(0);
	const heldRoster = heldOn(roster, computer);
	const failed = heldOn(rosterFailed, computer) !== null;

	/**
	 * The target the home starts as — or, once the start has landed (`fixed`),
	 * the one the conversation IS bound to: `resolveStartTarget` holds the rule
	 * (PR #358 U1/D1). Labelled and pictured from the roster when the roster has
	 * the row, since a record carries only the wire name. A function of the
	 * record because the record is the coordinator's, read by the screen AFTER
	 * this hook feeds `useStartup`.
	 */
	const resolve = (
		recordSelection: StartSessionRequest | null,
		fixed: boolean,
	) => {
		const chosen = resolveStartTarget({
			picked: pickedHere ? choice.value : undefined,
			record: recordSelection,
			fixed,
			roster: heldRoster,
		});
		const row =
			chosen === null || heldRoster === null
				? undefined
				: (chosen.kind === "team" ? heldRoster.teams : heldRoster.agents).find(
						(candidate) => candidate.name === chosen.name,
					);
		return {
			chosen,
			avatar:
				row?.agentId && row.avatarSha256
					? { agentId: row.agentId, avatarSha256: row.avatarSha256 }
					: null,
			label: chosen?.label ?? t("mobile.home.identity.default_agent"),
		};
	};

	/* Lazy, cached per computer: read on the first open, on Retry, and after a
	 *  refusal invalidates it. A degraded answer is a FAILURE to say so, not an
	 *  empty roster ("you have none" would be false). */
	const needsRead =
		sheetOpen &&
		client !== null &&
		startTargetsOffered(support) &&
		(heldRoster === null || heldRoster.degraded || attempt !== settled);
	useEffect(() => {
		if (!needsRead || client === null) return;
		let live = true;
		const asked = attempt;
		void client
			.startTargets()
			.then((read) => {
				if (!live) return;
				setRoster({ computer, value: identityRoster(read) });
				setRosterFailed(read.degraded ? { computer, value: true } : null);
			})
			.catch(() => {
				if (!live) return;
				setRosterFailed({ computer, value: true });
			})
			.finally(() => {
				if (live) setSettled(asked);
			});
		return () => {
			live = false;
		};
	}, [needsRead, client, computer, attempt]);

	const [recents, setRecents] = useState<ForComputer<StartTarget[]> | null>(
		null,
	);
	useEffect(() => {
		let live = true;
		void preferenceStore
			.get(recentsKey(computer))
			.then((raw) => {
				if (live) setRecents({ computer, value: recentsFrom(raw) });
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [computer]);

	/** Record a pick (or a clear back to Default). Recents remember only real
	 *  targets, per computer, best-effort: a failed write costs a shortcut. */
	const choose = useCallback(
		(target: StartTarget | null) => {
			setChoice({ computer, value: target });
			if (target === null) return;
			setRecents((held) => {
				const next = pushRecent(heldOn(held, computer) ?? [], target);
				void preferenceStore
					.set(recentsKey(computer), JSON.stringify(next))
					.catch(() => undefined);
				return { computer, value: next };
			});
		},
		[computer],
	);

	/** Back to Default for the NEXT draft (New chat, or the home returning to
	 *  a fresh draft after an adopted conversation — D-S18). */
	const reset = useCallback(() => {
		setChoice({ computer, value: null });
	}, [computer]);

	/** A refused start re-reads the roster on the next open (D-S20): the name
	 *  it refused may have been removed on the computer. */
	const invalidate = useCallback(() => setAttempt((value) => value + 1), []);

	return {
		/** Live licence (wire); `null` until this daemon's frame arrived. */
		support,
		/** The pill may show (some kind licensed, cached frames count). */
		offered,
		/** The More row shows when offered, or once a LIVE frame says this relay
		 *  is too old — it then explains (D-S15). Unknown hides it. */
		moreRow: offered || liveFrameAt !== null,
		/** The pick made on this computer in this mount; `undefined` = none,
		 *  so the live selection (a fresh record's) names no target. */
		picked: pickedHere ? choice.value : undefined,
		resolve,
		choose,
		reset,
		invalidate,
		roster: heldRoster,
		loading: heldRoster === null && !failed,
		failure: failed ? t("mobile.home.identity.read_failed") : null,
		retry: () => setAttempt((value) => value + 1),
		retrying: attempt !== settled,
		recents: heldOn(recents, computer) ?? [],
	};
}
