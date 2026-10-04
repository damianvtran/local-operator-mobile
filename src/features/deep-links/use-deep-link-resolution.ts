/**
 * The resolver: takes a held destination (a session link, or a push tap's
 * handle) and lands the reader on it — but only against a LIVE route, never
 * against a connection that does not exist yet or one that belongs to another
 * computer (ADR 0006 §6.4-6.6).
 *
 * Three rules shape everything below:
 *
 * - **Consume once, act once.** `takePendingDestination` clears before it
 *   returns, so the effect running twice (StrictMode, a re-render, a re-auth)
 *   resolves nothing the second time. This is the §6.3 contract.
 * - **Switch first, resolve after.** Resolution runs only while
 *   `phase === "live"`, and a handle's answer is dropped if the connection's
 *   `revision` moved while it was in flight — the answer belongs to the route
 *   it was asked on, and a route switch aborts the streams and projections the
 *   old computer's cache was made of (§6.5).
 * - **A bounded wait, then one honest sentence.** A destination that never
 *   reaches a live route lands on the conversations surface after
 *   `DEEP_LINK_WAIT_MS` and SAYS SO — it must not spin, and it must not
 *   silently drop the reader as if nothing happened (§6.4).
 *
 * Where the destination cannot be resolved pre-cloud (a push's `data.computer`
 * is an opaque handle the register response never maps to a route, ADR
 * :753-760), the resolver resolves the conversation handle against the
 * currently connected computer — the single-computer fallback the scoping
 * note settles on — and an unknown handle is the §6.6 sentence. The mapping
 * decision itself is owed before full push delivery and is not invented here.
 */

import { useRouter } from "expo-router";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import {
	connectionStore,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import {
	noteConversationPush,
	peekPendingDestination,
	subscribePendingDestination,
	takePendingDestination,
} from "@/features/deep-links/pending";
import {
	THIS_COMPUTER,
	unknownConversationNote,
	unreachableComputerNote,
} from "@/features/deep-links/sentences";
import { isRelayError } from "@/relay";
import { useUiStore } from "@/state/ui-store";

/**
 * How long a held destination waits for a live route before it gives up.
 *
 * Long enough for a cold start's credential read and a tunnel session's
 * minting (seconds, ADR 0002 §3); short enough that a reader is told where
 * their tap went before they conclude the app is broken. It is measured from
 * when the destination was RECORDED, not from whenever a screen happened to
 * mount — a remount must not buy a second wait.
 */
export const DEEP_LINK_WAIT_MS = 15_000;

/** The label a sentence uses for the computer: its name when the app has one,
 *  otherwise the honest placeholder. Never an opaque handle — a reader cannot
 *  act on one. */
const useComputerLabel = (): string => {
	const computers = useConnectionState((state) => state.computers);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	return useMemo(() => {
		const active = computers.find((computer) => computer.tunnelId === tunnelId);
		return active?.name ?? THIS_COMPUTER;
	}, [computers, tunnelId]);
};

export const useDeepLinkResolution = (): void => {
	const router = useRouter();
	const connect = useConnection();
	const showToast = useUiStore((state) => state.showToast);
	const phase = useConnectionState((state) => state.phase);
	const label = useComputerLabel();
	const pending = useSyncExternalStore(
		subscribePendingDestination,
		peekPendingDestination,
		peekPendingDestination,
	);

	/* The synthetic test hook the scoping note asks for: a web-target cell can
	 * feed one handle through the SAME pending-destination path a push will use,
	 * because no push exists before S7. Web-only and origin-read for the same
	 * reason as `lo-relay` (`connection-provider.tsx`): a URL can steer the
	 * harness's page and never the installed app. */
	useEffect(() => {
		if (Platform.OS !== "web" || typeof location === "undefined") return;
		const handle = new URLSearchParams(location.search).get("lo-conversation");
		if (handle === null || handle.length === 0) return;
		noteConversationPush({ conversation: handle, computer: null });
	}, []);

	/* Consume when — and only when — a route is live. */
	useEffect(() => {
		if (pending === null || phase !== "live") return;
		const destination = takePendingDestination();
		if (destination === null) return;
		if (destination.kind === "session") {
			/* The rewrite already navigated here on the way in; `navigate` is the
			 * idempotent form, so this is the repair for the cases the router could
			 * not take directly (a cold start whose navigation was superseded, a
			 * reader who moved on) rather than a second push. */
			router.navigate(`/session/${destination.sessionId}`);
			return;
		}
		const client = connect.relay();
		if (client === null) {
			showToast(unreachableComputerNote(label), "danger");
			router.replace("/");
			return;
		}
		const askedOn = connectionStore.getState().revision;
		void (async () => {
			try {
				const answer = await client.resolveConversation(destination.handle);
				if (connectionStore.getState().revision !== askedOn) return;
				router.navigate(`/session/${answer.session_id}`);
			} catch (error) {
				if (connectionStore.getState().revision !== askedOn) return;
				/* A clean 404 is §6.6's "no longer there"; anything else is the
				 * unreachable path — both land on the conversations surface, with
				 * the sentence that is true of each. */
				showToast(
					isRelayError(error) && error.status === 404
						? unknownConversationNote(label)
						: unreachableComputerNote(label),
					"danger",
				);
				router.replace("/");
			}
		})();
	}, [pending, phase, connect, router, showToast, label]);

	/* The bounded wait: a destination that never reaches a live route. */
	useEffect(() => {
		if (pending === null || phase === "live") return;
		const due = Math.max(0, pending.at + DEEP_LINK_WAIT_MS - Date.now());
		const timer = setTimeout(() => {
			const destination = takePendingDestination();
			if (destination === null) return;
			showToast(unreachableComputerNote(label), "danger");
			router.replace("/");
		}, due);
		return () => clearTimeout(timer);
	}, [pending, phase, router, showToast, label]);
};
