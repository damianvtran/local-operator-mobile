// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.

import {
	Keyboard as KeyboardIcon,
	Mic,
	MoreHorizontal,
	Paperclip,
	Square,
	X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Dimensions,
	Image,
	Keyboard,
	type KeyboardEvent,
	type LayoutChangeEvent,
	Platform,
	Pressable,
	ScrollView,
	Text,
	type TextInput,
	useWindowDimensions,
	View,
} from "react-native";

import Animated, {
	interpolate,
	runOnJS,
	useAnimatedReaction,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import type { PromptImage } from "@/contracts";
import {
	type AttachSource,
	attachActions,
} from "@/features/session/attach-rule";
import type { ComposerChip } from "@/features/session/chip-labels";
import { ComposerStateMarkers } from "@/features/session/components/state-markers";
import {
	attachmentLabel,
	type ComposerControls,
	composerCopy,
} from "@/features/session/composer";
import {
	ATTACH_GLYPH_PT,
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	COMPOSER_META_ROW,
	MODEL_FLOOR_PT,
} from "@/features/session/composer-layout";
import {
	COMPOSER_CONTROLS_GAP,
	COMPOSER_FIELD_BOX,
	composerPaintedHeight,
	composerPresentation,
	composerShellRadius,
	keyboardOverlap,
	morphHeight,
	seedFor,
} from "@/features/session/composer-presentation";
import { isSendKey } from "@/features/session/keyboard";
import type { DictationState } from "@/features/session/use-dictation";
import { t } from "@/i18n";
import { formatDuration } from "@/stt/dictation";
import { MIC_HINT, micLabel } from "@/stt/dictation-machine";
import {
	attachOptionId,
	CONTROL,
	composerAttachmentId,
	LIVE_REGION,
	ROLE,
	SURFACE,
	state,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import {
	Button,
	Chip,
	DictationMeter,
	IconButton,
	Sheet,
	Skeleton,
	Textarea,
} from "@/ui/components";
import { useIsRTL } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";
import { composerBudget } from "@/ui/size-class";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { CONTROL_DISABLED_INK, cx } from "@/ui/variants";

/** The outcome lines the status row can rest on, and whether the row is showing a
 *  LIVE dictation (a phase) rather than a settled outcome. Both are read from the
 *  machine's own snapshot; the row is one height either way (design §2.5 D3). */
const rowIsLive = (phase: DictationState["phase"]): boolean => phase !== "idle";

/** The row's own border, top and bottom (the `border` utility is 1 px each side).
 *  Named because the row's height is a BORDER box: a `minHeight` of exactly
 *  `TOUCH_FLOOR` left a live row 2 px taller than an outcome one, because the live
 *  row's own 48 px discard control set the content height and the outcome's did not —
 *  measured 50 against 48 at 100 % (design round 1, D1's own figures). Adding the
 *  border to the floor makes every state the same box at the default scale. */
const DICTATION_ROW_BORDER_PX = 2;

/** One line of the row's status text (body-sm, 14 px at 1.45), in px at scale 1.
 *
 *  The row has to RESERVE a box, not measure one: at large text the status is
 *  allowed two lines, and the controls get a line of their own, but a short status
 *  (a one-line outcome) must not shrink the row below the two-line states — that is
 *  exactly the "the composer jumps when a take starts" the design round measured
 *  (D1). A line count times a line height is the box, computed the same way
 *  `Textarea` computes its own field height from `BODY_LINE_PX`. */
const STATUS_LINE_PX = 21;

/** The gap between the status line and the controls line at large text. */
const DICTATION_ROW_GAP_PX = 8;

/** The dictation row's height at the reader's scale (design §2.5 D3's "one height").
 *
 *  At the default scale it is the touch floor plus the row's own border. Past
 *  `LARGE_TEXT_SCALE` it is one status line, the gap, and a touch-floor controls
 *  line, plus that border: two status lines — the longest outcome copy at 200 % — are SHORTER than
 *  that sum (2 x 41 < 41 + 8 + 48 at 200 %), so fixing the box gives every state
 *  the same height with no layout pass and no dependence on which sentence shows. */
const dictationRowBox = (scale: number): number =>
	scale > LARGE_TEXT_SCALE
		? Math.round(STATUS_LINE_PX * scale) +
			DICTATION_ROW_GAP_PX +
			TOUCH_FLOOR +
			DICTATION_ROW_BORDER_PX
		: TOUCH_FLOOR + DICTATION_ROW_BORDER_PX;

/**
 * A DOM keyboard event, narrowed to what this file reads.
 *
 * `Textarea` deliberately owns no keys — its docstring says the key handling
 * "belongs where the send action lives" — and it forwards no key prop, so on the web
 * build the only place to install the handler is this subtree: a keydown bubbles
 * from the field to the composer's own root, and the target comparison keeps the
 * sheet's filter field out of it.
 */
type WebKeyEvent = {
	key: string;
	shiftKey: boolean;
	/** True while an IME is composing: Enter there commits a candidate, not a message. */
	isComposing?: boolean;
	target: unknown;
	preventDefault: () => void;
};

/** The event as `isSendKey` reads it: the target identity is resolved here, where
 *  the DOM node is in hand, so the decision itself stays pure and testable. */
const asKeyEvent = (event: WebKeyEvent, field: unknown) => ({
	key: event.key,
	shiftKey: event.shiftKey,
	isComposing: event.isComposing,
	fromField: field !== null && field === event.target,
});
type WebFieldNode = {
	addEventListener: (type: string, listener: WebListener) => void;
	removeEventListener: (type: string, listener: WebListener) => void;
	querySelector: (selector: string) => unknown;
};

/** The paste event the composer listens for: a real Cmd+V's clipboard payload.
 *  `clipboardData` is `null` when the browser withholds it, and its `files` is
 *  what a screenshot paste actually carries. */
type WebPasteEvent = {
	clipboardData: { files: ArrayLike<File> } | null;
	preventDefault: () => void;
};

/** Either listener this file installs: the keydown the send key reads, the paste
 *  the image attach reads. A union — not `any` — so each effect keeps its own
 *  event's type, and the one platform bridge here stays the cast it always was. */
type WebListener =
	| ((event: WebKeyEvent) => void)
	| ((event: WebPasteEvent) => void);

/**
 * The composer (`docs/design/components.md` § 12).
 *
 * **One primary control, and it never moves.** Send, steer and stop are the same
 * control in the same place with the same geometry: the label changes and the
 * command changes, but the control is a fixed 44 pt circle so a morph cannot slide
 * the target out from under the thumb that is about to press it. That is why the
 * width is a token role and not the label's natural size.
 *
 * **The retained-instruction alert is not an error container for a success.** A
 * delivered acknowledgement renders in the success roles (`D11`): presenting "an
 * earlier instruction was delivered" as a failure trains the reader to fear the one
 * message that means their text is safe.
 *
 * **Nothing here loses the reader's text.** The draft is the parent's state and is
 * persisted per session; this component neither clears it on a failure nor on a
 * navigation, and the only path that clears it is a definitive acknowledgement of
 * the bytes it actually shows.
 */
export type ComposerProps = {
	controls: ComposerControls;
	draft: string;
	onDraftChange: (text: string) => void;
	images: PromptImage[];
	onRemoveImage: (index: number) => void;
	/** The attach sheet's chosen source. The sheet itself is this component's;
	 *  reading the image is the host's — the composer home and the session view
	 *  both hand in their own `attach`, and both land on the same strip. */
	onAttach: (source: AttachSource) => void;
	/** A web paste event's image file. Only the web build can raise the event;
	 *  the listener that reads it lives here, the read lives with the host. */
	onPasteFile: (file: File) => void;
	attaching?: boolean;
	/** The voice mic's state. `null`/absent means this surface shows no mic — the
	 *  composer home passes nothing (its mic belongs with the new-chat flow), and a
	 *  relay without `capabilities.stt` gets `micVisible: false` from the session
	 *  view. */
	voice?: DictationState | null;
	onSend: () => void;
	onStop: () => void;
	/** The retained envelope's message, or `null` when nothing is pending. */
	retainedMessage: string | null;
	/** A definitive acknowledgement of an EDITED draft: a success, not a failure. */
	notice: string | null;
	onRetry: () => void;
	/** The resume affordance, driven by the wire's `stop_reason === "aborted"`. */
	showResume: boolean;
	onResume: () => void;
	/** The session's health verdict is ENDED (from the header's dot). Changes the
	 *  placeholder to "send to reopen", and suppresses the aborted-turn Resume —
	 *  an ended session yields to the header's Resume, which is the same act. */
	ended?: boolean;
	/** A refused start or a failed steer, stated beside the control that caused it. */
	error: string | null;
	queuedCount: number;
	onOpenQueue?: () => void;
	onEditingChange?: (editing: boolean) => void;
	suppressDisabledHint?: boolean;
	/** The working-folder chip on the meta line. The composer home passes its
	 *  target folder (`homeTargetFolder`); the session view passes nothing. Data
	 *  rather than an element, because the meta line's fit decides how it paints:
	 *  the full path, or the folder glyph alone when the line is short (record
	 *  §2.2 yield order). */
	folderChip?: {
		label: string;
		onPress: () => void;
		accessibilityLabel: string;
		accessibilityHint: string;
		testID: string;
	} | null;
	/** The context-window reading ("21% context") and the spend ("$0.42"), on
	 *  the meta line — they were a status strip under the header, which crowded
	 *  it (D-S3). Each yields from the line before the model does. */
	contextLabel?: string | null;
	costLabel?: string | null;
	/** The bottom safe-area inset this composer must pay, pt. The composer owns
	 *  the screen's bottom edge (record §2.2): the screen passes `insets.bottom`
	 *  and the shell pays it as inner padding, so its surface fills the band
	 *  under the home indicator while no control's box sits in it. Omit for a
	 *  composer that does not sit on the screen's bottom edge (a split pane's
	 *  detail column still does; a sheet would not). */
	bottomInset?: number;
	/** The two chips, each in one of its three states — value, unavailable, or
	 *  loading while a projection is still expected. The decision lives in
	 *  `chip-labels.ts` rather than here, because "loading" and "unavailable" look
	 *  alike on screen and mean opposite things (design round 1 D6, round 2 D14;
	 *  review round 4 R7/R8).
	 *
	 *  Optional since the composer home: home has no turn to apply an effort to,
	 *  so it passes `null` and the lever is not rendered at all — a disabled chip
	 *  whose label disagrees with what it can do is the U-24 dead end. */
	modelChip: ComposerChip;
	effortChip?: ComposerChip | null;
	onOpenModels: () => void;
	onOpenEffort: () => void;
	/** A leading `/` opens the sheet; `null` keeps it shut. */
	slashQuery: string | null;
	slashSheet: React.ReactNode;
	/** A handle to the field, for the one caller that focuses it by name (the
	 *  home's New chat). The third mechanical prop beyond the spec's two chips:
	 *  § 4.3 requires New chat to focus the composer, and focus needs a ref. */
	fieldRef?: React.RefObject<TextInput | null>;
	/** Short landscape (`compactChromeFor`): the label stops painting (the placeholder
	 *  and the accessible name still say what the field is), the paddings tighten, and
	 *  the composer is BOUNDED to `maxHeight` and scrolls internally — so a 200 % text
	 *  size cannot push the composer, or the model and effort chips in it, off a 390 pt
	 *  screen. Nothing is removed: every control stays in the one scrollable body. */
	compact?: { maxHeight: number } | null;
	/** The whole composer's ceiling in px, from the window geometry. `compact.maxHeight`
	 *  is the short-landscape share; this is the COLUMN's remaining height, which
	 *  applies on portrait too — a six-line draft at 200 % otherwise pushed the field,
	 *  the chips and the action row past the window bottom (design recheck D-c). */
	limit?: number | null;
	/** Reports the composer's painted box in WINDOW coordinates. The SCREEN owns the
	 *  window height; the composer owns the geometry, so the measurement lives here
	 *  and no wrapper reparents the field (footer contract). Height is part of it:
	 *  the ceiling only binds once the painted bottom reaches the window. */
	onMeasure?: (box: { top: number; height: number }) => void;
	/** Any value whose change moves the composer without resizing it (the find bar,
	 *  a panel, the pending card). The measurement effect watches it. */
	measureKey?: string;
	/** Measure the existing root without inserting an input-reparenting wrapper. */
	onLayout?: (event: LayoutChangeEvent) => void;
	testID: string;
};

/**
 * The chip's box while its label is unknown: the same pill, with the kit's
 * skeleton bar inside it (§ 19 — `elevated`, pulsing, and never a bare spinner).
 *
 * It carries the chip's own testID, so a flow that addresses the lever keeps
 * working the moment the label arrives, and it announces itself as BUSY rather
 * than as a disabled control with a name — a screen reader hears that the value is
 * still coming, which is the truth, instead of hearing a control called "model".
 */
const ChipPlaceholder = ({
	label,
	widthClassName,
	testID,
}: {
	label: string;
	/** The bar's width, sized to the label it stands in for so the swap does not
	 *  shift the chip sideways (measured: a 26 pt pill jumped to 119.6 pt when the
	 *  model arrived). */
	widthClassName: string;
	testID: string;
}) => (
	/* A `Pressable`, not a `View`, and `disabled` rather than `accessibilityState`
	 * alone — the two facts this PR's own probes established the hard way: RN-web
	 * ignores `accessibilityState` on BOTH View and Pressable, so the disabled flag
	 * and the removal from the tab order come from the `disabled` prop, and there is
	 * no `aria-busy` unless it is passed directly (review round 4 R5, QA Q3). Busy is
	 * therefore passed both ways: `accessibilityState` for native, `aria-busy` for
	 * the web build. */
	<Pressable
		accessibilityRole={ROLE.button}
		accessibilityLabel={label}
		accessibilityState={state({ disabled: true, busy: true })}
		aria-busy
		// A border and no fill: the skeleton's `elevated` bar measured 1.07:1 against
		// the disabled chip's own fill at rest (design round 2, D13), and the kit's
		// § 19 rule is that the resting tone stands out without the pulse. Every
		// other skeleton in this app sits on the page ground for exactly that reason,
		// so the placeholder takes the same ground rather than inventing a tone; the
		// resting ratio on that ground is confirmed in the next capture run.
		className="min-h-11 items-center justify-center rounded-full border border-hairline px-3"
		disabled
		testID={testID}
	>
		<Skeleton lines={1} barClassName="h-3" widthClassName={widthClassName} />
	</Pressable>
);

/**
 * One of the composer's two chips, rendered from whatever state the wire reports.
 *
 * The three cases are deliberately in one place: a value chip is a control, an
 * unavailable one is disabled with the reason in its hint, and a loading one is
 * the placeholder. Spread across the JSX they drifted — the defect this replaces
 * had a rungless model pulsing forever because "no ladder" and "not yet known"
 * were the same expression.
 */
const ComposerChipButton = ({
	chip,
	onPress,
	chooseHint,
	loadingWidthClassName,
	testID,
}: {
	chip: ComposerChip;
	onPress: () => void;
	/** The hint on the value chip, which is the only case that opens a sheet. */
	chooseHint: string;
	loadingWidthClassName: string;
	testID: string;
}) => {
	if (chip.kind === "loading") {
		return (
			<ChipPlaceholder
				label={chip.accessibilityLabel}
				widthClassName={loadingWidthClassName}
				testID={testID}
			/>
		);
	}
	if (chip.kind === "unavailable") {
		return (
			<Chip
				label={chip.text}
				// Never dispatched: `Chip` requires the prop and a disabled Pressable
				// does not fire it. Passing it keeps one component for all three states
				// instead of a second, divergent chip shape.
				onPress={() => undefined}
				disabled
				quiet
				shrink
				accessibilityLabel={chip.accessibilityLabel}
				accessibilityHint={chip.accessibilityHint}
				testID={testID}
			/>
		);
	}
	return (
		<Chip
			label={chip.text}
			shrink
			onPress={onPress}
			quiet
			accessibilityLabel={chip.accessibilityLabel}
			accessibilityHint={chooseHint}
			testID={testID}
		/>
	);
};

/** iOS presents its picker from the current native controller, not the next
 * React state. Wait for the sheet's actual dismissal so it cannot take a newly
 * presented PHPicker down with it. Other platforms keep their immediate path.
 * The bounded fallback avoids a lost native callback hanging Attach forever.
 * Chrome branch (#163): preserved through the composer rewrite — the row still
 * closes the sheet, but the launch is deferred to `onDismiss` on iOS. */
export function createAttachmentSheetHandoff() {
	let pending: (() => void) | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let chosen = false;
	const clearPending = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		pending = undefined;
	};
	const cancel = () => {
		clearPending();
		chosen = false;
	};
	const dismissed = () => {
		const launch = pending;
		// Consuming a selection is NOT reopening the sheet: queued row events
		// after onDismiss/fallback must not launch a second, different picker.
		clearPending();
		launch?.();
	};
	return {
		choose: (launch: () => void, platform: string) => {
			// First iOS choice wins for this open, including the native dismissal
			// window. Attach's explicit cancel() is the only re-admission point.
			if (platform === "ios" && chosen) return;
			cancel();
			if (platform !== "ios") {
				launch();
				return;
			}
			chosen = true;
			pending = launch;
			timer = setTimeout(dismissed, 500);
		},
		dismissed,
		cancel,
	};
}

export const Composer = ({
	controls,
	draft,
	onDraftChange,
	images,
	onRemoveImage,
	onAttach,
	onPasteFile,
	attaching = false,
	voice = null,
	onSend,
	onStop,
	retainedMessage,
	notice,
	onRetry,
	showResume,
	onResume,
	ended = false,
	error,
	queuedCount,
	onOpenQueue,
	onEditingChange,
	suppressDisabledHint = false,
	folderChip = null,
	contextLabel = null,
	costLabel = null,
	bottomInset,
	modelChip,
	effortChip,
	onOpenModels,
	onOpenEffort,
	slashQuery,
	slashSheet,
	fieldRef,
	compact = null,
	limit = null,
	onMeasure,
	measureKey = "",
	testID,
	onLayout,
}: ComposerProps) => {
	const attachmentSummary = useMemo(
		() => images.map(attachmentLabel).join(" · "),
		[images],
	);

	/* The ✕ badge's glyph ink. `ink` on the badge's `elevated` fill is the kit's
	 * strongest plain pair (11.81:1 dark / 16.34:1 light), so the removal cue
	 * reads over any photo the badge floats above. */
	const removeInk = useTokenColor("ink");

	/* The dictation row's layout is scale-dependent (D1/D2/D3): beside the controls a
	 * squeezed status clipped and the meter's flex bars collapsed to zero width, so
	 * past `LARGE_TEXT_SCALE` the row stacks and its box is fixed. See the row's own
	 * comment. `effectiveScale` — not `scale` — because on the web the platform's
	 * factor reaches the glyphs through the root font size. */
	const { effectiveScale } = useTextScale();
	/* The dictation clock below is aligned to the row's TRAILING edge. React Native's
	 *  `textAlign` has no `start`/`end` (the type only accepts auto/left/right/
	 *  center/justify, and Android logs "Invalid textAlign" for `end`), so it is
	 *  resolved per platform instead. Web `right` is PHYSICAL, so an RTL document
	 *  needs `left`. Native `right` already means the trailing edge: React Native
	 *  swaps left/right itself under an RTL layout direction (iOS
	 *  `RCTAttributedTextUtils.mm`; Android `TextAttributeProps.getTextAlignment`),
	 *  so flipping it here too would put the clock back on the leading edge. */
	const rtl = useIsRTL();
	const dictationLargeText = effectiveScale > LARGE_TEXT_SCALE;

	/* The handler the listener calls, kept in a ref: re-attaching the listener on
	 * every render (to capture the current closure) is the other way to do this, and
	 * it drops keydowns in the gap between removing and adding. */
	const sendRef = useRef(onSend);
	const canSendRef = useRef(false);
	/* The paste listener is installed once and reads this ref, for the same reason
	 *  the keydown handler reads `sendRef`: re-binding the listener on every render
	 *  drops events in the gap between removing and adding it. */
	const pasteFileRef = useRef(onPasteFile);
	useEffect(() => {
		sendRef.current = onSend;
		pasteFileRef.current = onPasteFile;
		canSendRef.current = !controls.primary.disabled && !attaching;
	}, [onSend, onPasteFile, controls.primary.disabled, attaching]);

	const rootRef = useRef<View | null>(null);
	/* The attach sheet's open state. Local, not the host's: the sheet is this
	 *  component's own surface, so both hosts inherit it without a second copy. */
	const [attachSheetOpen, setAttachSheetOpen] = useState(false);
	/* One handoff per composer mount. Unmount cancels a latched choice so a
	 * dismissal arriving after the component is gone launches nothing. */
	const attachmentHandoff = useRef(createAttachmentSheetHandoff()).current;
	useEffect(() => () => attachmentHandoff.cancel(), [attachmentHandoff]);
	useEffect(() => {
		/* Enter sends, Shift+Enter inserts a newline, on a hardware keyboard. On web
		 * that is a `keydown` the field would otherwise spend on a newline: a multiline
		 * `TextInput` is a `<textarea>`, and `onSubmitEditing` never fires for one
		 * (measured: the draft became "…\n" and nothing reached the wire).
		 *
		 * **The native half of this rule is NOT wired, and is not claimed.** RN 0.86.3
		 * resolves `multiline` with no `submitBehavior` to `"newline"`, and both native
		 * layers dispatch submit only for `"submit"`/`"blurAndSubmit"` — so the
		 * `onSubmitEditing` passed to the Textarea below cannot fire, and a hardware
		 * Enter on iOS/Android inserts a newline instead of sending. Native is NOT RUN
		 * here (no simulator on this host), so this is read from the installed RN source
		 * rather than measured. Closing it needs `submitBehavior="submit"` or
		 * `onKeyPress` forwarding, both with the kit's owner (D1); until then the send
		 * control and the `keydown` listener above are the only paths that send. */
		if (Platform.OS !== "web") return;
		// `View`'s ref is the DOM element on react-native-web; the cast is the whole
		// of the platform bridge, and `WebFieldNode` names only what is read from it.
		const node = rootRef.current as unknown as WebFieldNode | null;
		if (node === null || typeof node.addEventListener !== "function") return;
		const onKeyDown = (event: WebKeyEvent) => {
			const field = node.querySelector("textarea, input");
			// The decision is `isSendKey`'s — Enter, not a newline gesture, not a
			// composition, and from THIS field rather than the sheet's filter.
			if (!isSendKey(asKeyEvent(event, field))) return;
			// The newline the browser would insert has to be stopped BEFORE it lands;
			// letting the handler run and hoping is how Enter ends up doing both.
			event.preventDefault();
			if (canSendRef.current) sendRef.current();
		};
		node.addEventListener("keydown", onKeyDown);
		return () => node.removeEventListener("keydown", onKeyDown);
	}, []);

	/* A pasted image is an ATTACHMENT, not a dropped no-op — the web build's half
	 * of the paste affordance (native reads the clipboard from the sheet's Paste
	 * row, because a RN text field never hands an image over). Same shape as the
	 * keydown listener above: installed once, reads a ref, and only CONSUMES the
	 * event when the payload is one this component owns. A paste with no image in
	 * it — plain text — stays the field's own business. */
	useEffect(() => {
		if (Platform.OS !== "web") return;
		const node = rootRef.current as unknown as WebFieldNode | null;
		if (node === null || typeof node.addEventListener !== "function") return;
		const onPaste = (event: WebPasteEvent) => {
			const files = Array.from(event.clipboardData?.files ?? []);
			const image = files.find((file) => file.type.startsWith("image/"));
			if (image === undefined) return;
			/* The image must not ALSO land as the browser's default (a filename, at
			 * best): what it becomes is an attachment, and only that. */
			event.preventDefault();
			pasteFileRef.current(image);
		};
		node.addEventListener("paste", onPaste);
		return () => node.removeEventListener("paste", onPaste);
	}, []);

	/* The dictation row's pieces, built once and laid out by the row below. Extracting
	 * them keeps the two layouts — one line at 100 %, and the stacked pair past
	 * `LARGE_TEXT_SCALE` — from drifting apart: both render the same nodes. */
	const dictationLive = voice !== null && rowIsLive(voice.phase);
	const dictationDot = dictationLive ? (
		<View className="h-2 w-2 rounded-full bg-danger" aria-hidden />
	) : null;
	const dictationStatus =
		voice === null ? null : (
			/* The POLITE live region, now visible rather than zero-height: the design's
			 * `role="status"` is the row a blind reader hears, and the outcome lines
			 * (U2/U3/D2) belong in the same one the live states use. The field's own
			 * `label` is its accessible name, so nothing is announced twice.
			 *
			 * Two lines past `LARGE_TEXT_SCALE`: on its own full-width line the longest
			 * outcome copy ("Didn't catch that — try again.", 369 pt at 200 %) fits two,
			 * where beside the controls it clipped to `Didn't catch that — tr…` (D3). */
			<Text
				role={ROLE.status}
				accessibilityLiveRegion={LIVE_REGION.polite}
				numberOfLines={dictationLargeText ? 2 : 1}
				className={cx(
					"text-body-sm",
					rowIsLive(voice.phase) ? "text-danger" : "text-ink-muted",
				)}
				testID={SURFACE.composerDictationStatus}
			>
				{voice.status}
			</Text>
		);
	const dictationControls =
		voice === null ? null : (
			<>
				{voice.phase === "recording" ? (
					<DictationMeter
						meter={voice.meter}
						testID={SURFACE.composerDictationMeter}
					/>
				) : null}
				{voice.phase === "recording" ? (
					<Text
						className="text-mono-sm text-ink-muted"
						// A stable width so the row does not reflow as the clock advances — and
						// SCALED, because an unscaled 34 pt slot is narrower than `0:00` at 200 %
						// and the timer wraps `0:0` over `0`, growing the row to 71.6 pt against 50
						// (design round 1, D1). `numberOfLines={1}` stops the wrap outright.
						numberOfLines={1}
						style={{
							minWidth: Math.round(34 * effectiveScale),
							textAlign: Platform.OS === "web" && rtl ? "left" : "right",
						}}
						testID={SURFACE.composerDictationTimer}
					>
						{formatDuration(voice.seconds)}
					</Text>
				) : null}
				{/* The reader's own DISCARD: it stops the take and sends no request at all,
				    which is a different outcome from the mic (stop AND transcribe). Shown
				    while a dictation is live only — an outcome line has nothing to cancel.

				    The VISIBLE word is `Discard`, not `Cancel`, for exactly that reason
				    (design round 1, D6): the mic beside it morphs to a Square that STOPS AND
				    TRANSCRIBES, and "Cancel" reads as "stop", so the two adjacent controls
				    promised the same thing while doing different ones. `Discard` names the
				    throw-away, and it now matches the accessible name. */}
				{rowIsLive(voice.phase) ? (
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityLabel="Discard voice input"
						onPress={voice.cancel}
						style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
						className="items-center justify-center"
						testID={CONTROL.composerDictationCancel}
					>
						<Text className="text-body-sm text-ink-muted">Discard</Text>
					</Pressable>
				) : null}
			</>
		);

	/* The compact budget, spent in order of what must never leave the screen: the receipt
	 *  line (chips), then the field's one-line floor, then whatever is left is the field's
	 *  growth, and the extras scroller gets the rest. `compact.maxHeight` is the whole
	 *  composer's share of the window (`COMPACT_COMPOSER_SHARE`). */
	const [receiptHeight, setReceiptHeight] = useState(48);
	/* Measure this dock's width (not the whole window) for compact split fit. */
	const [metaWidth, setMetaWidth] = useState(0);
	const _window = useWindowDimensions();
	const [focused, setFocused] = useState(false);
	const [keyboardVisible, setKeyboardVisible] = useState(false);
	const [contextOpen, setContextOpen] = useState(false);
	const ownField = useRef<TextInput>(null);
	const inputRef = fieldRef ?? ownField;
	const reducedMotion = useReducedMotion();
	const elevated = useTokenColor("elevated");
	/* The shell's ONLY boundary. `elevated` over `canvas` is a fill step of
	 *  1.1244–1.2799:1 across all 59 themes — below the 3:1 a boundary owes, and
	 *  thinnest at the near-white end, where a card delimited by its fill alone
	 *  reads as unframed. `border-control` is the kit's token for a field's
	 *  boundary on a plain ground: 3.132–5.924:1 against `canvas` in every theme.
	 *  The reasoning is in `docs/design/components.md` § 5 and § 12. */
	const borderControl = useTokenColor("border-control");
	const progress = useSharedValue(0);
	const keyboardOffset = useSharedValue(0);
	const keyboardDuration = useRef(200);
	const presentation = composerPresentation({
		focused,
		draft,
		attachments: images.length,
		dictation: !!voice && (rowIsLive(voice.phase) || voice.status !== ""),
		stop: controls.stopVisible,
		error: !!error || !!retainedMessage || !!notice,
		keyboard: keyboardVisible,
		inset: bottomInset ?? 0,
		scale: effectiveScale,
		/* The composer paints on the platform's touch floor, so its presentation
		 *  must be computed on the same floor or the radius disagrees with the box
		 *  (28 announced over a 30 pt paint). */
		floor: TOUCH_FLOOR,
	});
	/* One keyboard owner. Android's resized window already ends at keyboard top:
	 * overlap is then zero. iOS follows the native frame/duration, not a second
	 * keyboardDidShow correction; safe-area clearance belongs OUTSIDE the shell. */
	useEffect(() => {
		if (Platform.OS === "web") return;
		const frame = (event: KeyboardEvent) => {
			keyboardDuration.current = event.duration || 200;
			const overlap = keyboardOverlap(
				Dimensions.get("window").height,
				event.endCoordinates.screenY,
			);
			keyboardOffset.value = withTiming(overlap, {
				duration: event.duration || 200,
			});
			if (overlap > 0 || event.endCoordinates.height > 0)
				setKeyboardVisible(true);
		};
		const subs = [
			Keyboard.addListener(
				Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
				frame,
			),
			Keyboard.addListener("keyboardDidHide", () => {
				setKeyboardVisible(false);
				keyboardOffset.value = 0;
			}),
		];
		return () => {
			for (const sub of subs) sub.remove();
		};
	}, [keyboardOffset]);
	useEffect(() => {
		progress.value = withTiming(presentation.expanded ? 1 : 0, {
			duration: reducedMotion
				? 0
				: keyboardVisible
					? keyboardDuration.current
					: 200,
		});
	}, [presentation.expanded, reducedMotion, keyboardVisible, progress]);
	useEffect(() => {
		onEditingChange?.(presentation.expanded);
	}, [presentation.expanded, onEditingChange]);
	/* Physical orientation is supplied by the caller, not the keyboard-shortened
	 * window. Narrow splits retain two rows rather than clipping a control. */
	const compactSingle =
		compact !== null &&
		metaWidth >=
			80 +
				5 * TOUCH_FLOOR +
				(voice?.micVisible ? TOUCH_FLOOR : 0) +
				(controls.stopVisible ? TOUCH_FLOOR : 0) +
				24;
	/* THE PAINTED BASE, measured. The pill's radius is half the pill the platform
	 * actually paints (iOS 56/R28, web and Android 60/R30 on the 48 floor), not
	 * half a constant: the 24/28 pair is a JOINT rule, so a radius derived from a
	 * number the box does not paint is a shape nobody sees. The CONTENT block is
	 * the ruler; the shell cannot measure itself (see `measureContent`). */
	/* The extras' natural height, for the ceiling budget only: the morph's ends
	 *  come from one measured content block that already contains them, so adding
	 *  this to a total again would count them twice. */
	const [extrasHeight, setExtrasHeight] = useState(0);
	/* The record's paddings, settled per state: they are part of its sums
	 *  (6 + h + 6 standing, 12 + h + 4 + h + 8 open) and never a second clock. */
	const shellBox = {
		paddingTop: compactSingle ? 6 : presentation.expanded ? 12 : 6,
		paddingBottom: compactSingle ? 6 : presentation.expanded ? 8 : 6,
	};
	/* Measurement, in one place, and ONE seed per state. A single seed cannot
	 *  describe a morph: while expanded the content column is the EXPANDED height,
	 *  so reusing it as the collapsed end gave `interpolate([120, 120])` — corners
	 *  travelled and the box did not, which is exactly the asymmetry the design
	 *  round measured. Each end is captured while ITS state is mounted. */
	const [collapsedSeed, setCollapsedSeed] = useState<number | null>(null);
	const [expandedSeed, setExpandedSeed] = useState<number | null>(null);
	const measureContent = (event: LayoutChangeEvent) => {
		/* `Math.ceil`, not `Math.round`: half a point of rounding at rest is a clip
		 *  the moment the shell is allowed to hide overflow, and the content below
		 *  the true height is exactly what would disappear. */
		const height = Math.ceil(event.nativeEvent.layout.height);
		if (height <= 0) return;
		const seed = seedFor(
			presentation.expanded,
			height + shellBox.paddingTop + shellBox.paddingBottom,
		);
		if (seed.kind === "expanded") {
			if (seed.total !== expandedSeed) setExpandedSeed(seed.total);
		} else if (seed.total !== collapsedSeed) {
			/* No `compactSingle` guard: short landscape is a pill like any other, and
			 *  skipping its measurement left the seeded 56/60 in place while the
			 *  content grew past it — clipped by the overflow rule below (R7-1). */
			setCollapsedSeed(seed.total);
		}
	};
	/* The first frame must not paint a radius the pill does not have: the field's
	 *  box IS the platform's touch floor, so the seeded ends are the record's own
	 *  sums at that floor (56/112 on iOS, 60/120 on the 48 floor). */
	const seededBase = composerPaintedHeight(false, TOUCH_FLOOR);
	const seededExpanded = composerPaintedHeight(true, TOUCH_FLOOR);
	/* A measured pill can be SMALLER than the floor's own sum (a scale that renders
	 *  a shorter field), and honouring that would shrink the shell under its own
	 *  content; the floor wins, so the box never clips what it holds. */
	const baseHeight = Math.max(seededBase, collapsedSeed ?? 0);
	const targetExpanded = Math.max(expandedSeed ?? seededExpanded, baseHeight);
	const shellMotion = useAnimatedStyle(() => ({
		/* One rule in every state, landscape included: the radius is half the pill
		 *  the shell paints, and 24 when expanded. A landscape pill that kept the
		 *  portrait 24 was measuring the wrong thing. */
		borderRadius: composerShellRadius(progress.value, baseHeight),
		height: morphHeight(progress.value, baseHeight, targetExpanded),
	}));
	/* The ring's radius is the shell's own, from the same helper: it is drawn on the
	 *  shell's edge, not inset inside it, so any other value is a second outline. */
	const ringMotion = useAnimatedStyle(() => ({
		borderRadius: composerShellRadius(progress.value, baseHeight),
	}));
	/* Overflow is hidden only while the box is between its two ends; at rest the
	 *  content and the box agree, so hiding would be a clip waiting for half a
	 *  point of rounding. Read off the shared value itself rather than a timer
	 *  racing the animation: 0 and 1 are the ends, anything between is travel. */
	const [morphing, setMorphing] = useState(false);
	useAnimatedReaction(
		() => progress.value > 0 && progress.value < 1,
		(travelling, previous) => {
			if (travelling !== previous) runOnJS(setMorphing)(travelling);
		},
	);

	const dockMotion = useAnimatedStyle(() => ({
		marginBottom:
			keyboardOffset.value +
			(keyboardVisible ? 8 : Math.max(0, bottomInset ?? 0) + 8),
	}));

	const dangerInk = useTokenColor("danger");
	const attachInk = useTokenColor("ink-muted");
	/* The extras' natural height, from the scroller's own content size, so the budget can
	 *  give them what they need and no more. */

	const COMPOSER_PAD = 8;
	/* The same condition the row itself renders under, so the reserve and the row cannot
	 *  disagree. `mb-2` is its bottom margin. */
	const dictationShowing =
		voice?.micVisible === true &&
		(rowIsLive(voice.phase) || voice.status !== "");
	const DICTATION_ROW_MARGIN_PX = 8;
	/* The vertical padding the root actually paints: `pt-1 pb-1` in the short-landscape
	 *  form, and `pt-2` plus the inset-paying bottom padding everywhere else. The
	 *  budget spends what the box paints. */
	const composerPad = compact === null ? 20 : COMPOSER_PAD;
	/* What sits under the field and never scrolls: the controls row, plus the meta
	 *  line when it has its own row. With the keyboard up it only rides inline
	 *  when model + effort targets fit; otherwise reserve the separate row too. */
	const fixedRows = compactSingle ? 0 : TOUCH_FLOOR + receiptHeight + 4;
	const rawBound = compact === null ? limit : compact.maxHeight;
	const bound =
		rawBound === null
			? null
			: Math.max(TOUCH_FLOOR, rawBound - presentation.gap);
	const budget =
		bound === null
			? null
			: composerBudget(
					bound,
					fixedRows,
					extrasHeight,
					TOUCH_FLOOR,
					composerPad,
					dictationShowing
						? dictationRowBox(effectiveScale) + DICTATION_ROW_MARGIN_PX
						: 0,
				);
	const fieldMaxHeight = budget?.field;
	const extrasMaxHeight = budget?.extras;

	/* The window-coordinate top of the composer, for the portrait ceiling. `react-
	 *  native-web` implements `measureInWindow` on the host node; native resolves it
	 *  asynchronously, which is why this only publishes a number and never gates the
	 *  first paint (a `null` top means "no limit" — the old behaviour — for a frame). */
	const publishBox = useCallback(() => {
		if (!onMeasure) return;
		/* On the web the host node answers directly: `measureInWindow` there returns
		 *  a CACHED layout, so after the draft grew the screen kept reading the empty
		 *  composer's box (top 335, height 225 — "fits") and the ceiling never bound
		 *  ([redacted]: bound "none" at a bottom of 739 in a 568 pt window). Native
		 *  keeps the platform call, which is live and asynchronous. */
		const node = rootRef.current as unknown as {
			getBoundingClientRect?: () => DOMRect;
		} | null;
		const rect = node?.getBoundingClientRect?.();
		if (rect) {
			onMeasure({ top: Math.round(rect.top), height: Math.round(rect.height) });
			return;
		}
		rootRef.current?.measureInWindow((_x, y, _w, h) =>
			onMeasure({ top: Math.round(y), height: Math.round(h) }),
		);
	}, [onMeasure]);
	/* One string, because the effect must run when ANY of these moves the composer —
	 *  the receipt wrapping, the extras, the scale, the mode, the dictation row — or
	 *  when the screen says the chrome above it changed. Listing them as separate
	 *  dependencies is what the lint rule objects to, and a stale top is how the
	 *  ceiling stops matching the column. */
	const measurementKey = `${measureKey}|${receiptHeight}|${extrasHeight}|${effectiveScale}|${compact === null ? "tall" : "compact"}|${dictationShowing ? "dictation" : ""}`;
	useEffect(() => {
		/* `measurementKey` is READ here only to make it the dependency it is: the
		 *  effect's whole purpose is to re-measure when the key changes (find bar,
		 *  panels, pending card, receipt wrap, extras, scale, mode), and none of
		 *  those values is an input to the measurement itself. Removing it — what
		 *  the unsafe quick-fix offers — is the stale-top defect this exists to
		 *  avoid, so it is referenced rather than suppressed. */
		if (measurementKey === "") return;
		publishBox();
	}, [publishBox, measurementKey]);

	/* TWO fragments, one scroll owner. `extras` is everything ABOVE the field —
	 *  attachments, the retained-instruction alert, the error, the disabled reason — and
	 *  is the ONLY part that may scroll in the compact form. `main` is the field row, the
	 *  dictation row, the receipt line (queued count + model/effort chips) and the
	 *  sheets: it is never inside a scroller, so Attach, Send, Stop and both chips stay on
	 *  screen however long the draft is (UX U1: with everything in one scroller a 3-line
	 *  draft at 200 % pushed Send off a 390 pt screen). The FIELD scrolls itself, capped
	 *  by `fieldMaxHeight` below. */
	const extras = (
		<>
			<ComposerStateMarkers controls={controls} />
			{/* Attachments, above the field: an attachment changes what send means, so it
			    is read before the control that is pressed. */}
			{images.length > 0 ? (
				<View className="pb-2">
					<ScrollView horizontal showsHorizontalScrollIndicator={false}>
						<View className="flex-row gap-1.5">
							{images.map((image, index) => (
								<View key={`${index}-${image.mime_type}`} className="relative">
									{/* The thumbnail is NOT the control. A tap on the image used to remove it
									    with nothing visible saying so — a thumb reaching to preview silently
									    deleted the attachment, and no glyph, badge or word marked the image as
									    a button (design round 1, D58-1). Removal now lives on the badge
									    below, the only control on this chip. */}
									<View className="overflow-hidden rounded-sm border border-border-control">
										<Image
											source={{
												uri: `data:${image.mime_type};base64,${image.data_b64}`,
											}}
											style={{ width: 64, height: 64, resizeMode: "cover" }}
											accessibilityLabel={`Attachment ${index + 1}`}
										/>
									</View>
									{/* The one removal affordance: a visible ✕ badge with a real accessible
									    name (glyph, never colour alone) and a 44 pt hit area on the
									    pressable — the shape the audit measures, the same one `IconButton`
									    uses. The badge is opaque (`elevated` fill, `border-control` edge,
									    `ink` glyph) so its contrast holds over ANY photo underneath. */}
									<Pressable
										accessibilityRole={ROLE.button}
										accessibilityLabel={`Remove attachment ${index + 1}`}
										onPress={() => onRemoveImage(index)}
										testID={composerAttachmentId(index)}
										style={{
											position: "absolute",
											top: 0,
											/* The removal badge sits on the attachment's trailing corner: `end`
											 *  keeps it over the same corner when the layout direction flips. */
											end: 0,
											width: TOUCH_FLOOR,
											height: TOUCH_FLOOR,
											alignItems: "flex-end",
										}}
									>
										<View className="m-0.5 h-5 w-5 items-center justify-center rounded-full border border-border-control bg-elevated">
											<X color={removeInk} size={12} />
										</View>
									</Pressable>
								</View>
							))}
						</View>
					</ScrollView>
					{/* The metadata is visible BEFORE send: the reader is told what is going,
					    and how big, rather than finding out from a refusal. */}
					<Text className="pt-1 text-meta text-ink-dim" numberOfLines={1}>
						{attachmentSummary}
					</Text>
				</View>
			) : null}

			{/* The resume affordance. Exactly ONE on the screen, and only for a turn that
			    was aborted — a completed turn also stops streaming, and offering to
			    "resume" a finished conversation is a control with no meaning. */}
			{showResume && !ended ? (
				<View className="pb-2">
					<Button
						label={composerCopy().resumeLabel}
						variant="outline"
						size="sm"
						onPress={onResume}
						testID={CONTROL.composerResume}
					/>
				</View>
			) : null}

			{notice !== null ? (
				<View className="pb-2 rounded-sm border border-success-border bg-success-wash px-3 py-2">
					<Text
						className="text-body-sm text-success"
						accessibilityLiveRegion="polite"
						testID={SURFACE.composerNotice}
					>
						{notice}
					</Text>
				</View>
			) : null}

			{/* While a send to an ENDED session is in flight, say that it is a reopen
			    and that it takes seconds (UX round 1, U2): the button's "…" alone
			    looked like a stuck send for the length of the daemon's engage. */}
			{ended && controls.sending ? (
				<Text
					className="pb-2 text-meta text-ink-dim"
					accessibilityLiveRegion="polite"
					testID={SURFACE.composerReopening}
				>
					{composerCopy().reopening}
				</Text>
			) : null}

			{retainedMessage !== null ? (
				<View className="mb-2 rounded-sm border border-danger-border bg-danger-wash px-3 py-2">
					<Text
						className="text-body-sm text-danger"
						accessibilityRole={ROLE.alert}
						accessibilityLiveRegion="assertive"
						testID={SURFACE.composerRetained}
					>
						{/* ONE message on an ended session (UX U7, design D5): a failed
						    reopen used to stack the generic "an earlier instruction may
						    have been delivered" card, the ended sentence and a disabled
						    hint — three remedies, one of them pointing at a send button
						    the screen had just disabled. The ended sentence REPLACES the
						    card's, and its Retry stays the one retry. */}
						{ended && error !== null ? error : retainedMessage}
					</Text>
					<View className="pt-2">
						<Button
							/* On an ENDED session the card's sentence is the ended one, whose
							 * verb is "Try again" — so the button under it must say that,
							 * not "Retry earlier instruction" about the very text sitting
							 * in the field. The primary stays disabled while the envelope
							 * is unresolved (the duplicate hazard), so the retry is THE
							 * way to try again and the copy now names it (UX round 2, U7 /
							 * design D5). One control, one verb. */
							label={
								ended && error !== null
									? composerCopy().endedRetryLabel
									: composerCopy().retryLabel
							}
							variant="outline"
							size="sm"
							onPress={onRetry}
							testID={CONTROL.composerRetry}
						/>
					</View>
				</View>
			) : null}

			{error !== null && !(ended && retainedMessage !== null) ? (
				<View className="mb-2 rounded-sm border border-danger-border bg-danger-wash px-3 py-2">
					<Text
						className="text-body-sm text-danger"
						accessibilityLiveRegion="assertive"
						testID={SURFACE.composerError}
					>
						{error}
					</Text>
				</View>
			) : null}

			{/* U4: name why the primary is dead, whatever the reason — an unresolved
			    instruction or a session that has ended — so a disabled ↑ reads as
			    intentional rather than as a broken button. The sentence is the
			    projection's, and this is the only place it is rendered. */}
			{controls.disabledReason !== null &&
			presentation.expanded &&
			!suppressDisabledHint ? (
				<Text
					className="pb-1 text-meta text-ink-muted"
					testID={SURFACE.composerDisabledReason}
				>
					{controls.disabledReason}
				</Text>
			) : null}
		</>
	);

	/* The permanent context strip is outside the shell. No keyboard-dependent
	 * reparenting or first-frame facts ladder: model and effort always retain a
	 * target; optional facts are disclosed via More. */
	const receipt = (
		<View
			className={COMPOSER_META_ROW}
			testID={SURFACE.composerMeta}
			onLayout={(event) => {
				setReceiptHeight(Math.ceil(event.nativeEvent.layout.height));
				setMetaWidth(event.nativeEvent.layout.width);
			}}
		>
			<View className="min-w-0 flex-1" style={{ minWidth: MODEL_FLOOR_PT }}>
				<ComposerChipButton
					chip={modelChip}
					onPress={onOpenModels}
					chooseHint="Choose the model"
					loadingWidthClassName="w-24"
					testID={CONTROL.composerModelChip}
				/>
			</View>
			{effortChip ? (
				<View className="shrink" style={{ minWidth: MODEL_FLOOR_PT }}>
					<ComposerChipButton
						chip={effortChip}
						onPress={onOpenEffort}
						chooseHint="Choose the effort"
						loadingWidthClassName="w-7"
						testID={CONTROL.composerEffortChip}
					/>
				</View>
			) : null}
			<IconButton
				accessibilityLabel={
					queuedCount > 0
						? `${t("mobile.chrome.composer.more")}, ${t("mobile.chrome.composer.queued", { count: queuedCount })}`
						: t("mobile.chrome.composer.more")
				}
				onPress={() => setContextOpen(true)}
				icon={({ color, size }) => <MoreHorizontal color={color} size={size} />}
				testID={CONTROL.composerContext}
			/>
			{/* VISIBLE, not just announced (round 4 reviewer MAJOR): a queue the
			 *  reader cannot see is a queue they cannot trust. The chip opens More,
			 *  which lists the count and — where the surface can open the queue —
			 *  the way in; it is never a disabled control. */}
			{queuedCount > 0 ? (
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={t("mobile.chrome.composer.queued", {
						count: queuedCount,
					})}
					onPress={() => setContextOpen(true)}
					/* Bounded width is the point (UX round 5, U2): an unconstrained
					 *  label at 200 % text pushed the dismiss control past the 390 pt
					 *  edge. The sentence stays on the accessibility label; the visible
					 *  text falls back to the bare count when the type is large. */
					style={{
						minWidth: TOUCH_FLOOR,
						maxWidth: 160,
						flexShrink: 1,
					}}
					className="items-center justify-center px-1"
					testID={SURFACE.queuedMessageChip}
				>
					<Text className="text-meta text-ink-dim" numberOfLines={1}>
						{dictationLargeText
							? String(queuedCount)
							: t("mobile.chrome.composer.queued", { count: queuedCount })}
					</Text>
				</Pressable>
			) : null}
			{keyboardVisible || focused ? (
				<IconButton
					accessibilityLabel={t("mobile.chrome.composer.dismiss_keyboard")}
					onPress={() => {
						inputRef.current?.blur();
						Keyboard.dismiss();
					}}
					icon={({ color, size }) => <KeyboardIcon color={color} size={size} />}
					testID={CONTROL.composerDismissKeyboard}
				/>
			) : null}
		</View>
	);

	/* U3: short landscape used to collapse the strip to zero height, which took
	 *  the queued count and the only context route with it. The compact row keeps
	 *  exactly what the record requires in that state — the queue's presence and
	 *  the way into More — and drops the model/effort chips to More's own list,
	 *  because a 44 pt row cannot hold them at 200 % text. */
	const compactReceipt = (
		<View
			className={COMPOSER_META_ROW}
			testID={SURFACE.composerMeta}
			onLayout={(event) => {
				setReceiptHeight(Math.ceil(event.nativeEvent.layout.height));
				setMetaWidth(Math.ceil(event.nativeEvent.layout.width));
			}}
		>
			{queuedCount > 0 ? (
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={t("mobile.chrome.composer.queued", {
						count: queuedCount,
					})}
					onPress={() => setContextOpen(true)}
					/* Bounded width is the point (UX round 5, U2): an unconstrained
					 *  label at 200 % text pushed the dismiss control past the 390 pt
					 *  edge. The sentence stays on the accessibility label; the visible
					 *  text falls back to the bare count when the type is large. */
					style={{
						minWidth: TOUCH_FLOOR,
						maxWidth: 160,
						flexShrink: 1,
					}}
					className="items-center justify-center px-1"
					testID={SURFACE.queuedMessageChip}
				>
					<Text className="text-meta text-ink-dim" numberOfLines={1}>
						{dictationLargeText
							? String(queuedCount)
							: t("mobile.chrome.composer.queued", { count: queuedCount })}
					</Text>
				</Pressable>
			) : null}
			<IconButton
				accessibilityLabel={
					queuedCount > 0
						? `${t("mobile.chrome.composer.more")}, ${t("mobile.chrome.composer.queued", { count: queuedCount })}`
						: t("mobile.chrome.composer.more")
				}
				onPress={() => setContextOpen(true)}
				icon={({ color, size }) => <MoreHorizontal color={color} size={size} />}
				testID={CONTROL.composerContext}
			/>
		</View>
	);

	/* ---- row 2: the controls ---------------------------------------------
	 *  `[attach] [mic] … [stop] [send]`, one 44 pt line. A control here no longer
	 *  costs the field its width — the field is its own row above — which was the
	 *  only reason the mic had been exiled to the meta line (design round 1,
	 *  D1/D2 of the earlier composer). */
	const mic = voice?.micVisible ? (
		/* The voice mic: shown only when the relay says voice input can run here
		 * AND this build can record (`voice.micVisible`). Absence of
		 * `capabilities.stt` is unavailable, so an older relay never renders it. */
		<IconButton
			accessibilityLabel={micLabel(voice.phase)}
			accessibilityHint={MIC_HINT[voice.phase]}
			disabled={voice.phase === "transcribing"}
			onPress={voice.press}
			icon={({ color, size }) =>
				voice.phase === "recording" ? (
					<Square color={color} size={size} />
				) : (
					<Mic color={color} size={size} />
				)
			}
			testID={CONTROL.composerMic}
		/>
	) : null;
	const attach = (
		<Pressable
			style={{ minWidth: TOUCH_FLOOR, minHeight: TOUCH_FLOOR }}
			className="items-center justify-center"
			accessibilityRole={ROLE.button}
			accessibilityLabel="Attach an image"
			accessibilityState={state({ busy: attaching, disabled: attaching })}
			disabled={attaching}
			/* Explicit reopen is the only re-admission point for a fresh choice;
			 *  a stale latch from the previous open must not survive it. */
			onPress={() => {
				attachmentHandoff.cancel();
				setAttachSheetOpen(true);
			}}
			testID={CONTROL.composerAttach}
		>
			<View className={COMPOSER_DISC}>
				{/* A 20 pt paperclip, the relay's glyph (D-H5): the "＋" text glyph it
				 *  replaces read weak beside a 44 pt send disc. The label a reader hears
				 *  is the button's own ("Attach an image"). */}
				<Paperclip size={ATTACH_GLYPH_PT} color={attachInk} aria-hidden />
			</View>
		</Pressable>
	);
	const actionCluster = (
		<View className={COMPOSER_ACTION_CLUSTER}>
			{controls.stopVisible ? (
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel="Stop the running turn"
					style={{ minWidth: TOUCH_FLOOR, minHeight: TOUCH_FLOOR }}
					onPress={onStop}
					testID={CONTROL.composerStop}
				>
					{/* A 44 pt `danger-wash` DISC, 2 pt from send (D-S5, the relay's stop):
					 *  the bare "■" glyph floated ~30 pt from send and read as decoration.
					 *  The wash is quiet enough not to compete with the accent send disc. */}
					<View className={cx(COMPOSER_DISC, "bg-danger-wash")}>
						<Square size={14} color={dangerInk} fill={dangerInk} aria-hidden />
					</View>
				</Pressable>
			) : null}
			{/* The width is PINNED, whatever the label: a control that grows when it
			    morphs moves everything after it, which on a phone means it moves under
			    the thumb about to press it. */}
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={controls.primary.accessibilityLabel}
				style={{ minWidth: TOUCH_FLOOR, minHeight: TOUCH_FLOOR }}
				accessibilityState={state({
					disabled: controls.primary.disabled,
					busy: controls.sending,
				})}
				disabled={controls.primary.disabled}
				onPress={onSend}
				testID={CONTROL.composerSend}
			>
				<View
					className={cx(
						COMPOSER_DISC,
						controls.primary.disabled ? "bg-sunken" : "bg-accent",
					)}
				>
					{/* The disabled ink is the kit's own constant, not a local choice: this
				    control is the only one in the app that hand-rolls the primary's
				    disabled treatment instead of going through `Button`, and it was the
				    one place still painting a disabled label in `ink-disabled` — 2.42:1 on
				    `sunken` in light, 2.50:1 in dark. WCAG exempts that (SC 1.4.3, an
				    inactive control), so this was not a conformance failure but the kit's
				    own stricter rule being missed: a label NAMES the action, so
				    `CONTROL_DISABLED_INK` is `ink-dim` and `variants.test.ts` pins it. That
				    is 5.02:1 light, 6.59:1 dark. */}
					<Text
						className={cx(
							"text-body-sm font-medium",
							controls.primary.disabled
								? CONTROL_DISABLED_INK
								: "text-on-accent",
						)}
					>
						{controls.primary.label}
					</Text>
				</View>
			</Pressable>
		</View>
	);

	/* The dictation row (design §2.5): a line that SPANS the composer, holding
	    one height across recording, transcribing and the three outcome states, so
			    stopping a recording does not move the line (D3).

			    It is a ROW rather than the previous button-morph alone because a 44 pt
			    button swap did not read as "the composer is recording" — a reader had to
			    find the morph to know. The span is the state: a full-width bar with a live
			    level meter, the word, and the elapsed time.

			    The meter is `flex-1`, so it takes whatever the word, the clock and the
			    cancel do not: that is what makes the peaks SPAN rather than sit in a corner.

			    It sits directly UNDER the field and OVER the controls row: under the field
			    because that is the thing it appends to (and the mic that runs it is one row
			    further down, on the controls row), and never OVER it — defect 1 was that the
			    draft could not be read while a recording was live, so nothing here masks,
			    dims or disables the field, which keeps its own height, content and
			    editability for the whole take.

			    TWO layouts, one box height. At 100 % everything shares one line. Past
			    `LARGE_TEXT_SCALE` the status takes its own full-width line and the controls
			    take the next: side by side, the status was squeezed to ~99 pt and clipped
			    (`Recor…`, `Didn't catch that — tr…`, D3) and the meter's flex bars collapsed
			    to 0.0 px (D2). The box is fixed rather than content-sized so a one-line
			    outcome does not shrink the row below the two-line states — the jump the
			    design round measured (D1). */
	const dictationRow =
		voice?.micVisible && (rowIsLive(voice.phase) || voice.status !== "") ? (
			<View
				className={cx(
					"mb-2 rounded-sm border px-3",
					dictationLargeText
						? "flex-col items-stretch justify-center gap-2"
						: "flex-row items-center gap-2",
					rowIsLive(voice.phase)
						? "border-danger-border bg-danger-wash"
						: "border-hairline",
				)}
				// One height for every state the row can show (D3). At the default scale it
				// is the touch floor plus the row's border; past `LARGE_TEXT_SCALE` it is the
				// row's own two-line sum, so neither the meter nor a short outcome sets it.
				style={{ minHeight: dictationRowBox(effectiveScale) }}
				testID={SURFACE.composerDictationBar}
			>
				{dictationLargeText ? (
					<>
						{dictationStatus}
						<View className="flex-row items-center gap-2">
							{dictationDot}
							{dictationControls}
						</View>
					</>
				) : (
					<>
						{dictationDot}
						{dictationStatus}
						{dictationControls}
					</>
				)}
			</View>
		) : null;

	/* One attach sheet instance, rendered once by the shell: the dock's two rows
	 *  are layout, so the sheet must not be mounted twice. */
	const attachSheet = (
		<Sheet
			visible={attachSheetOpen}
			onClose={() => setAttachSheetOpen(false)}
			onDismiss={attachmentHandoff.dismissed}
			/* The ratchet's own entry for this file is lower-case "attach": the
			 * title is pre-existing debt, and capitalising it minted a NEW literal
			 * that failed `check-strings`. Keying it is the payoff, not this fix. */
			title="attach"
			testID={SURFACE.attachSheet}
		>
			<View className="py-1">
				{attachActions(Platform.OS === "web" ? "web" : "native").map(
					(action) => (
						<Pressable
							key={action.source}
							accessibilityRole={ROLE.button}
							accessibilityLabel={action.label}
							onPress={() => {
								/* Closed first: the picker opens over a dismissed sheet, never
								 *  under one — a system picker presented from behind a modal is
								 *  how a cancel lands back on a sheet nobody reopened. */
								setAttachSheetOpen(false);
								// The handoff waits for native dismissal; state alone is not that acknowledgement.
								attachmentHandoff.choose(
									() => onAttach(action.source),
									Platform.OS,
								);
							}}
							testID={attachOptionId(action.source)}
						>
							<View className="min-h-11 flex-row items-center px-3">
								<Text className="text-body-sm text-ink">{action.label}</Text>
							</View>
						</Pressable>
					),
				)}
			</View>
		</Sheet>
	);

	const main = (
		<>
			{/* TWO ROWS IN FLOW, never pinned over each other (round 4, U1/U2/U3).
			 *  A collapsed dock is ONE row — attach · field · trailing — and an
			 *  expanded dock is the field's row plus the controls row, as normal
			 *  siblings. The overlay this replaces put an absolutely positioned
			 *  controls layer across the whole band: it painted a 44 pt dead strip
			 *  under the field, and it swallowed every tap on the field, so the
			 *  reader could not even reach the keyboard. In flow, the field is the
			 *  frontmost thing in its own row and a tap lands on it. */}
			<View
				className="flex-row items-end"
				style={{ minHeight: COMPOSER_FIELD_BOX }}
			>
				{presentation.expanded ? null : attach}
				<View className="min-w-0 flex-1">
					<Textarea
						label="Message"
						hideLabel
						integrated
						value={draft}
						onChangeText={onDraftChange}
						placeholder={
							ended
								? composerCopy().endedPlaceholder
								: composerCopy().placeholder
						}
						maxLines={compactSingle ? 1 : 6}
						/* The field's own box is the dock's ruler: 44 pt in both rows,
						 * so 56 = 6 + 44 + 6 and 112 = 12 + 44 + 4 + 44 + 8 hold
						 * whatever the platform adds around the text box (a web
						 * `<textarea>` measured 48 before `border-box`). Past the
						 * budget the field scrolls itself and the dock stops growing. */
						maxHeightPx={fieldMaxHeight ?? undefined}
						/* One line of placeholder, always (§2.5 D1): the field's resting height
						 * must not grow with a wrapped placeholder, or the last transcript row is
						 * pushed past the scroller at 200 % text (design round 1, D1/D2). */
						placeholderMaxLines={1}
						// Kept because it is the callback a hardware keyboard submits
						// through, and it costs nothing — but see the note above: on this RN
						// version a multiline field never dispatches it. Native is NOT RUN
						// here, so this records the gap rather than a behaviour.
						onSubmitEditing={onSend}
						fieldRef={inputRef}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						testID={CONTROL.composerInput}
					/>
				</View>
				{presentation.expanded ? null : (
					<View className="flex-row items-center">{mic ?? actionCluster}</View>
				)}
			</View>
			{dictationRow}
			{presentation.expanded ? (
				<View
					className={COMPOSER_CONTROLS_ROW}
					style={{ marginTop: COMPOSER_CONTROLS_GAP }}
					testID={SURFACE.composerControls}
				>
					{attach}
					{mic}
					{/* Landscape has exactly ONE context affordance, and it is the one
					 *  in the compact strip: a second More on this row was the same
					 *  action twice in one 44 pt line (design round 6, D2). */}
					{actionCluster}
					{compactSingle && keyboardVisible ? (
						<IconButton
							accessibilityLabel={t("mobile.chrome.composer.dismiss_keyboard")}
							onPress={() => {
								inputRef.current?.blur();
								Keyboard.dismiss();
							}}
							icon={({ color, size }) => (
								<KeyboardIcon color={color} size={size} />
							)}
							testID={CONTROL.composerCompactDismiss}
						/>
					) : null}
				</View>
			) : null}
			{/* The receipt anchor `08-connection-loss-recovery` asserts after a send
			    across a reconnect: it is the composer's own "the instruction left" mark. */}
			<View testID={SURFACE.composerReceipt} aria-hidden />
			{slashQuery !== null ? slashSheet : null}
		</>
	);

	/* The dock is measured as one unit (context + shell + external clearance), so
	 * the transcript reserves the full footprint. Opaque is the baseline until
	 * composited native glass contrast is independently proved for this shape. */
	return (
		<Animated.View
			ref={rootRef}
			style={[{ marginHorizontal: 12 }, dockMotion]}
			onLayout={(event) => {
				onLayout?.(event);
				publishBox();
			}}
			testID={testID}
		>
			{compactSingle ? compactReceipt : receipt}
			<Animated.View
				style={[
					{
						backgroundColor: elevated,
						/* The record's paddings, interpolated with the same progress
						 * value as the shape: 6/6 at rest (6 + 44 + 6 = 56) and 12/8
						 * expanded (12 + 44 + 4 + 44 + 8 = 112). `composerPaintedHeight`
						 * is the one place those sums are written down. */
						...shellBox,
						/* The box travels between two measured ends, so for part of
						 *  the morph it is shorter than the content it holds. Clipping
						 *  there is the card's own edge; spilling painted controls
						 *  outside the card, which is what the design round saw. */
						overflow: "hidden",
						paddingHorizontal: 12,
						marginTop: compactSingle ? 0 : 4,
					},
					shellMotion,
				]}
			>
				<View onLayout={measureContent}>
					<ScrollView
						style={{ flexGrow: 0, flexShrink: 0, maxHeight: extrasMaxHeight }}
						scrollEnabled={compact !== null}
						onContentSizeChange={(_width, height) =>
							setExtrasHeight(Math.round(height))
						}
						nestedScrollEnabled
						keyboardShouldPersistTaps="handled"
					>
						{extras}
					</ScrollView>
					{main}
				</View>
				{/* THE SHELL'S EDGE, drawn as an absolutely positioned child rather than a
				 *  `borderWidth` on the shell. The shell's height is a border box, so a border
				 *  there takes 1 pt off each edge of the interior: the 44 pt field paints 42,
				 *  under the touch floor, and every measured seed lands 2 pt short of its end
				 *  (54/110, 58/118 on the 48 floor). The RADII do not follow it down — that is
				 *  the part an earlier draft of this comment got wrong: `baseHeight` is
				 *  `max(seededBase, measured)` and `seededBase` comes from the same pure
				 *  `composerPaintedHeight`, so a short measured seed loses to the 56/60 floor
				 *  and the pill stays R28/R30. Nothing in the suite renders a box either — the
				 *  pins are arithmetic on constants — so this is a construction, not a
				 *  measured guard: an absolute child contributes nothing to layout, so the
				 *  shape, the hit targets and the 12pt text inset are unchanged and only the
				 *  edge is new.
				 *
				 *  `pointerEvents="none"` is a correctness requirement, not styling: an
				 *  earlier absolutely positioned layer across this band swallowed every tap
				 *  on the field (round 4, U1/U2/U3), so the one thing this child must never
				 *  be is a hit target. It paints last, so the edge stays visible over the
				 *  content it bounds. */}
				<Animated.View
					pointerEvents="none"
					testID={CONTROL.composerShellRing}
					style={[
						{
							position: "absolute",
							top: 0,
							bottom: 0,
							/* Logical, like every other inset in this file: the ring covers
							 *  the shell's box, so `start`/`end` are `left`/`right` in LTR and
							 *  the mirrored pair under RTL, with no asymmetric rule to keep. */
							start: 0,
							end: 0,
							borderWidth: 1,
							borderColor: borderControl,
						},
						ringMotion,
					]}
				/>
			</Animated.View>
			{attachSheet}
			<Sheet
				visible={contextOpen}
				onClose={() => setContextOpen(false)}
				title={t("mobile.chrome.composer.more")}
				testID={CONTROL.composerContextSheet}
			>
				<ComposerChipButton
					chip={modelChip}
					onPress={() => {
						setContextOpen(false);
						onOpenModels();
					}}
					chooseHint="Choose the model"
					loadingWidthClassName="w-24"
					testID={CONTROL.composerContextModel}
				/>
				{effortChip ? (
					<ComposerChipButton
						chip={effortChip}
						onPress={() => {
							setContextOpen(false);
							onOpenEffort();
						}}
						chooseHint="Choose the effort"
						loadingWidthClassName="w-7"
						testID={CONTROL.composerContextEffort}
					/>
				) : null}
				{folderChip ? (
					<Chip
						quiet
						shrink
						label={folderChip.label}
						onPress={() => {
							setContextOpen(false);
							folderChip.onPress();
						}}
						accessibilityLabel={folderChip.accessibilityLabel}
						testID={folderChip.testID}
					/>
				) : null}
				{contextLabel ? (
					<Text className="text-body text-ink">{contextLabel}</Text>
				) : null}
				{costLabel ? (
					<Text className="text-body text-ink">{costLabel}</Text>
				) : null}
				{queuedCount > 0 ? (
					<View className="gap-1">
						<Text className="text-body text-ink">
							{t("mobile.chrome.composer.queued", { count: queuedCount })}
						</Text>
						{onOpenQueue ? (
							<Button
								variant="quiet"
								label={t("mobile.chrome.composer.open_queue")}
								onPress={() => {
									setContextOpen(false);
									onOpenQueue();
								}}
								testID={CONTROL.composerOpenQueue}
							/>
						) : null}
					</View>
				) : null}
			</Sheet>
		</Animated.View>
	);
};
