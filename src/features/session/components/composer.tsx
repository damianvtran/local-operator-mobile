// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.

import { Mic, Square } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	Image,
	Platform,
	Pressable,
	ScrollView,
	Text,
	type TextInput,
	View,
} from "react-native";

import type { PromptImage } from "@/contracts";
import {
	type AttachSource,
	attachActions,
} from "@/features/session/attach-rule";
import type { ComposerChip } from "@/features/session/chip-labels";
import { ComposerStateMarkers } from "@/features/session/components/state-markers";
import {
	attachmentLabel,
	COMPOSER_COPY,
	type ComposerControls,
} from "@/features/session/composer";
import { isSendKey } from "@/features/session/keyboard";
import type { DictationState } from "@/features/session/use-dictation";
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
import {
	Button,
	Chip,
	DictationMeter,
	IconButton,
	Sheet,
	Skeleton,
	Textarea,
} from "@/ui/components";
import { TOUCH_FLOOR } from "@/ui/layout";
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
	/** A refused start or a failed steer, stated beside the control that caused it. */
	error: string | null;
	queuedCount: number;
	/** A leading chip, before the levers on the receipt line. The composer home
	 *  passes its target folder here (`homeTargetFolder`); the session view has no
	 *  leading chip and passes nothing. Additive: the session view's rendering is
	 *  untouched by its existence. */
	leadingChip?: React.ReactNode;
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
				accessibilityLabel={chip.accessibilityLabel}
				accessibilityHint={chip.accessibilityHint}
				testID={testID}
			/>
		);
	}
	return (
		<Chip
			label={chip.text}
			onPress={onPress}
			accessibilityLabel={chip.accessibilityLabel}
			accessibilityHint={chooseHint}
			testID={testID}
		/>
	);
};

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
	error,
	queuedCount,
	leadingChip,
	modelChip,
	effortChip,
	onOpenModels,
	onOpenEffort,
	slashQuery,
	slashSheet,
	fieldRef,
	testID,
}: ComposerProps) => {
	const attachmentSummary = useMemo(
		() => images.map(attachmentLabel).join(" · "),
		[images],
	);

	/* The dictation row's layout is scale-dependent (D1/D2/D3): beside the controls a
	 * squeezed status clipped and the meter's flex bars collapsed to zero width, so
	 * past `LARGE_TEXT_SCALE` the row stacks and its box is fixed. See the row's own
	 * comment. `effectiveScale` — not `scale` — because on the web the platform's
	 * factor reaches the glyphs through the root font size. */
	const { effectiveScale } = useTextScale();
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
							textAlign: "right",
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

	return (
		<View
			ref={rootRef}
			className="border-t border-hairline px-3 pt-1.5 pb-2"
			testID={testID}
		>
			<ComposerStateMarkers controls={controls} />
			{/* Attachments, above the field: an attachment changes what send means, so it
			    is read before the control that is pressed. */}
			{images.length > 0 ? (
				<View className="pb-1.5">
					<ScrollView horizontal showsHorizontalScrollIndicator={false}>
						<View className="flex-row gap-1.5">
							{images.map((image, index) => (
								<Pressable
									key={`${index}-${image.mime_type}`}
									accessibilityRole={ROLE.button}
									accessibilityLabel={`Remove attachment ${index + 1}`}
									onPress={() => onRemoveImage(index)}
									testID={composerAttachmentId(index)}
								>
									<View className="overflow-hidden rounded-sm border border-control">
										<Image
											source={{
												uri: `data:${image.mime_type};base64,${image.data_b64}`,
											}}
											style={{ width: 64, height: 64, resizeMode: "cover" }}
											accessibilityLabel={`Attachment ${index + 1}`}
										/>
									</View>
								</Pressable>
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
			{showResume ? (
				<View className="pb-1.5">
					<Button
						label={COMPOSER_COPY.resumeLabel}
						variant="outline"
						size="sm"
						onPress={onResume}
						testID={CONTROL.composerResume}
					/>
				</View>
			) : null}

			{notice !== null ? (
				<View className="pb-1.5 rounded-sm border border-success-border bg-success-wash px-3 py-2">
					<Text
						className="text-body-sm text-success"
						accessibilityLiveRegion="polite"
						testID={SURFACE.composerNotice}
					>
						{notice}
					</Text>
				</View>
			) : null}

			{retainedMessage !== null ? (
				<View className="mb-1.5 rounded-sm border border-danger-border bg-danger-wash px-3 py-2">
					<Text
						className="text-body-sm text-danger"
						accessibilityRole={ROLE.alert}
						accessibilityLiveRegion="assertive"
						testID={SURFACE.composerRetained}
					>
						{retainedMessage}
					</Text>
					<View className="pt-2">
						<Button
							label={COMPOSER_COPY.retryLabel}
							variant="outline"
							size="sm"
							onPress={onRetry}
							testID={CONTROL.composerRetry}
						/>
					</View>
				</View>
			) : null}

			{error !== null ? (
				<View className="mb-1.5 rounded-sm border border-danger-border bg-danger-wash px-3 py-2">
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
			{controls.disabledReason !== null ? (
				<Text
					className="pb-1 text-meta text-ink-muted"
					testID={SURFACE.composerDisabledReason}
				>
					{controls.disabledReason}
				</Text>
			) : null}

			<View className="flex-row items-end gap-2">
				<View className="min-w-0 flex-1">
					<Textarea
						label="Message"
						value={draft}
						onChangeText={onDraftChange}
						placeholder={COMPOSER_COPY.placeholder}
						maxLines={6}
						/* One line of placeholder, always (§2.5 D1): the field's resting height
						 * must not grow with a wrapped placeholder, or the last transcript row is
						 * pushed past the scroller at 200 % text (design round 1, D1/D2). */
						placeholderMaxLines={1}
						// Kept because it is the callback a hardware keyboard submits
						// through, and it costs nothing — but see the note above: on this RN
						// version a multiline field never dispatches it. Native is NOT RUN
						// here, so this records the gap rather than a behaviour.
						onSubmitEditing={onSend}
						fieldRef={fieldRef}
						testID={CONTROL.composerInput}
					/>
				</View>
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel="Attach an image"
					accessibilityState={state({ busy: attaching, disabled: attaching })}
					disabled={attaching}
					onPress={() => setAttachSheetOpen(true)}
					testID={CONTROL.composerAttach}
				>
					<View className="h-11 w-11 items-center justify-center rounded-full border border-control">
						{/* A NAMED TYPE ROLE, not a bare colour class. A `<Text>` carrying only
						 *  `text-ink-muted` inherits the stylesheet's fixed 14 px and never reads a
						 *  `--text-*` role, so the glyph ignored the reader's text size — the same
						 *  defect the splash's suggestion labels were fixed for. Its cost is to the
						 *  MEASUREMENT as much as the reader: at 200 % every text node around it
						 *  doubles and this one does not, so it sits at the 100 %-median height and
						 *  drags the run-level median down — the drawer's own `S15/populated` 200 %
						 *  cells were reported UNREADY ("median text 34.796875px at 200% against
						 *  1.74x the 100% cell"), which makes `audit:capture` exit 1 for any cell
						 *  set containing the populated drawer. `body-sm` (14 px / 400) is the step
						 *  the glyph already PAINTS, so 100 % is unchanged and the glyph now scales
						 *  with everything beside it. `aria-hidden` stays: the label a reader hears
						 *  is the button's own ("Attach an image"). */}
						<Text className="text-body-sm text-ink-muted" aria-hidden>
							＋
						</Text>
					</View>
				</Pressable>
				{controls.stopVisible ? (
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityLabel="Stop the running turn"
						onPress={onStop}
						testID={CONTROL.composerStop}
					>
						<View className="h-11 w-11 items-center justify-center rounded-full border border-danger-border">
							<Text className="text-danger" aria-hidden>
								■
							</Text>
						</View>
					</Pressable>
				) : null}
				{/* The width is PINNED, whatever the label: a control that grows when it
				    morphs moves everything after it, which on a phone means it moves under
				    the thumb about to press it. */}
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={controls.primary.accessibilityLabel}
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
							"h-11 w-11 items-center justify-center rounded-full",
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
			{/* The dictation row (design §2.5): a line that SPANS the composer, holding
			    one height across recording, transcribing and the three outcome states, so
			    stopping a recording does not move the line (D3).

			    It is a ROW rather than the previous button-morph alone because a 44 pt
			    button swap did not read as "the composer is recording" — a reader had to
			    find the morph to know. The span is the state: a full-width bar with a live
			    level meter, the word, and the elapsed time.

			    The meter is `flex-1`, so it takes whatever the word, the clock and the
			    cancel do not: that is what makes the peaks SPAN rather than sit in a corner.

			    It sits directly UNDER the field and OVER the receipt line: under the field
			    because that is the thing it appends to (and the mic that runs it is one row
			    further down, on the receipt line), and never OVER it — defect 1 was that the
			    draft could not be read while a recording was live, so nothing here masks,
			    dims or disables the field, which keeps its own height, content and
			    editability for the whole take.

			    TWO layouts, one box height. At 100 % everything shares one line. Past
			    `LARGE_TEXT_SCALE` the status takes its own full-width line and the controls
			    take the next: side by side, the status was squeezed to ~99 pt and clipped
			    (`Recor…`, `Didn't catch that — tr…`, D3) and the meter's flex bars collapsed
			    to 0.0 px (D2). The box is fixed rather than content-sized so a one-line
			    outcome does not shrink the row below the two-line states — the jump the
			    design round measured (D1). */}
			{voice?.micVisible && (rowIsLive(voice.phase) || voice.status !== "") ? (
				<View
					className={cx(
						"mb-1.5 rounded-sm border px-3",
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
			) : null}

			{/* The receipt line: the queued count is the only thing here that changes on
			    its own, and the chips are the reader's two levers on the turn.

			    `flex-wrap` is what keeps the levers REACHABLE at 200 % platform text
			    (design round 4, D28): the model chip's label alone is 213 pt there, so a
			    nowrap row put the effort chip entirely beyond a 320 pt viewport
			    (measured: `composer-effort-chip` 267.2 → 336.4 at 150 %, 335.6 → 419.2 at
			    200 %) — a control no finger can reach. Wrapping costs a second line only
			    at the scales that need one, and takes nothing away at 100 %. */}
			<View className="flex-row flex-wrap items-center gap-2 pt-1.5">
				{leadingChip}
				{queuedCount > 0 ? (
					<Text
						className="text-mono-sm text-ink-dim"
						testID={SURFACE.queuedMessageChip}
					>
						{queuedCount} queued
					</Text>
				) : null}
				<View className="flex-1" />
				<ComposerChipButton
					chip={modelChip}
					onPress={onOpenModels}
					chooseHint="Choose the model"
					// Sized to the settled chip (measured 119.6 pt with a model name):
					// a bar that is too short makes the swap jump sideways.
					loadingWidthClassName="w-24"
					testID={CONTROL.composerModelChip}
				/>
				{effortChip ? (
					<ComposerChipButton
						chip={effortChip}
						onPress={onOpenEffort}
						chooseHint="Choose the effort"
						loadingWidthClassName="w-7"
						testID={CONTROL.composerEffortChip}
					/>
				) : null}
				{/* The voice mic: shown only when the relay says voice input can run here AND
				    this build can record (`voice.micVisible`). Absence of `capabilities.stt`
				    is unavailable, so an older relay simply never renders it.

				    It sits on the receipt line, NOT in the field's row, because a control in
				    that row costs the field its width: 48 target + the 8 gap took the 320 pt
				    field's content box from 166 to 110 px, which wrapped the placeholder to
				    two lines at 100 % and four at 200 % (breaking mid-word, since even
				    "Message" no longer fit) and grew the resting composer to 55 % of the
				    viewport, clipping the last transcript row (design round 1, D1/D2). Here it
				    costs the field nothing, and the row already wraps (D28) so a 200 % scale
				    can push it to a second line rather than squeeze the field. */}
				{voice?.micVisible ? (
					<IconButton
						accessibilityLabel={micLabel(voice.phase)}
						accessibilityHint={MIC_HINT[voice.phase]}
						disabled={voice.phase === "transcribing"}
						outlined
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
				) : null}
			</View>
			{/* The receipt anchor `08-connection-loss-recovery` asserts after a send
			    across a reconnect: it is the composer's own "the instruction left" mark. */}
			<View testID={SURFACE.composerReceipt} aria-hidden />
			{slashQuery !== null ? slashSheet : null}

			{/* The attach sheet: one entry point, and the sources each platform actually
			    has — the photo picker, the document picker, the clipboard (web: file
			    input and clipboard). It renders through the shared `Sheet` primitive,
			    like the model and effort sheets, so it dismisses the same way (scrim,
			    Close, Escape), and every row lands in the attachment strip above the
			    field — one chip treatment, one removal, one send path. */}
			<Sheet
				visible={attachSheetOpen}
				onClose={() => setAttachSheetOpen(false)}
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
									onAttach(action.source);
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
		</View>
	);
};
