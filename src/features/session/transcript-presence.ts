/**
 * The transcript's scroll-linked chrome, as arithmetic and one tiny signal.
 *
 * TWO CONSUMERS, ONE SOURCE. The edge fades (item 8 of the design pass) are a
 * function of WHERE the list is scrolled; the checkpoint rail (item 10) is a
 * function of WHETHER it is moving. Both used to be absent, and the rail was the
 * permanent right-edge column of ticks the operator read as a scrollbar. Nothing
 * here draws: this module answers the two questions and the components paint the
 * answer, so the maths is testable without a renderer or an animation clock.
 *
 * WHY THE RAIL IS TIME-BASED AND NOT POSITION-BASED. A rail keyed to velocity
 * flickers on a slow drag; a rail keyed to "has moved recently" is the behaviour
 * every platform's transient scrollbar has — visible while you move, gone a
 * moment after you stop. `RAIL_LINGER_MS` is that moment.
 *
 * WHY A SUBSCRIPTION RATHER THAN STATE. The rail lives in the session screen
 * beside the list, so the signal has to cross one component boundary. A React
 * state flip there would re-render the screen — and the screen owns the whole
 * transcript, the composer and the panels — twice per gesture. So the presence
 * is a plain object the screen owns, the list reports into it, the rail
 * subscribes, and the only thing that changes per gesture is an animated
 * opacity value the rail already knows how to drive natively.
 */

/** The fade band's height in points, both edges. One constant shared by the
 *  top and bottom overlays, and the same 24 pt the sheet body fade and the
 *  markdown table cue already use (`sheet.tsx`'s `SHEET_BODY_FADE`,
 *  `markdown.tsx`'s `TABLE_FADE_PT`) — a third value would be a third
 *  language for the same cue. */
export const TRANSCRIPT_FADE_PT = 24;

/** The distance over which an edge fade ramps between absent and full. Equal to
 *  the band height on purpose: over 24 pt of travel the band goes from invisible
 *  to opaque, which is slow enough to read as a gradient appearing rather than
 *  as a flicker, and it means the band is never half-painted at an extreme. */
export const FADE_RAMP_PT = TRANSCRIPT_FADE_PT;

/** How long the rail stays up after the offset stops moving. ~1 s on the
 *  operator's word (TestFlight 578: "still feel too invasive"); it was 1.5 s. */
export const RAIL_LINGER_MS = 1000;

/**
 * The scroll speed, in points per millisecond, at which a reader's gesture
 * SUMMONS the rail. Below it the rail stays down whatever the finger does.
 *
 * WHY A SPEED GATE (TestFlight 578): the rail came up for every drag, including
 * the slow ones a reader makes while reading, so ~25 ticks sat over the text
 * through ordinary use. The rail is a "where am I in a long conversation" cue,
 * which only matters when travelling fast. 1 pt/ms (1000 pt/s) sits between a
 * reading drag (a few hundred pt/s: a line or two per frame) and a flick
 * (UIScrollView releases flicks at thousands of pt/s). It is a DESIGN VALUE,
 * not a measured distribution — no device trace exists for this app yet — so
 * tune it from TestFlight, not from this comment.
 */
export const RAIL_FAST_PT_PER_MS = 1;

/** The rail's fade in and out. Fast enough to be gone before a reader can aim
 *  at it, slow enough not to strobe at the end of a flick. */
export const RAIL_FADE_MS = 200;

export type EdgeFadeLevels = {
	/** 0 = no fade at the top edge, 1 = fully faded. */
	top: number;
	/** 0 = no fade at the bottom edge, 1 = fully faded. */
	bottom: number;
};

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);

