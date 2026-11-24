import { useCallback } from "react";
import {
	type GestureResponderEvent,
	Pressable,
	Text,
	type TextStyle,
} from "react-native";

import { askChipOpen, askChipWord } from "@/features/session/ask-chip";
import { useAskChipHost } from "@/features/session/ask-chip-host";
import { t } from "@/i18n";
import { haptic } from "@/lib/haptics";
import { useUiStore } from "@/state/ui-store";
import { askIdChipId, askIdCopyId, ROLE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";

/**
 * The ask id a reader can MATCH (Ben, 2026-11-23: "the app shows NO ask id
 * anywhere, so a user cannot match the `a-745e` an agent quotes").
 *
 * TWO SHAPES, ONE RULE. `AskIdChip` is the id as it appears inside an agent's
 * sentence: a control only when THIS session can answer for the id, and plain
 * mono with a dotted underline when it cannot (another conversation, aged out of
 * the queue, or not read yet) — a chip that opened nothing, or worse another
 * session's ask, would be the one lie this feature exists to refuse. `AskIdFoot`
 * is the same id at the quiet edge of a card, row or receipt: a real box at the
 * touch floor, because the row it sits in is a different target.
 *
 * THE CHIP IS A NESTED `Text`, NOT A `Pressable`, and that is deliberate.
 * `react-native-web` renders a nested `Text` as a `<span>` and a `Pressable` as
 * a block `<div>` (measured in `react-native-web/dist/exports/Text`: the tag is
 * chosen by `hasTextAncestor`), so a Pressable chip would break a sentence into
 * block-level lines on web, and web drops `Pressable`'s `hitSlop` besides
 * (`components/button.tsx` records the same measurement). `Text` carries no
 * `hitSlop` prop at all (checked in `react-native/Libraries/Text/Text.d.ts`), so
 * the 44 pt floor cannot be met from inside running prose by either: the chip's
 * target is its own line box, and the card foot below is the floor-compliant
 * way to copy the same id. Long-press is the chip's own copy door, as the spec
 * asks, and it is a gesture on a target already being touched.
 *
 * NO MOTION. Nothing here animates — the chip's state change is a repaint, the
 * confirmation is a toast's own fade (which honours Reduce Motion itself) — so
 * there is no reduced-motion branch to get wrong.
 */

/** The dotted underline of an id this session cannot resolve (spec §3, "not
 *  found"): the one signal that the mono text is an id and is not a control.
 *  `textDecorationStyle` is honoured on iOS and ignored by Android's text paint,
 *  where the underline still marks it — Android is not a separate design. */
const UNRESOLVED_UNDERLINE: TextStyle = {
	textDecorationLine: "underline",
	textDecorationStyle: "dotted",
};

/** The chip's dot: the accent while the question still waits, muted once it is
 *  settled. Never the only signal — the word beside it says the state. */
const DOT_OPEN_CLASS = "text-accent-active dark:text-accent-hover";
const DOT_SETTLED_CLASS = "text-ink-dim";

/**
 * Copying is ONE action with one confirmation, wherever it is offered: the id
 * goes to the clipboard, the hand ticks (the app's habit for "an action was
 * taken", `lib/haptics.ts`), and the toast names what was copied rather than a
 * bare "Copied" — the reader may have meant the sibling row.
 *
 * Exported because an ask ROW copies by long press rather than by a box: a
 * `Pressable` nested in a `Pressable` is unreachable by a screen reader on
 * native (the outer button owns the element), so the row keeps one element and
 * its hold — the same gesture the chip uses.
 */
export const useCopyAskId = () => {
	const showToast = useUiStore((store) => store.showToast);
	return useCallback(
		(askId: string) => {
			haptic("light");
			/* THE CLIPBOARD MODULE IS LOADED ON USE, NOT ON IMPORT. `ask-id` is
			 *  reached from every transcript row (through `ask-response-row`), and the
			 *  suite's Node tests import `transcript-row` without a native-module
			 *  registry: a top-level `expo-clipboard` import made three of them die at
			 *  LOAD time with `__DEV__ is not defined` (PR #387 QA round 1, Q1). The
			 *  app's own precedent is `attachment-source.ts`, which awaits the module
			 *  at the moment of the paste. */
			void import("expo-clipboard").then((Clipboard) =>
				Clipboard.setStringAsync(askId),
			);
			showToast(t("mobile.asks.chip.copied", { id: askId }));
		},
		[showToast],
	);
};

/**
 * A nested control inside running prose takes its gesture OUT of the message
 * before it acts: a tap on web is a DOM click that otherwise also reaches the
 * transcript row's own actions, which is why the prose renderer's link handler
 * makes the same two calls. The mark also keeps the gesture out of the row's JS
 * handlers on native.
 *
 * A HOLD'S OTHER ACTION IS MARKED, NOT REMOVED, and that is stated rather than
 * fixed (review round 1, m1). A hold on the chip copies the id; on iOS the row's
 * raw-touch long-press can still enter selection mode under it, and on Android
 * the parent's native `<Text selectable>` can eat the hold. Routing the hold
 * through `useTextSelection().enter` — what `CodeBlockView` does — is NOT that
 * fix here: inside a hosted message on Android that context's `enter` IS the
 * message's long-press (the actions sheet), so it would add a second action
 * instead of removing one. The check needs a real device, which this round did
 * not have.
 */
const takeGesture = (event: GestureResponderEvent) => {
	event.stopPropagation();
	event.preventDefault();
};

/** An ask id quoted in an agent's prose. */
export const AskIdChip = ({ id }: { id: string }) => {
	const host = useAskChipHost();
	const copy = useCopyAskId();
	const showToast = useUiStore((store) => store.showToast);
	const fact = host?.facts.get(id);
	const word = fact === undefined ? null : askChipWord(fact.status);

	if (host === null || fact === undefined || word === null) {
		/* NOT THIS SESSION'S ASK. Plain mono, no dot, no chip — and tapping it says
		 *  why rather than doing nothing, because a reader who expected it to jump
		 *  needs the answer the reader of the spec asks for: another session's id
		 *  and an aged-out one look identical from here. */
		return (
			<Text
				className="font-mono text-mono-sm text-ink-muted"
				style={UNRESOLVED_UNDERLINE}
				onLongPress={(event) => {
					takeGesture(event);
					copy(id);
				}}
				onPress={(event) => {
					takeGesture(event);
					showToast(t("mobile.asks.chip.unknown_label", { id }));
				}}
				accessibilityRole={ROLE.button}
				accessibilityLabel={t("mobile.asks.chip.unknown_label", { id })}
				testID={askIdChipId(id)}
			>
				{id}
			</Text>
		);
	}

	const state = word.kind === "key" ? t(word.key) : word.text;
	const open = askChipOpen(fact.status);
	return (
		<Text
			className="font-mono text-mono-sm bg-elevated text-ink web:rounded-xs"
			onPress={(event) => {
				takeGesture(event);
				host.open(id);
			}}
			onLongPress={(event) => {
				takeGesture(event);
				copy(id);
			}}
			accessibilityRole={ROLE.button}
			accessibilityLabel={
				fact.question === ""
					? t("mobile.asks.chip.label_bare", { id, state })
					: t("mobile.asks.chip.label", {
							id,
							state,
							question: fact.question,
						})
			}
			testID={askIdChipId(id)}
		>
			<Text className={open ? DOT_OPEN_CLASS : DOT_SETTLED_CLASS}>●</Text>
			{` ${id} · ${state}`}
		</Text>
	);
};

/** The quiet id at the foot of an ask card or transcript receipt, with the copy
 *  door.
 *
 *  THE WHOLE FOOT IS THE TARGET, at the touch floor: the id and the copy mark are
 *  one line, so there is a single control where the spec draws one, and it is
 *  big enough to hit without the row's own press (a row copies on a hold
 *  instead — see `asks-sheet.tsx`). `self-end` puts it on the reading-end edge,
 *  where the spec draws it beside the timestamp. */
export const AskIdFoot = ({ askId }: { askId: string }) => {
	const copy = useCopyAskId();
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={t("mobile.asks.chip.copy_label", { id: askId })}
			onPress={() => copy(askId)}
			onLongPress={() => copy(askId)}
			style={{ minHeight: TOUCH_FLOOR }}
			className="flex-row items-center justify-end gap-1 self-end"
			testID={askIdCopyId(askId)}
		>
			<Text className="font-mono text-mono-sm text-ink-muted">{askId}</Text>
			{/* The spec's own copy mark (`a-e53b ⧉`), a glyph rather than a vector
			 *  icon: this sits inside running text, and an icon import would drag
			 *  `lucide-react-native` into the prose renderer's module graph — which Node
			 *  cannot parse, so every test that meets an icon mocks the package. The
			 *  Pressable carries the accessible name, so the mark is decorative. */}
			<Text className="text-mono-sm text-ink-dim" aria-hidden>
				⧉
			</Text>
		</Pressable>
	);
};
