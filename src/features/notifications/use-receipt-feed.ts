import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { NotificationSeenRequest } from "@/relay";

import {
	type InboxToken,
	ReadReceiptTracker,
	reviewToken,
} from "./notifications-read-receipts";

/** How often the feed asks the tracker whether anything is due. The dwell is a
 *  second, so a 500 ms tick bounds the delay at half of it without a timer per
 *  row. */
export const RECEIPT_CHECK_MS = 500;

/** The 50 % visibility rule the doctrine uses, as the platform's own config. */
export const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 } as const;

/** What `onViewableItemsChanged` hands a list. Structural, so the app's list and
 *  a test can both produce it. */
export interface ViewableInfo<T> {
	viewableItems: Array<{ item?: T | null } | null | undefined>;
}

/**
 * The inbox's read-receipt feed, as an object with no React in it.
 *
 * WHY THIS IS NOT A CALLBACK INSIDE THE SCREEN. Round 1 shipped with the tracker
 * wired to a callback nothing attached: `onViewable` was defined and never
 * passed to a list, so `rendered` stayed empty, `due()` always answered `[]`, and
 * the evidenced read path was dead on both platforms while an unevidenced mount
 * read was the only write that reached the relay (code review B1 / QA Q1). The
 * wiring is the feature here, so it lives in one small object that both the list
 * and the pushed detail drive — and that a node test can drive without a DOM:
 *
 *     const feed = createReceiptFeed({ send: … });
 *     feed.render([row], t0);      // the row is on screen
 *     feed.noteInput(t0 + 10);     // a real touch arrived after it rendered
 *     feed.tick(t0 + 1_100);       // → exactly one `seen` for that id+revision
 *
 * Everything the tracker refuses stays refused here: no foreground, no focus, a
 * dialog over the list, no gesture, or a gesture older than the row — no send.
 */
export function createReceiptFeed(options: {
	send: (
		targets: InboxToken[],
		evidence: NotificationSeenRequest["evidence"],
	) => Promise<{ ok: boolean; changed: string[] }>;
}) {
	const tracker = new ReadReceiptTracker();
	let inFlight = false;
	const feed = {
		tracker,
		/** Which rows the platform says are on screen, and when. */
		render(items: ReadonlyArray<InboxToken>, nowMs: number): void {
			tracker.render(items, nowMs);
		},
		/** A viewability answer, in the shape a list hands over.
		 *
		 *  `nowMs` is injectable because the dwell is measured from it: the app
		 *  passes the platform's clock, and a test passes its own rather than
		 *  sleeping a second. */
		viewable(info: ViewableInfo<InboxToken>, nowMs: number = Date.now()): void {
			const visible: InboxToken[] = [];
			for (const entry of info.viewableItems) {
				const item = entry?.item;
				if (item === undefined || item === null) continue;
				if (typeof item.id !== "string") continue;
				visible.push({ id: item.id, revision: item.revision });
			}
			tracker.render(visible, nowMs);
		},
		noteInput(kind: "touch" | "press" | "scroll" | "focus", nowMs: number) {
			tracker.noteInput(nowMs, kind);
		},
		setAppActive(active: boolean): void {
			tracker.setAppActive(active);
		},
		setFocused(focused: boolean): void {
			tracker.setScreenFocused(focused);
		},
		setCovered(covered: boolean): void {
			tracker.setCovered(covered);
		},
		resetView(): void {
			tracker.resetView();
		},
		/**
		 * One check. Returns the tokens it sent, so a caller (and a test) can see
		 * that a tick with no fresh gesture sends nothing.
		 *
		 * `visibleSince` is the NEWEST render stamp in the batch: the row that
		 * arrived last is the one that bounds "on screen since", which is what the
		 * relay's evidence field means (round 1 sent the send-time clock, so every
		 * row claimed to have appeared at the moment of the write — code review
		 * m2).
		 */
		async tick(nowMs: number): Promise<InboxToken[]> {
			if (inFlight) return [];
			const targets = tracker.due(nowMs);
			if (targets.length === 0) return [];
			const evidence = tracker.evidence(nowMs);
			if (evidence === null) return [];
			const visibleSince = Math.max(
				...targets.map(
					(target) => tracker.renderedAt(reviewToken(target)) ?? nowMs,
				),
			);
			inFlight = true;
			try {
				const outcome = await options.send(targets, {
					surface: "native",
					input_kind: evidence.input_kind,
					input_at_ms: evidence.input_at_ms,
					visible_since_ms: visibleSince,
				});
				if (!outcome.ok) return [];
				/* `changed` holds plain IDs (the relay's shape), while the tracker
				 *  keys by `<id>@<revision>`. Comparing them directly is how a settled
				 *  row gets re-sent on every tick, so the mapping is by id here and the
				 *  token is taken from the target itself. */
				const accepted = new Set(outcome.changed);
				tracker.settle(targets.filter((target) => accepted.has(target.id)));
				return targets;
			} finally {
				inFlight = false;
			}
		},
	};
	return feed;
}