/**
 * The gradient's two stop opacities for one edge band, in offset order
 * (`[offset 0, offset 1]`) along a gradient drawn top → bottom.
 *
 * WHY THIS IS A FUNCTION WITH ITS OWN TEST. Round 1 shipped both bands inverted
 * (design D1): solid canvas on the CONTENT side and clear at the screen edge,
 * which paints a hard canvas line 24 pt in instead of dissolving the content
 * into the edge. Nothing pinned the order, because the levels test only covers
 * how strongly a band shows, not which way it runs. The rule, and the in-repo
 * precedent (`sheet.tsx`'s bottom cue, the same `y1 0% → y2 100%` geometry):
 * the band is OPAQUE at the screen edge and CLEAR toward the content.
 *  - top band: offset 0 is the screen's top edge → `[1, 0]`;
 *  - bottom band: offset 1 is the screen's bottom edge → `[0, 1]`.
 */
export function edgeFadeStops(
	edge: "top" | "bottom",
): readonly [number, number] {
	return edge === "top" ? [1, 0] : [0, 1];
}

/**
 * Both edge fades, from the three facts the list already tracks.
 *
 * The rules, in the order they win:
 *  - content that does not scroll has NO fade at either edge (a fade on a
 *    screen with nothing hidden behind it is a lie about there being more);
 *  - at the top extreme the top fade is 0, and the bottom fade ramps in over
 *    the first `FADE_RAMP_PT` of travel;
 *  - at the bottom extreme the bottom fade is 0, and the top fade ramps out
 *    over the last `FADE_RAMP_PT`;
 *  - anywhere between, both are 1.
 *
 * `contentPt` is the scroller's content height and `viewportPt` its own height;
 * the maximum offset is their difference, which is what every platform clamps
 * to. A negative maximum (the content shrank under the reader) reads as "does
 * not scroll".
 */
export function edgeFadeLevels({
	offsetY,
	contentPt,
	viewportPt,
}: {
	offsetY: number;
	contentPt: number;
	viewportPt: number;
}): EdgeFadeLevels {
	const maxOffset = contentPt - viewportPt;
	if (!(maxOffset > 0)) return { top: 0, bottom: 0 };
	const offset = clamp01(offsetY / maxOffset) * maxOffset;
	return {
		top: clamp01(offset / FADE_RAMP_PT),
		bottom: clamp01((maxOffset - offset) / FADE_RAMP_PT),
	};
}

/**
 * The rail's presence signal: "the READER is moving the list, or just did".
 *
 * Owned by the screen (`createScrollPresence`), reported to by the list and
 * subscribed to by the rail. `dispose` clears the pending timer; a screen that
 * unmounts mid-linger must not leave one behind.
 *
 * ONLY THE READER'S OWN GESTURE COUNTS (review round 1, U3 / m2 / Q4). The list
 * moves itself too: the tail pin (`pinTail` → `scrollToOffset`) runs on every
 * content growth while a turn streams, and the platforms deliver `onScroll` for
 * that programmatic offset like any other. Counting it raised the rail through
 * every streaming turn — the "constantly take space" the operator asked to be
 * rid of, in the state they spend most time in. So movement shows the rail only
 * while a drag holds the list (`setHeld`) or its momentum carries it
 * (`setCoasting`); an offset change outside both is a scroll the app made, and
 * is recorded but never shown.
 *
 * AND ONLY WHEN IT IS FAST (TestFlight 578). Inside a gesture, the rail is
 * summoned only once two consecutive offsets move at `RAIL_FAST_PT_PER_MS` or
 * more; a reading-speed drag never raises it. Once up, any further gesture
 * movement (or a held thumb) keeps it up, and it fades `RAIL_LINGER_MS` after
 * the gesture ends.
 *
 * Known limit — ON WEB THE RAIL NEVER SHOWS. react-native-web 0.21's ScrollView
 * emits only `onScroll`: no drag or momentum events for wheel, trackpad OR touch
 * (round 2, m-r2-2 — round 1's note claimed touch drags still worked, which they
 * do not). Every web offset therefore reads as a scroll the app made. That is
 * the accepted trade for keeping the tail pin from raising it on the native
 * targets this rail exists for; no web gesture path is wired.
 */
