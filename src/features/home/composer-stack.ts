/**
 * The home's notice stack: the startup line and the folder / model / start
 * alerts that sit between the hero and the composer.
 *
 * WHY THIS EXISTS (QA round 2, Q-R2-1). The notices were unbounded siblings
 * above the composer. Each one shortens the hero's band, and the band can
 * shrink only to 0. At 320 × 568 pt with 200 % text, the folder alert
 * (191.8 pt) and the model alert (232.4 pt) together need 432 pt, but only
 * 370 pt sit between the header and the composer. The column overflowed
 * downward: the composer moved from y 434 to 504, and the field and send
 * button ended below a screen that does not scroll.
 *
 * THE FIX IS A CAP, NOT A MERGE. The stack is a ScrollView that may SHRINK
 * (`flexShrink: 1`) but never GROW (`flexGrow: 0`). Its basis is its content
 * height, so with room to spare it is exactly as tall as before, the hero
 * re-centres in what is left, and nothing changes. Once the content is taller
 * than the room above the composer, the stack is the only item in the column
 * that can give up height. (The hero's region is `flex-1`, whose basis is 0,
 * so it has nothing to give, and the composer does not shrink.) The stack
 * stops at the composer's resting top and scrolls inside that cap. Both Retry
 * buttons stay reachable by scrolling the stack.
 *
 * A combined alert was the other option. It would need a third sentence in
 * every locale, plus two actions in one Alert (Alert has one action slot) or
 * one Retry that retries both reads. It would also stop each failure being
 * told and retried on its own (design D2 / UX U1). The cap changes no copy and
 * no component.
 *
 * `composerStackLayout` is the same arithmetic, written out. Yoga does it for
 * real; the function is here so a test can show the composer's y with no
 * renderer, using the constants the screen uses.
 */

/** The stack's flex: it may shrink to the room above the composer, and it
 *  never takes room the hero's band could use. A ScrollView's default style
 *  is `flexGrow: 1`, so `flexGrow: 0` is required, not decoration. */
export const NOTICE_STACK_STYLE = { flexGrow: 0, flexShrink: 1 } as const;

export type ComposerStackInput = {
	/** The column's height: the header's bottom down to the screen's bottom. */
	column: number;
	/** The composer's own height, safe-area padding included. */
	composer: number;
	/** Each notice's height, its 8 pt `pb-2` gap included. */
	notices: readonly number[];
};

export type ComposerStackLayout = {
	/** The hero's band: whatever the stack leaves. Never below 0. */
	heroBand: number;
	/** The stack's height: the notices' height, capped at the room above the
	 *  composer. */
	stack: number;
	/** Whether the stack's content is taller than its cap, so it scrolls. */
	scrolls: boolean;
	/** The composer's top edge, measured from the column's top. */
	composerY: number;
};

/**
 * Where the composer sits for a given set of notices.
 *
 * The room above the composer is fixed by the column and the composer alone,
 * so `composerY` takes no input from `notices`. The stack takes what it needs
 * from the hero's band, up to the whole band, and scrolls past that.
 */
export const composerStackLayout = ({
	column,
	composer,
	notices,
}: ComposerStackInput): ComposerStackLayout => {
	const room = Math.max(0, column - composer);
	const content = notices.reduce((sum, height) => sum + height, 0);
	const stack = Math.min(content, room);
	return {
		heroBand: room - stack,
		stack,
		scrolls: content > room,
		composerY: room,
	};
};