export type ReceiptFeed = ReturnType<typeof createReceiptFeed>;

/**
 * The React side: owns the feed, wires the platform context (foreground, route
 * focus, coverage) and ticks it.
 *
 * `covered` is an ARGUMENT, not a constant. Round 1 hard-coded `false` with a
 * comment claiming nothing covered the list, while the same file rendered a
 * confirmation dialog over it — latent behind B1, and wrong the moment B1 was
 * fixed (code review m3).
 */
export function useReceiptFeed(options: {
	send: (
		targets: InboxToken[],
		evidence: NotificationSeenRequest["evidence"],
	) => Promise<{ ok: boolean; changed: string[] }>;
	covered: boolean;
	/** Whether this screen is the focused route. */
	focused: boolean;
	enabled: boolean;
}): {
	feed: ReceiptFeed;
	onViewableItemsChanged: (info: ViewableInfo<InboxToken>) => void;
	noteInput: (kind: "touch" | "press" | "scroll" | "focus") => void;
} {
	const { send, covered, focused, enabled } = options;
	/* The feed outlives renders: it holds the tracker. Rebuilt only when the
	 *  sender identity changes, which is the connection itself. */
	const feedRef = useRef<ReceiptFeed | null>(null);
	if (feedRef.current === null) feedRef.current = createReceiptFeed({ send });
	const feed = feedRef.current;

	const [appActive, setAppActive] = useState(
		() => AppState.currentState === "active",
	);

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			setAppActive(state === "active");
		});
		return () => subscription.remove();
	}, []);

	/* A FOCUS-GAIN IS THE ONE TRUSTED GESTURE THAT IS NOT A TOUCH. Coming back to
	 *  this screen is the reader putting it in front of themselves; the doctrine
	 *  lists focus-gain as evidence, and without it a reader who returns to an
	 *  already-rendered row would have to touch it before it could clear. Recorded
	 *  on the transition, never per render — a re-render is not a gesture. */
	const wasFocused = useRef(false);
	useEffect(() => {
		if (focused && enabled && !wasFocused.current) {
			feed.noteInput("focus", Date.now());
		}
		wasFocused.current = focused && enabled;
	}, [feed, focused, enabled]);

	useEffect(() => {
		feed.setAppActive(appActive);
	}, [feed, appActive]);
	useEffect(() => {
		feed.setFocused(focused && enabled);
	}, [feed, focused, enabled]);
	useEffect(() => {
		feed.setCovered(covered);
	}, [feed, covered]);

	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(() => {
			void feed.tick(Date.now());
		}, RECEIPT_CHECK_MS);
		return () => clearInterval(timer);
	}, [feed, enabled]);

	const onViewableItemsChanged = useCallback(
		(info: ViewableInfo<InboxToken>) => feed.viewable(info),
		[feed],
	);
	const noteInput = useCallback(
		(kind: "touch" | "press" | "scroll" | "focus") =>
			feed.noteInput(kind, Date.now()),
		[feed],
	);

	return { feed, onViewableItemsChanged, noteInput };
}