export type ScrollPresence = {
	/** The offset moved to this value. Shows the rail only during a reader
	 *  gesture (see above). A stationary list whose scroll view keeps
	 *  re-delivering the same offset cannot hold the rail up (round 1, m3 / Q3 /
	 *  U8): outside a gesture an offset never shows or re-arms anything, and
	 *  inside one the linger is not running to be restarted. That is why there
	 *  is no repeated-offset guard — round 1 carried one that no input could
	 *  reach (round 2, Q10). */
	noteMovement(offsetY: number): void;
	/** A drag gesture began or ended. A held thumb does NOT summon the rail
	 *  (only fast movement does — `RAIL_FAST_PT_PER_MS`), but once a fast drag
	 *  has summoned it, holding keeps it up however long the reader holds
	 *  still: the pointer analogue of a scrollbar thumb under the cursor. */
	setHeld(held: boolean): void;
	/** The list's momentum after a drag began or ended. The rail stays up while
	 *  it coasts and lingers from the moment it stops, so a flick reads as one
	 *  gesture rather than a drag plus an unexplained glide. */
	setCoasting(coasting: boolean): void;
	/** Fires on every visibility flip. Returns the unsubscribe. */
	subscribe(listener: (visible: boolean) => void): () => void;
	/** The current answer, for a subscriber that mounts late. */
	readVisible(): boolean;
	dispose(): void;
};

export function createScrollPresence(
	/** The clock movement speed is measured against; injectable for tests,
	 *  though `Date.now` is what vitest's fake timers already drive. */
	now: () => number = Date.now,
): ScrollPresence {
	let visible = false;
	/* The previous reader-gesture sample, for the speed gate. Reset at every
	 *  gesture boundary so a new drag never measures against an old one's
	 *  offset (which would read a long pause as a huge jump, or the reverse). */
	let last: { offsetY: number; at: number } | null = null;
	let held = false;
	let coasting = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const listeners = new Set<(visible: boolean) => void>();

	const emit = (): void => {
		for (const listener of listeners) listener(visible);
	};
	const clear = (): void => {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
	};
	const show = (): void => {
		if (visible) return;
		visible = true;
		emit();
	};
	/** Start the linger. A held thumb or a coasting list never starts it. */
	const arm = (): void => {
		clear();
		if (held || coasting) return;
		timer = setTimeout(() => {
			timer = null;
			if (!visible) return;
			visible = false;
			emit();
		}, RAIL_LINGER_MS);
	};

	return {
		noteMovement(offsetY: number) {
			/* A scroll the app made (the tail pin, a restore) is not the reader's. */
			if (!held && !coasting) return;
			const at = now();
			const previous = last;
			/* Same-millisecond deliveries carry no speed; keep the older sample
			 *  so the next delivery measures across a real interval. */
			if (previous !== null && at <= previous.at) return;
			last = { offsetY, at };
			if (!visible) {
				if (previous === null) return;
				const speed = Math.abs(offsetY - previous.offsetY) / (at - previous.at);
				if (speed < RAIL_FAST_PT_PER_MS) return;
			}
			show();
			arm();
		},
		setHeld(next: boolean) {
			held = next;
			if (held) {
				/* A new drag ends any glide it caught (round 2, U11 / m-r2-3). A
				 *  finger that stops a flick does not reliably get
				 *  `onMomentumScrollEnd` first, and a `coasting` left true would
				 *  stop every later linger from arming — the rail stuck up for
				 *  good after one caught flick. */
				coasting = false;
				last = null;
				/* Holding never SUMMONS the rail; it only stops an already
				 *  summoned one from fading (no linger while held). */
				clear();
				return;
			}
			last = null;
			if (visible) arm();
		},
		setCoasting(next: boolean) {
			coasting = next;
			if (coasting) {
				/* A glide keeps a summoned rail up; a slow one never raises it. */
				clear();
				return;
			}
			last = null;
			if (visible) arm();
		},
		subscribe(listener: (visible: boolean) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		readVisible() {
			return visible;
		},
		dispose() {
			clear();
			listeners.clear();
		},
	};
}
