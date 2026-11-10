// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.

import {
	Check,
	ClipboardPaste,
	Folder,
	Keyboard as KeyboardIcon,
	Mic,
	MoreHorizontal,
	Paperclip,
	Square,
	TriangleAlert,
	X,
} from "lucide-react-native";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ActivityIndicator,
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
import { useClipboardImageOffer } from "@/features/session/attach-clipboard";
import {
	type AttachSource,
	attachActions,
	type PasteVia,
} from "@/features/session/attach-rule";
import type { ComposerChip } from "@/features/session/chip-labels";
import { ComposerStateMarkers } from "@/features/session/components/state-markers";
import {
	attachmentLabel,
	type ComposerControls,
	composerCopy,
	composerFeedback,
	noticeActionName,
} from "@/features/session/composer";
import {
	ATTACH_GLYPH_PT,
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CHIP_CAPSULE_ALIGN,
	COMPOSER_CHIP_TRAILING,
	COMPOSER_CHIP_ZONE,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	COMPOSER_META_GAP_PT,
	COMPOSER_META_ROW,
	composerChipPlan,
	FOLDER_CHIP_MAX_PT,
	folderChipText,
	HOME_STRIP_SHRINK,
	MODEL_FLOOR_PT,
} from "@/features/session/composer-layout";
import {
	COMPOSER_CONTROLS_GAP,
	COMPOSER_FIELD_BOX,
	COMPOSER_GLASS_LAYER_RADIUS,
	composerFieldRowAlign,
	composerPaintedHeight,
	composerPresentation,
	composerRestRow,
	composerShellPadding,
	composerShellRadius,
	controlsTrailing,
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
import { ChromeSurface } from "@/ui/components/chrome-surface";
import { TEXT_END_CLASS, useIsRTL } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";
import {
	composerAtHostCap,
	composerBudget,
	composerHostBound,
	composerKeyboardLimit,
} from "@/ui/size-class";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { CONTROL_DISABLED_INK, cx } from "@/ui/variants";

/** The outcome lines the status row can rest on, and whether the row is showing a
 *  LIVE dictation (a phase) rather than a settled outcome. Both are read from the
 *  machine's own snapshot; the row is one height either way (design §2.5 D3). */
const rowIsLive = (phase: DictationState["phase"]): boolean => phase !== "idle";

/** Out of the layout and out of sight, still in the accessibility tree: the
 *  web's `sr-only` box. Used for the recording row's status word (design D3). */
const VISUALLY_HIDDEN = {
	position: "absolute",
	width: 1,
	height: 1,
	overflow: "hidden",
} as const;

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
	onAttach: (source: AttachSource, via?: PasteVia) => void;
	/** A web paste event's image file. Only the web build can raise the event;
	 *  the listener that reads it lives here, the read lives with the host. */
	onPasteFile: (file: File) => void;
	attaching?: boolean;
	/** The voice mic's state. `null`/absent means this surface shows no mic. Both
	 *  hosts pass one now — the session view and the home (TestFlight 578: the
	 *  new-conversation page had no mic). A relay without `capabilities.stt`
	 *  gets `micVisible: false`, and a computer that answered "no STT here"
	 *  gets the set-up mic (`micSetup`) rather than no mic at all. */
	voice?: DictationState | null;
	onSend: () => void;
	/** Clears only the unsent editor, never retained/queued instructions. */
	onClearDraft?: () => void;
	/** Presentation only; the host must not discard any delivery record. */
	onDismissError?: () => void;
	onStop: () => void;
	/** A stop is pending for this turn (`turn-stop.ts`), shared with the pinned
	 *  working line's `stop`: the ■ dims and reads busy with it, so the two
	 *  controls never disagree about whether the turn was asked to stop. */
	stopping?: boolean;
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
	/** The queued count stays VISIBLE on the card's controls row. The session
	 *  passes this wherever it has no activity line above the composer to carry
	 *  the count (a tablet, short landscape) — on those layouts nothing else on
	 *  screen says a message is waiting (review round 1, M1). Off by default:
	 *  the home states its queue on its own line, and a portrait phone on the
	 *  activity line, and a second copy on the card would only take the model's
	 *  width. Short landscape wide enough for the compact strip shows the count
	 *  there whatever this says. */
	queueOnCard?: boolean;
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
	/** Draw the shell and the strip's chips as iOS Liquid Glass (design spec
	 *  §12). The HOST decides, from `useChromeGlass()`, so the composer and any
	 *  chrome beside it share one fill decision. Fill only: the box, radii and
	 *  every target are identical in both branches, and attach/send stay opaque
	 *  so their ink ratios never depend on what scrolls behind the glass. */
	glass?: boolean;
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
	 *  the ceiling only binds once the painted bottom reaches the window. `capped`
	 *  says the box is held at `limit` (see `composerLimit`'s invariant): a capped
	 *  box ends where a fitting one does, so the screen cannot read it from geometry. */
	onMeasure?: (box: { top: number; height: number; capped: boolean }) => void;
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
	glass = false,
	leadingIcon,
}: {
	/** The strip's glass branch: the chip gets its own capsule of material. */
	glass?: boolean;
	/** A glyph before the value chip's text (the home's folder chip). */
	leadingIcon?: ReactElement;
	chip: ComposerChip;
	onPress: () => void;
	/** The hint on the value chip, which is the only case that opens a sheet. */
	chooseHint: string;
	loadingWidthClassName: string;
	testID: string;
}) => {
	if (chip.kind === "loading") {
		/* In its capsule too (design D5b): an unwrapped placeholder made the
		 *  strip change material the moment the model list resolved. */
		return stripChipSurface(
			glass,
			<ChipPlaceholder
				label={chip.accessibilityLabel}
				widthClassName={loadingWidthClassName}
				testID={testID}
			/>,
		);
	}
	if (chip.kind === "unavailable") {
		return stripChipSurface(
			glass,
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
			/>,
		);
	}
	return stripChipSurface(
		glass,
		<Chip
			label={chip.text}
			shrink
			onPress={onPress}
			quiet
			leadingIcon={leadingIcon}
			accessibilityLabel={chip.accessibilityLabel}
			accessibilityHint={chooseHint}
			testID={testID}
		/>,
	);
};

/** A strip chip's own capsule of glass (design spec §12), or the chip as it
 *  always was. Solid is NOT wrapped: a `ChromeSurface` paints `bg-elevated`
 *  in its solid branch, which would turn today's quiet, fill-less chip into a
 *  box — the fallback must stay byte-for-byte what ships. The capsule's radius
 *  is half the chip's touch-floor height: `radius.full` in spirit, as a number
 *  because the glass view takes its corners as props. `min-w-0`/`maxWidth` keep the chip's own shrink rule
 *  working through the extra box, so a long model name still ellipsizes. */
const stripChipSurface = (glass: boolean, chip: ReactElement) =>
	glass ? (
		<ChromeSurface
			glass
			radii={{ top: TOUCH_FLOOR / 2, bottom: TOUCH_FLOOR / 2 }}
			style={{
				maxWidth: "100%",
				minWidth: 0,
				alignSelf: COMPOSER_CHIP_CAPSULE_ALIGN,
			}}
			className="min-w-0"
		>
			{chip}
		</ChromeSurface>
	) : (
		chip
	);

/** The failure notice's row floor: one touch target, because each row holds a
 * sentence AND its action, and the action's box is the taller of the two. Also
 * the extras' minimum visible height while the notice is up (`composerBudget`). */
const NOTICE_ROW_FLOOR = TOUCH_FLOOR;
/** Centres the sentence's first 20 pt line (`text-body-sm`) in that floor, so the
 * word of the trailing action and the first line of the sentence share a
 * baseline row; a wrapped sentence grows downward from there. */
const NOTICE_LINE_INSET = Math.max(0, (NOTICE_ROW_FLOOR - 20) / 2);

/**
 * A text action inside the composer's failure notice (visual audit D6): the
 * word alone, no outline and no fill, because the notice it belongs to is one
 * borderless block and a boxed button inside it was the "ugly" part. The
 * touch-floor box is real geometry on both axes (react-native-web implements no
 * `hitSlop`, and the audit reads the box), with the word centred on the
 * block's leading edge so it lines up under the sentence.
 */
const NoticeAction = ({
	label,
	accessibilityLabel,
	accessibilityHint,
	onPress,
	testID,
}: {
	label: string;
	accessibilityLabel: string;
	accessibilityHint?: string;
	onPress: () => void;
	testID: string;
}) => (
	<Pressable
		accessibilityRole={ROLE.button}
		accessibilityLabel={noticeActionName(label, accessibilityLabel)}
		accessibilityHint={accessibilityHint}
		onPress={onPress}
		style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		className="justify-center"
		testID={testID}
	>
		<Text className="text-body-sm font-medium text-ink underline">{label}</Text>
	</Pressable>
);

/**
 * One row of the More sheet: a label and its value on ONE leading edge (visual
 * audit D5). The sheet used to list the two chips and two bare sentences, which
 * put unlabelled text on two different left edges (a chip pads its label, a
 * `Text` does not) and left "High" to be recognised as an effort by position.
 * A row with `onPress` is the way into that value's own picker.
 */
const ContextRow = ({
	label,
	value,
	onPress,
	accessibilityLabel,
	accessibilityHint,
	disabled = false,
	testID,
}: {
	label: string;
	/** `null` while the value is still expected: the row keeps its place and
	 *  shows the kit's skeleton instead of a word that would be a guess. */
	value: string | null;
	onPress?: () => void;
	accessibilityLabel?: string;
	accessibilityHint?: string;
	disabled?: boolean;
	testID?: string;
}) => {
	const body = (
		<View
			className="flex-row items-center justify-between gap-3"
			style={{ minHeight: TOUCH_FLOOR }}
		>
			<Text className="shrink-0 text-body-sm text-ink-muted">{label}</Text>
			{value === null ? (
				<Skeleton lines={1} widthClassName="w-24" />
			) : (
				<Text
					className={cx(
						"min-w-0 flex-1 text-body-sm",
						TEXT_END_CLASS,
						disabled ? CONTROL_DISABLED_INK : "text-ink",
					)}
					numberOfLines={1}
				>
					{value}
				</Text>
			)}
		</View>
	);
	if (!onPress) return <View testID={testID}>{body}</View>;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={accessibilityLabel ?? `${label}, ${value ?? ""}`}
			accessibilityHint={accessibilityHint}
			accessibilityState={state({ disabled })}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
		>
			{body}
		</Pressable>
	);
};

/** The More sheet's row for a chip, in whichever of its three states it is. */
const chipRowValue = (chip: ComposerChip): string | null =>
	chip.kind === "loading" ? null : chip.text;

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
	onClearDraft,
	onDismissError,
	onStop,
	stopping = false,
	retainedMessage,
	notice,
	onRetry,
	showResume,
	onResume,
	ended = false,
	error,
	queuedCount,
	queueOnCard = false,
	onOpenQueue,
	onEditingChange,
	suppressDisabledHint = false,
	folderChip = null,
	contextLabel = null,
	costLabel = null,
	bottomInset,
	glass = false,
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
	const feedback = composerFeedback({ ended, error, retainedMessage });
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
	/* Whether the mic renders at all: a working mic, or the set-up mic for a
	 *  computer with no speech-to-text. The width budget, the row reserve and the
	 *  row itself all read this one value, so they cannot disagree. */
	const micShown = voice != null && (voice.micVisible || voice.micSetup);
	/* The ✓ and the transcribing spinner: full ink, so the confirming control is
	 *  the strongest thing on the recording row's danger wash. */
	const dictationInk = useTokenColor("ink");

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
		 * Native keeps an honestly labelled Return key for software-keyboard
		 * paragraph entry. Its pinned footer owns Send/Steer instead. This DOM
		 * listener stays web-only; it must never intercept mobile paragraph entry. */
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
			 * where beside the controls it clipped to `Didn't catch that — tr…` (D3).
			 *
			 * A RESTING outcome may also take two lines at 100 %: it has no meter or
			 * timer beside it, and two `text-body-sm` lines (2 × 20.3) sit inside the
			 * row's fixed `dictationRowBox`, so the set-up sentence wraps instead of
			 * ending "…to use vo…" without moving the composer (design D1 / UX U1).
			 * A resting outcome is not CAPPED at all: at 320 pt / 200 % the set-up
			 * sentence needs three lines and a two-line cap cut it to "…on your …"
			 * (design round 2, D5). No take is live then, so the row growing past its
			 * box moves nothing under a finger mid-recording; the 1/2-line clamp stays
			 * on the live phases, whose row height is pinned.
			 *
			 * While RECORDING the word is visually hidden but stays the live region:
			 * the red dot and the running timer already say "recording", and the
			 * waveform the operator asked for gets the word's width back (design D3).
			 * Clipped to 1 × 1 rather than removed or `opacity: 0`, so it is still in
			 * the accessibility tree and still announced. Past `LARGE_TEXT_SCALE` the
			 * word keeps its own line (it never shared the meter's), so it stays. */
			<Text
				role={ROLE.status}
				accessibilityLiveRegion={LIVE_REGION.polite}
				numberOfLines={
					!rowIsLive(voice.phase) ? undefined : dictationLargeText ? 2 : 1
				}
				className={cx(
					"text-body-sm",
					rowIsLive(voice.phase) ? "text-danger" : "text-ink-muted",
				)}
				style={
					voice.phase === "recording" && !dictationLargeText
						? VISUALLY_HIDDEN
						: undefined
				}
				testID={SURFACE.composerDictationStatus}
			>
				{voice.status}
			</Text>
		);
	/* A function of where ✓ goes: on the row, or MOVED to the controls row's
	 * trailing slot when the card is open only for dictation (`controlsTrailing`,
	 * UX round 2, U7) — never both, which would be D2's two finish controls. */
	const dictationControls = (finishOnRow: boolean) =>
		voice === null ? null : (
			<>
				{voice.phase === "recording" ? (
					<DictationMeter
						meter={voice.meter}
						testID={SURFACE.composerDictationMeter}
					/>
				) : voice.phase === "transcribing" ? (
					/* The wait, shown: the computer is transcribing, and a row that
					 * froze on the last waveform read as hung. Indeterminate because
					 * `/api/transcribe` reports no progress — only that it settled.
					 * `flex-1` takes the meter's slot so the row does not reflow. */
					<View
						className="flex-1 flex-row items-center"
						testID={SURFACE.composerDictationMeter}
					>
						{/* Hidden from assistive tech: the polite status row beside it already
						 *  says "Transcribing", and a labelled spinner made VoiceOver say it
						 *  twice (agent review round 1, N2). */}
						<ActivityIndicator
							size="small"
							color={dictationInk}
							aria-hidden
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
						/>
					</View>
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
				{/* The reader's own DISCARD (✕) and FINISH (✓), the pair the operator asked
				    for (TestFlight 578: "clear cancel and stop/confirm controls"). ✕ stops
				    the take and sends NO request; ✓ stops AND transcribes — the same
				    `press` the mic runs while recording, placed where the eye already is.

				    Glyphs, not the earlier `Discard` word: design round 1 (D6) chose the
				    word because the only neighbour was the mic's Square, and "Cancel" read
				    as "stop". With ✕ and ✓ side by side the two outcomes are the
				    conventional opposites, and each control's accessible name still says
				    exactly what it does. Both are 44 pt targets inside the row's fixed
				    box, so the composer's geometry does not change. */}
				{rowIsLive(voice.phase) ? (
					<IconButton
						accessibilityLabel={t("mobile.composer_input.voice.discard")}
						onPress={voice.cancel}
						icon={({ color, size }) => <X color={color} size={size} />}
						testID={CONTROL.composerDictationCancel}
					/>
				) : null}
				{voice.phase === "recording" && finishOnRow ? dictationFinish : null}
			</>
		);

	/* ✓, wherever `dictationControls` places it. One node so the row's and the
	 * trailing slot's copies cannot drift (label, ink, testID). */
	const dictationFinish =
		voice === null ? null : (
			<IconButton
				accessibilityLabel={t("mobile.composer_input.voice.finish")}
				onPress={voice.press}
				icon={({ size }) => <Check color={dictationInk} size={size} />}
				testID={CONTROL.composerDictationFinish}
			/>
		);

	/* The compact budget, spent in order of what must never leave the screen: the receipt
	 *  line (chips), then the field's one-line floor, then whatever is left is the field's
	 *  growth, and the extras scroller gets the rest. `compact.maxHeight` is the whole
	 *  composer's share of the window (`COMPACT_COMPOSER_SHARE`). */
	const [receiptHeight, setReceiptHeight] = useState(48);
	/* Measure this dock's width (not the whole window) for compact split fit. */
	const [metaWidth, setMetaWidth] = useState(0);
	/* The card's chip zone, measured: what `composerChipPlan` fits chips into. */
	const [chipZoneWidth, setChipZoneWidth] = useState(0);
	const _window = useWindowDimensions();
	const [focused, setFocused] = useState(false);
	const pasteOffer = useClipboardImageOffer(focused);
	const [keyboardVisible, setKeyboardVisible] = useState(false);
	const [nativeKeyboardOverlap, setNativeKeyboardOverlap] = useState(0);
	const [contextOpen, setContextOpen] = useState(false);
	const ownField = useRef<TextInput>(null);
	const inputRef = fieldRef ?? ownField;
	const reducedMotion = useReducedMotion();
	const elevated = useTokenColor("elevated");
	/* The shell's FOCUS edge, and only that (visual audit D8). At rest the card
	 *  is separated by its `elevated` fill alone, as the relay's is: the operator
	 *  asked for no border line, and a permanent 1 pt `border-control` ring read
	 *  as a definite outline (3.4–4.2:1 against the canvas). The field is
	 *  `integrated` and draws no outline of its own, so focus still needs a
	 *  visible mark — the same ring, painted only while the field holds focus,
	 *  in the token whose contrast against `canvas` is already known
	 *  (3.132–5.924:1 in every theme, `docs/design/components.md` § 5). */
	const borderControl = useTokenColor("border-control");
	/* Seeded at the resting form's own end: a dock that rests as the card must
	 *  not morph in from a pill on every mount. */
	const progress = useSharedValue(compact === null ? 1 : 0);
	const keyboardOffset = useSharedValue(0);
	const keyboardDuration = useRef(200);
	const presentationFacts = {
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
	};
	/* What the dock would be on ITS OWN facts — focus, a draft, an attachment, a
	 *  take, a live turn or a notice. `onEditingChange` and the dictation slot
	 *  rule below read this one: the host's "is the reader editing" must not turn
	 *  true just because the dock now rests as a card. */
	const activePresentation = composerPresentation(presentationFacts);
	/* Open ONLY because of dictation: without the take (or its outcome line) this
	 *  card would be the collapsed pill, whose trailing slot is the mic. The
	 *  controls row then keeps the mic in that trailing slot, so the press that
	 *  expands the card does not slide Send under the finger that just pressed the
	 *  mic (UX review round 1, U2). Send is disabled in this state anyway: a card
	 *  with a draft, an attachment or focus is open for its own reasons. */
	const openForDictationOnly =
		activePresentation.expanded &&
		!composerPresentation({ ...presentationFacts, dictation: false }).expanded;
	const trailing = controlsTrailing({
		openForDictationOnly,
		recording: voice?.phase === "recording",
		micShown,
	});
	/* Physical orientation is supplied by the caller, not the keyboard-shortened
	 * window. Narrow splits retain two rows rather than clipping a control. */
	const compactSingle =
		compact !== null &&
		metaWidth >=
			80 +
				5 * TOUCH_FLOOR +
				(micShown ? TOUCH_FLOOR : 0) +
				(controls.stopVisible ? TOUCH_FLOOR : 0) +
				24;
	/* THE RESTING FORM (visual audit D1/D5). Everywhere but short landscape the
	 *  dock rests as the two-row card: field above, `attach · model · effort · … ·
	 *  mic · send` below, the relay's own shape. The chips used to ride a separate
	 *  48 pt strip above a 56 pt pill; the card is the same height as that pair
	 *  and one surface instead of two. Short landscape keeps its one-row pill and
	 *  its compact strip, because a 390 pt-tall window cannot spare the row. */
	/* `metaWidth > 0`: until the dock has been measured a short-landscape host
	 *  cannot know whether it is the pill, and painting the card for that one
	 *  frame is a visible flip. */
	const restsAsCard = compact === null || (metaWidth > 0 && !compactSingle);
	const presentation = restsAsCard
		? composerPresentation({ ...presentationFacts, card: true })
		: activePresentation;
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
			setNativeKeyboardOverlap(overlap);
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
				setNativeKeyboardOverlap(0);
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
		onEditingChange?.(activePresentation.expanded);
	}, [activePresentation.expanded, onEditingChange]);
	/* THE PAINTED BASE, measured. The pill's radius is half the pill the platform
	 * actually paints (56/R28 on every floor since H5: 4 + 48 + 4), not
	 * half a constant: the 24/28 pair is a JOINT rule, so a radius derived from a
	 * number the box does not paint is a shape nobody sees. The CONTENT block is
	 * the ruler; the shell cannot measure itself (see `measureContent`). */
	/* The extras' natural height, for the ceiling budget only: the morph's ends
	 *  come from one measured content block that already contains them, so adding
	 *  this to a total again would count them twice. */
	const [extrasHeight, setExtrasHeight] = useState(0);
	/* The record's paddings, settled per state: they are part of its sums
	 *  (4 + row + 4 standing, 12 + h + 4 + h + 8 open) and never a second clock.
	 *  `composerShellPadding` owns the numbers (and H5's reason for 4); short
	 *  landscape keeps the resting pair in every state, as it always has. */
	const shellPad = composerShellPadding(
		compactSingle ? false : presentation.expanded,
	);
	const shellBox = {
		paddingTop: shellPad.top,
		paddingBottom: shellPad.bottom,
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
			 *  skipping its measurement left the seeded 56 in place while the
			 *  content grew past it — clipped by the overflow rule below (R7-1). */
			setCollapsedSeed(seed.total);
		}
	};
	/* The first frame must not paint a radius the pill does not have: the field's
	 *  box IS the platform's touch floor, so the seeded ends are the record's own
	 *  sums at that floor (56/112 on iOS, 56/120 on the 48 floor). */
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

	/* The dock's own 8 pt above the keyboard or the bottom inset. The INSET is not
	 *  in this margin: it is padding on the carrier below, because the inset is a
	 *  device fact rather than a spacing decision, and U-42 reads a padding equal
	 *  to the declared inset as the inset but a margin of inset + 8 (28 pt on a
	 *  20 pt-inset tablet) as an off-scale step — the same split `dialog.tsx`
	 *  makes. The painted position is unchanged: carrier padding + this margin is
	 *  the old `inset + 8`, and with the keyboard up the carrier pays nothing. */
	const dockMotion = useAnimatedStyle(() => ({
		marginBottom: keyboardOffset.value + 8,
	}));
	const dockInset = keyboardVisible ? 0 : Math.max(0, bottomInset ?? 0);

	const dangerInk = useTokenColor("danger");
	const attachInk = useTokenColor("ink-muted");
	/* The folder glyph's ink: `ink-dim`, as on the folder sheet's rows. */
	const folderInk = useTokenColor("ink-dim");
	/* The extras' natural height, from the scroller's own content size, so the budget can
	 *  give them what they need and no more. */

	const COMPOSER_PAD = 8;
	/* The same condition the row itself renders under, so the reserve and the row cannot
	 *  disagree. `mb-2` is its bottom margin. */
	const dictationShowing =
		voice !== null &&
		micShown &&
		(rowIsLive(voice.phase) || voice.status !== "");
	const DICTATION_ROW_MARGIN_PX = 8;
	/* The vertical padding the root actually paints: `pt-1 pb-1` in the short-landscape
	 *  form, and `pt-2` plus the inset-paying bottom padding everywhere else. The
	 *  budget spends what the box paints. */
	const composerPad = compact === null ? 20 : COMPOSER_PAD;
	/* What sits under the field and never scrolls: the controls row, plus the meta
	 *  line when it has its own row. With the keyboard up it only rides inline
	 *  when model + effort targets fit; otherwise reserve the separate row too. */
	/* Only short landscape still has a strip outside the shell; the card's chips
	 *  ride its controls row, which `TOUCH_FLOOR` already pays for. The strip's
	 *  last measured height is ignored rather than reset, so a rotation back
	 *  cannot charge a row that is no longer mounted. The 4 pt is the gap
	 *  between the field and the controls row (`COMPOSER_CONTROLS_GAP`). */
	const stripHeight = compactSingle ? receiptHeight : 0;
	const fixedRows = compactSingle ? 0 : TOUCH_FLOOR + stripHeight + 4;
	const hostBound = compact === null ? limit : compact.maxHeight;
	// The iOS window does not shrink with its keyboard. A bottom translation
	// alone keeps the footer above it but lets extras grow off-screen forever.
	const keyboardBound =
		Platform.OS !== "web" && keyboardVisible
			? composerKeyboardLimit(_window.height, nativeKeyboardOverlap)
			: null;
	const rawBound =
		keyboardBound === null
			? hostBound
			: Math.min(hostBound ?? keyboardBound, keyboardBound);
	const bound =
		rawBound === null
			? null
			: composerHostBound(rawBound, presentation.gap, TOUCH_FLOOR);
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
					/* A failure notice may not be budgeted to nothing (UX #211 U1/U4):
					 *  its first row — sentence and action — stays visible, and the
					 *  rest scrolls beneath it. */
					feedback.retainedText !== null || feedback.errorText !== null
						? NOTICE_ROW_FLOOR
						: 0,
				);
	const fieldMaxHeight = budget?.field;
	const extrasMaxHeight = budget?.extras;

	/* The window-coordinate top of the composer, for the portrait ceiling. `react-
	 *  native-web` implements `measureInWindow` on the host node; native resolves it
	 *  asynchronously, which is why this only publishes a number and never gates the
	 *  first paint (a `null` top means "no limit" — the old behaviour — for a frame). */
	/* Only the portrait host `limit` is fed back through the measurement; the compact
	 *  share and the keyboard budget come from window geometry and never loop. */
	const hostLimit = compact === null ? limit : null;
	const outerGap = presentation.gap;
	const publishBox = useCallback(() => {
		if (!onMeasure) return;
		const report = (top: number, height: number) =>
			onMeasure({
				top,
				height,
				capped: composerAtHostCap(height, hostLimit, outerGap, TOUCH_FLOOR),
			});
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
			report(Math.round(rect.top), Math.round(rect.height));
			return;
		}
		rootRef.current?.measureInWindow((_x, y, _w, h) =>
			report(Math.round(y), Math.round(h)),
		);
		/* `hostLimit` and `outerGap` are deps on purpose: binding the limit resizes the
		 *  box, and that re-measure is what reports `capped` for the new cap. */
	}, [onMeasure, hostLimit, outerGap]);
	/* One string, because the effect must run when ANY of these moves the composer —
	 *  the receipt wrapping, the extras, the scale, the mode, the dictation row — or
	 *  when the screen says the chrome above it changed. Listing them as separate
	 *  dependencies is what the lint rule objects to, and a stale top is how the
	 *  ceiling stops matching the column. */
	/* The keyboard is in the key (deferred #177 finding): toggling it moves the
	 *  dock by the keyboard's height without changing any other input here, and a
	 *  key that missed it left the host reading a stale `composerBox.top`. */
	const measurementKey = `${measureKey}|${stripHeight}|${extrasHeight}|${effectiveScale}|${compact === null ? "tall" : "compact"}|${dictationShowing ? "dictation" : ""}|${keyboardVisible ? "keyboard" : ""}`;
	useEffect(() => {
		/* `measurementKey` is READ here only to make it the dependency it is: the
		 *  effect's whole purpose is to re-measure when the key changes (find bar,
		 *  panels, pending card, receipt wrap, extras, scale, mode, keyboard), and none of
		 *  those values is an input to the measurement itself. Removing it — what
		 *  the unsafe quick-fix offers — is the stale-top defect this exists to
		 *  avoid, so it is referenced rather than suppressed. */
		if (measurementKey === "") return;
		publishBox();
	}, [publishBox, measurementKey]);

	/* ONE NOTICE for an uncertain delivery and for an error (visual audit D6; the
	 *  operator: warnings inside the composer "look ugly"). It was two bordered red
	 *  boxes, a full-width outlined button and a helper sentence restating the
	 *  first box, stacked inside the card. Now a danger glyph and, per line, the
	 *  sentence with its one text action trailing it: no border, no wash, no
	 *  full-width button.
	 *
	 *  Each action sits on the line it acts on (UX #211 U2/U4). They used to share
	 *  a row UNDER both sentences, which failed twice: at 320 pt / 200 % that row
	 *  was below the fold of the extras scroller, so a failed send offered no
	 *  reachable Retry; and with a retained instruction showing, "Dismiss" read as
	 *  dismissing the red sentence, removed only the grey error line and itself,
	 *  and so looked broken. Now the retained sentence carries Retry and nothing
	 *  else, and the error line carries its own dismissal, which is NAMED for the
	 *  error ("Dismiss error") whenever there is another sentence it could be
	 *  mistaken for. Alone, the error is the only thing there and the one word
	 *  is enough.
	 *
	 *  Behaviour is #206's and unchanged: Retry is the host's `onRetry`, and
	 *  Dismiss is its `onDismissError`, which hides the ERROR line only — a
	 *  retained instruction has no dismiss here at all, so neither action can
	 *  drop a retained UUID, an uncertainty row or the queue, and a failure
	 *  that recurs is a new `error` value the host hands back in.
	 *
	 *  When both are present the retained sentence leads (it is the one that
	 *  blocks Send) and the error is its cause, said once beneath it in the
	 *  quieter ink rather than as a second alert. Each keeps its own id and
	 *  live region, so assistive tech hears both as before.
	 *
	 *  The first row is `NOTICE_ROW_FLOOR` tall with the action inside it, and the
	 *  block is the FIRST thing in the extras: that row is what `composerBudget`'s
	 *  `extrasFloor` keeps on screen when the composer has no room (U1). */
	const failureNotice =
		feedback.retainedText !== null || feedback.errorText !== null ? (
			<View
				className="mb-1 flex-row items-start gap-2"
				testID={SURFACE.composerFailureNotice}
			>
				{/* The glyph is centred on the FIRST line (a 20 pt line box, itself
				    centred in the row's touch floor by `NOTICE_LINE_INSET`), not on
				    the block: under a two-line sentence at 200 % it would otherwise
				    drift to the middle and stop reading as the sentence's mark. */}
				<View
					className="h-5 items-center justify-center"
					style={{ marginTop: NOTICE_LINE_INSET }}
					aria-hidden
				>
					<TriangleAlert size={14} color={dangerInk} />
				</View>
				<View className="min-w-0 flex-1">
					{feedback.retainedText !== null ? (
						<View
							className="flex-row items-start gap-3"
							style={{ minHeight: NOTICE_ROW_FLOOR }}
						>
							<Text
								className="min-w-0 flex-1 text-body-sm text-danger"
								style={{ paddingVertical: NOTICE_LINE_INSET }}
								accessibilityRole={ROLE.alert}
								accessibilityLiveRegion="assertive"
								testID={SURFACE.composerRetained}
							>
								{feedback.retainedText}
							</Text>
							<NoticeAction
								label={t("mobile.composer_input.notice_retry")}
								/* The full sentence stays the accessible name: "Retry"
								 *  alone does not say WHAT is retried, and it contains
								 *  the visible word (label-in-name, U-10). */
								accessibilityLabel={feedback.retryLabel}
								onPress={onRetry}
								testID={CONTROL.composerRetry}
							/>
						</View>
					) : null}
					{feedback.errorText !== null ? (
						<View
							className="flex-row items-start gap-3"
							style={{ minHeight: NOTICE_ROW_FLOOR }}
						>
							<Text
								className={
									feedback.retainedText !== null
										? "min-w-0 flex-1 text-meta text-ink-muted"
										: "min-w-0 flex-1 text-body-sm text-danger"
								}
								style={{ paddingVertical: NOTICE_LINE_INSET }}
								accessibilityLiveRegion="assertive"
								testID={SURFACE.composerError}
							>
								{feedback.errorText}
							</Text>
							{onDismissError ? (
								<NoticeAction
									label={
										feedback.retainedText !== null
											? t("mobile.composer_input.dismiss_error")
											: t("mobile.composer_input.notice_dismiss")
									}
									accessibilityLabel={t("mobile.composer_input.dismiss_error")}
									accessibilityHint={t(
										"mobile.composer_input.dismiss_error_hint",
									)}
									onPress={onDismissError}
									testID={CONTROL.composerDismissError}
								/>
							) : null}
						</View>
					) : null}
				</View>
			</View>
		) : null;

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
			{/* First, above even the attachments: its first row is the one the budget
			    guarantees (`extrasFloor`), and a guarantee about the top of a scroller
			    only helps what is AT the top. */}
			{failureNotice}
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

			{/* U4: name why the primary is dead, whatever the reason — an unresolved
			    instruction or a session that has ended — so a disabled ↑ reads as
			    intentional rather than as a broken button. The sentence is the
			    projection's, and this is the only place it is rendered. */}
			{/* Not while the retained notice is up (D6): the reason then IS that
			    notice, and repeating it one line lower was the third copy of one
			    fact. It stays on the disabled Send as its hint (see the disc). */}
			{controls.disabledReason !== null &&
			presentation.expanded &&
			feedback.retainedText === null &&
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

	/* VISIBLE, not just announced (round 4 reviewer MAJOR): a queue the reader
	 *  cannot see is a queue they cannot trust. On the card the count rides the
	 *  host's activity line above the dock (visual audit D1/D5: it was a fourth,
	 *  sans-serif thing on a row of mono chips); this chip is what is left for
	 *  short landscape, whose compact strip has no activity line above it. It
	 *  opens More, which lists the count and — where the surface can open the
	 *  queue — the way in; it is never a disabled control. */
	const queuedLabel = t("mobile.chrome.composer.queued", {
		count: queuedCount,
	});
	/* `planned` is the card's form of the chip: RIGID, at the width the chip
	 *  plan charged for it. The compact strip's chip shrinks instead — it is the
	 *  only shrinker on that row. On the card the model already shrinks to a
	 *  floor, and a second floored shrinker after it is the yoga#2006 shape
	 *  that once threw the trailing controls off the row (`composer-layout.ts`). */
	const queuedChipFor = (bare: boolean, planned: { width: number } | null) =>
		queuedCount > 0 ? (
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={queuedLabel}
				onPress={() => setContextOpen(true)}
				/* Bounded width is the point (UX round 5, U2): an unconstrained
				 *  label at 200 % text pushed the dismiss control past the 390 pt
				 *  edge. The sentence stays on the accessibility label; the visible
				 *  text falls back to the bare count when the type is large. */
				style={{
					minWidth: TOUCH_FLOOR,
					/* The floor on BOTH axes, owned by the chip and not by the
					 *  strip: with only a width floor it shrank to its 17 pt line of
					 *  text (U-01, every S5 cell with a queue), a target the row's
					 *  44 pt height hid — and a shorter strip (the spec's 36 pt) must
					 *  never take the target down with it. */
					minHeight: TOUCH_FLOOR,
					maxWidth: planned === null ? 160 : planned.width,
					flexShrink: planned === null ? 1 : 0,
				}}
				className="items-center justify-center px-1"
				testID={SURFACE.queuedMessageChip}
			>
				<Text className="text-meta text-ink-dim" numberOfLines={1}>
					{bare ? String(queuedCount) : queuedLabel}
				</Text>
			</Pressable>
		) : null;
	const queuedChip = queuedChipFor(dictationLargeText, null);

	/* WHAT FITS ON THE CARD'S CONTROLS ROW (visual audit D5). The zone between
	 *  attach and the mic/send cluster is measured, and effort leaves the row
	 *  before the model's name is cut: `claude-op… High` told the reader less
	 *  than `claude-opus-5` alone, and a dropped effort is still one tap away in
	 *  More. The zone is `flex-1` between fixed-width siblings, so its width does
	 *  not depend on which chips it holds — the measurement cannot feed itself. */
	const moreSlot = 1;
	const chipPlan = composerChipPlan({
		width: chipZoneWidth,
		scale: effectiveScale,
		modelChars: modelChip.kind === "loading" ? 12 : modelChip.text.length,
		effortChars:
			!effortChip || (effortChip.kind === "value" && effortChip.rowHidden)
				? null
				: effortChip.kind === "loading"
					? 4
					: effortChip.text.length,
		folder: !!folderChip,
		trailing: moreSlot,
		touchFloor: TOUCH_FLOOR,
		/* Large text shows the bare number in either form (UX round 5, U2), so
		 *  the sentence is charged at the number's width there. */
		queued:
			queueOnCard && queuedCount > 0
				? {
						labelChars: dictationLargeText
							? String(queuedCount).length
							: queuedLabel.length,
						countChars: String(queuedCount).length,
					}
				: null,
	});
	/* The count on the card (review round 1, M1). Before this the chip mounted
	 *  only on the compact strip and the count otherwise rode the host's
	 *  activity line — which a tablet and a narrow short-landscape split do not
	 *  have, so a queued message was announced (More's name) and never shown. */
	const cardQueuedChip = chipPlan.queued
		? queuedChipFor(
				dictationLargeText || chipPlan.queued.form === "count",
				chipPlan.queued,
			)
		: null;
	const chipZone = (
		<View
			className={COMPOSER_CHIP_ZONE}
			/* Never narrower than what it must always show: its one trailing
			 *  control (More / dismiss) and, where the card carries it, the queued
			 *  count beside it — so the zone's clip can cut a chip but never those. */
			style={{
				minWidth:
					TOUCH_FLOOR +
					(chipPlan.queued ? chipPlan.queued.width + COMPOSER_META_GAP_PT : 0),
			}}
			testID={SURFACE.composerMeta}
			onLayout={(event) =>
				setChipZoneWidth(Math.floor(event.nativeEvent.layout.width))
			}
		>
			{/* The home's folder chip leads: where, then with what model, then how
			 *  hard — one chip per picker (the operator: "a separate dialog to
			 *  handle directory vs model vs effort selection"). Glyph + the folder's
			 *  name, capped, glyph only at large text; it yields first
			 *  (`HOME_STRIP_SHRINK`, design D2). The session view passes none. */}
			{/* TODO(native, O1): a min-floored shrinker (folder) FIRST, then another
			 *  shrinker (model), is the yoga#2006 shape. Effort is rigid here and
			 *  leaves the row by plan rather than by shrinking, which removes one of
			 *  the three shrinkers the old strip had; still needs a device check. */}
			{folderChip ? (
				<View
					style={{
						flexShrink: HOME_STRIP_SHRINK.folder,
						minWidth: MODEL_FLOOR_PT,
						maxWidth: FOLDER_CHIP_MAX_PT,
					}}
				>
					<ComposerChipButton
						chip={{
							kind: "value",
							text: folderChipText(folderChip.label, effectiveScale),
							accessibilityLabel: folderChip.accessibilityLabel,
						}}
						leadingIcon={<Folder color={folderInk} size={16} aria-hidden />}
						onPress={folderChip.onPress}
						chooseHint={folderChip.accessibilityHint}
						loadingWidthClassName="w-16"
						testID={CONTROL.homeFolderChip}
					/>
				</View>
			) : null}
			{chipPlan.model ? (
				<View
					/* The model keeps its NATURAL width and never grows (operator,
					 *  TestFlight 578: "left justify the effort selector with the other
					 *  selectors on that row"), so the chips pack at the leading edge
					 *  beside attach. It is the row's one elastic chip: it shrinks to
					 *  its floor and ellipsizes only after effort has left. */
					className="min-w-0 shrink"
					style={{
						minWidth: MODEL_FLOOR_PT,
						flexBasis: "auto",
						flexShrink: HOME_STRIP_SHRINK.model,
					}}
				>
					<ComposerChipButton
						chip={modelChip}
						onPress={onOpenModels}
						chooseHint="Choose the model"
						loadingWidthClassName="w-24"
						testID={CONTROL.composerModelChip}
					/>
				</View>
			) : null}
			{effortChip && chipPlan.effort ? (
				/* Rigid: an effort that shrank was the `Hi…` the audit saw. It is
				 *  either whole or in More. */
				<View style={{ flexShrink: 0 }}>
					<ComposerChipButton
						chip={effortChip}
						onPress={onOpenEffort}
						chooseHint="Choose the effort"
						loadingWidthClassName="w-7"
						testID={CONTROL.composerEffortChip}
					/>
				</View>
			) : null}
			{/* `ms-auto`: the slot holds the zone's trailing edge whether or not
			 *  effort is on the row, so More does not slide left when effort
			 *  leaves; the chips still pack left (TestFlight 578). */}
			{/* ONE trailing slot, two occupants. While the field has the keyboard
			 *  the slot is the way to put it down; otherwise it is More. Both in one
			 *  slot because a second 44 pt control here costs the model its name at
			 *  390 pt, and a sheet opened over a raised keyboard is the wrong order
			 *  anyway — More is one blur away. */}
			{/* The queued count rides the SAME trailing slot, ahead of More: one
			 *  auto margin still absorbs the zone's free width, so neither moves
			 *  when effort leaves the row. */}
			<View
				className={COMPOSER_CHIP_TRAILING}
				testID={SURFACE.composerStripTrailing}
			>
				{cardQueuedChip}
				{keyboardVisible || focused ? (
					<IconButton
						accessibilityLabel={t("mobile.chrome.composer.dismiss_keyboard")}
						onPress={() => {
							inputRef.current?.blur();
							Keyboard.dismiss();
						}}
						icon={({ color, size }) => (
							<KeyboardIcon color={color} size={size} />
						)}
						testID={CONTROL.composerDismissKeyboard}
					/>
				) : (
					<IconButton
						accessibilityLabel={
							queuedCount > 0
								? `${t("mobile.chrome.composer.more")}, ${t("mobile.chrome.composer.queued", { count: queuedCount })}`
								: t("mobile.chrome.composer.more")
						}
						onPress={() => setContextOpen(true)}
						icon={({ color, size }) => (
							<MoreHorizontal color={color} size={size} />
						)}
						testID={CONTROL.composerContext}
					/>
				)}
			</View>
		</View>
	);

	/* D7: Clear is a small trailing ✕ at the end of the field row, shown only
	 *  while there is something to clear. It was a centred text button at the
	 *  top of the card, above the attachments, where it read as the card's
	 *  title. Clearing also puts the keyboard down, so the card is back at its
	 *  resting height in one press (the operator: "shrinks back once cleared").
	 *  The host's `onClearDraft` clears the unsent editor only — never a
	 *  retained instruction, an uncertainty row or the queue (#206). */
	const clearDraft =
		onClearDraft && (draft.length > 0 || images.length > 0) ? (
			<IconButton
				accessibilityLabel={t("mobile.composer_input.clear_draft")}
				accessibilityHint={t("mobile.composer_input.clear_draft_hint")}
				disabled={attaching || controls.sending}
				onPress={() => {
					onClearDraft();
					inputRef.current?.blur();
					Keyboard.dismiss();
					setFocused(false);
				}}
				icon={({ color, size }) => <X color={color} size={size} />}
				size={16}
				testID={CONTROL.composerClearDraft}
			/>
		) : null;

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
			{queuedChip}
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
	/* Hidden while RECORDING: the recording row's ✓ is the one finish control and
	 *  its ✕ the one discard, so a third control (■ "Stop and transcribe") doing
	 *  exactly what ✓ does read as a different action (design D2 / UX U4). It
	 *  returns, dimmed, while transcribing so the slot does not blink twice. */
	const mic =
		voice === null || voice.phase === "recording" ? null : voice.micVisible ? (
			/* The voice mic: the relay says voice input can run here AND this build
			 * can record (`voice.micVisible`). */
			<IconButton
				accessibilityLabel={micLabel(voice.phase)}
				accessibilityHint={MIC_HINT[voice.phase]}
				disabled={voice.phase === "transcribing"}
				onPress={voice.press}
				icon={({ color, size }) => <Mic color={color} size={size} />}
				testID={CONTROL.composerMic}
			/>
		) : voice.micSetup ? (
			/* The SET-UP mic: the computer answered that it has no speech-to-text.
			 * Shown (not hidden) so the reader learns the fix lives on the computer —
			 * a press puts that sentence on the status row and records nothing. The
			 * glyph is the same Mic: a struck-through mic reads as "muted", which is
			 * a different (and wrong) state. */
			<IconButton
				accessibilityLabel={t("mobile.composer_input.voice.mic_setup")}
				accessibilityHint={t("mobile.composer_input.voice.mic_setup_hint")}
				onPress={voice.press}
				icon={({ color, size }) => <Mic color={color} size={size} />}
				testID={CONTROL.composerMic}
			/>
		) : null;
	/* The clipboard-image offer (TestFlight 578: "I can't paste images into the
	 *  composer"). A native field never hands a pasted image to JS, so while the
	 *  reader is composing and the clipboard holds one, this chip offers it. It
	 *  runs `onAttach("paste", "offer")` — the attach sheet's own Paste read — so
	 *  the iOS paste prompt, a denial (`pasteNothingLine`), a failed read and the strip are one
	 *  path. It lives on the controls row, which only paints while the field is
	 *  focused (the expanded card), so it appears without moving the composer. */
	const pasteChip = pasteOffer.visible ? (
		<Chip
			label={t("mobile.composer_input.paste.image")}
			accessibilityHint={t("mobile.composer_input.paste.image_hint")}
			leadingIcon={
				<ClipboardPaste size={ATTACH_GLYPH_PT} color={attachInk} aria-hidden />
			}
			quiet
			shrink
			disabled={attaching}
			onPress={() => {
				/* `"offer"`: an empty answer to THIS press is the iOS denial, not an
				 *  empty clipboard, and is said as such (`pasteNothingLine`, U3). */
				onAttach("paste", "offer");
			}}
			testID={CONTROL.composerPasteImage}
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
					accessibilityState={state({ busy: stopping })}
					style={{ minWidth: TOUCH_FLOOR, minHeight: TOUCH_FLOOR }}
					onPress={onStop}
					testID={CONTROL.composerStop}
				>
					{/* A 44 pt `danger-wash` DISC one `gap-1` step from send (D-S5, the
					 *  relay's stop): 4 pt disc to disc on iOS, 8 pt on the 48 pt floor
					 *  where each 44 pt disc is centred in its 48 pt target (U-42).
					 *  the bare "■" glyph floated ~30 pt from send and read as decoration.
					 *  The wash is quiet enough not to compete with the accent send disc. */}
					<View
						className={cx(COMPOSER_DISC, "bg-danger-wash")}
						style={{ opacity: stopping ? 0.6 : 1 }}
					>
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
				/* Why the primary is dead, on the control itself: the visible
				 *  sentence yields to the retained notice (D6), and a screen reader
				 *  landing on a disabled Send should still hear the reason. */
				accessibilityHint={
					controls.primary.disabled
						? (controls.disabledReason ?? undefined)
						: undefined
				}
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
		voice !== null &&
		micShown &&
		(rowIsLive(voice.phase) || voice.status !== "") ? (
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
							{dictationControls(trailing !== "finish")}
						</View>
					</>
				) : (
					<>
						{dictationDot}
						{dictationStatus}
						{dictationControls(trailing !== "finish")}
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
				className={`flex-row ${composerFieldRowAlign(presentation.expanded)}`}
				/* At rest the row is `composerRestRow` (48, H5): the on-scale 4 pt
				 *  padding is balanced against it, so the pill stays 56, and the
				 *  row is CENTRED so iOS's 44 pt children split the slack 2/2
				 *  (R1). Open, the field's row is the 44 pt ruler of the 112 sum. */
				style={{
					minHeight: presentation.expanded
						? COMPOSER_FIELD_BOX
						: composerRestRow(TOUCH_FLOOR),
				}}
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
						/* The field's own box is the dock's ruler: the 48 pt resting row
						 * and 44 pt in both open rows, so 56 = 4 + 48 + 4 and
						 * 112 = 12 + 44 + 4 + 44 + 8 hold
						 * whatever the platform adds around the text box (a web
						 * `<textarea>` measured 48 before `border-box`). Past the
						 * budget the field scrolls itself and the dock stops growing. */
						maxHeightPx={fieldMaxHeight ?? undefined}
						/* One line of placeholder, always (§2.5 D1): the field's resting height
						 * must not grow with a wrapped placeholder, or the last transcript row is
						 * pushed past the scroller at 200 % text (design round 1, D1/D2). */
						placeholderMaxLines={1}
						// A web submit shares the footer's availability and in-flight latch.
						// Native's honestly labelled Return key stays newline-only.
						onSubmitEditing={() => {
							if (canSendRef.current) sendRef.current();
						}}
						fieldRef={inputRef}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						testID={CONTROL.composerInput}
					/>
				</View>
				{clearDraft}
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
					{restsAsCard ? (
						<>
							{/* The paste offer leads the zone while it is up (it only exists
							 *  with the field focused). The zone keeps its floor beside
							 *  it, so the keyboard-dismiss in its trailing slot is never
							 *  the thing the offer pushes off the row; the chips yield by
							 *  plan, as they do for any narrow zone. */}
							{pasteChip}
							{chipZone}
							{/* ONE slot for the mic, whatever the card is open for. The
							 *  card no longer expands out of a pill under the finger that
							 *  pressed the mic, so nothing slides: the mic stays here,
							 *  Send stays beside it, and while RECORDING on an otherwise
							 *  empty card the ✓ takes the mic's own slot — the spot a
							 *  tap-to-toggle reader taps again (UX round 2, U7). It still
							 *  MOVES there from the dictation row, never copied. */}
							{trailing === "finish" ? dictationFinish : mic}
							{actionCluster}
						</>
					) : (
						<>
							{trailing === "actions" ? mic : null}
							{pasteChip}
							{/* Landscape has exactly ONE context affordance, and it is the
							 *  one in the compact strip: a second More on this row was the
							 *  same action twice in one 44 pt line (design round 6, D2). */}
							{trailing === "actions" ? (
								actionCluster
							) : (
								<View className={COMPOSER_ACTION_CLUSTER}>
									{trailing === "finish" ? dictationFinish : mic}
								</View>
							)}
						</>
					)}
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

	/* The dock is measured as one unit — the context strip plus the shell — and
	 * NOT its clearance: the 8 pt gap is the dock's own margin (`dockMotion`) and
	 * the safe-area inset is the carrier's padding below, both outside the box
	 * `onMeasure` reads, so a host that reserves the footprint adds them itself.
	 * The fill is solid unless `glass` (design spec §12): see the shell's fill
	 * layer below. */
	const dock = (
		<Animated.View
			ref={rootRef}
			style={[{ marginHorizontal: 12 }, dockMotion]}
			onLayout={(event) => {
				onLayout?.(event);
				/* The dock's own width, for the short-landscape fit: the strip that
				 *  used to report it is gone from the card, and the dock is the same
				 *  width the strip was (the window less the 12 pt side margins). */
				setMetaWidth(Math.ceil(event.nativeEvent.layout.width));
				publishBox();
			}}
			testID={testID}
		>
			{compactSingle ? compactReceipt : null}
			<Animated.View
				style={[
					{
						backgroundColor: glass ? "transparent" : elevated,
						/* The record's paddings, interpolated with the same progress
						 * value as the shape: 4/4 at rest (4 + 48 + 4 = 56, H5) and 12/8
						 * expanded (12 + 44 + 4 + 44 + 8 = 112). `composerPaintedHeight`
						 * is the one place those sums are written down. */
						...shellBox,
						/* The box travels between two measured ends, so for part of
						 *  the morph it is shorter than the content it holds. Clipping
						 *  there is the card's own edge; spilling painted controls
						 *  outside the card, which is what the design round saw. */
						overflow: "hidden",
						paddingHorizontal: 12,
						/* The 4 pt above the shell separated it from the chip strip;
						 *  with no strip above the card there is nothing to separate. */
						marginTop: 0,
					},
					shellMotion,
				]}
			>
				{/* THE GLASS FILL (design spec §12), routed through `ChromeSurface`
				 *  like every other glass in the app. With glass on, the shell above
				 *  paints NO colour (`transparent`) — a fill there would cover the
				 *  material; solid keeps its `elevated` exactly as before. An absolutely positioned layer,
				 *  painted first, rather than the shell itself: the shell's height and
				 *  radius are ANIMATED (reanimated styles), which `ChromeSurface`'s
				 *  static radii props cannot carry, so the shell keeps its geometry and
				 *  its `overflow: hidden` clips this layer to the live shape — which
				 *  holds only while the layer's radius never exceeds the clip's, hence
				 *  `COMPOSER_GLASS_LAYER_RADIUS` rather than the target radius (R2). An
				 *  absolute child adds nothing to layout, so a glass frame and the
				 *  solid frame have a zero box diff; `pointerEvents="none"` because a
				 *  layer across this band must never take the field's taps (round 4,
				 *  U1/U2/U3). Solid draws no layer: the fallback is unchanged. */}
				{glass ? (
					<View
						pointerEvents="none"
						style={{
							position: "absolute",
							top: 0,
							bottom: 0,
							start: 0,
							end: 0,
						}}
					>
						<ChromeSurface
							glass
							radii={{
								top: COMPOSER_GLASS_LAYER_RADIUS,
								bottom: COMPOSER_GLASS_LAYER_RADIUS,
							}}
							style={{ flex: 1 }}
						>
							{null}
						</ChromeSurface>
					</View>
				) : null}
				<View onLayout={measureContent}>
					<ScrollView
						style={{ flexGrow: 0, flexShrink: 0, maxHeight: extrasMaxHeight }}
						scrollEnabled={extrasMaxHeight !== undefined}
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
				{/* THE SHELL'S FOCUS EDGE (D8: transparent at rest, so the fill is the
				 *  card's only separation). Still drawn as an absolutely positioned child rather than a
				 *  `borderWidth` on the shell. The shell's height is a border box, so a border
				 *  there takes 1 pt off each edge of the interior: the 44 pt field paints 42,
				 *  under the touch floor, and every measured seed lands 2 pt short of its end
				 *  (54/110, 54/118 on the 48 floor). The RADII do not follow it down — that is
				 *  the part an earlier draft of this comment got wrong: `baseHeight` is
				 *  `max(seededBase, measured)` and `seededBase` comes from the same pure
				 *  `composerPaintedHeight`, so a short measured seed loses to the 56 floor
				 *  and the pill stays R28. Nothing in the suite renders a box either — the
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
							borderColor: focused ? borderControl : "transparent",
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
				<ContextRow
					label={t("mobile.chrome.composer.row_model")}
					value={chipRowValue(modelChip)}
					accessibilityLabel={modelChip.accessibilityLabel}
					accessibilityHint={
						modelChip.kind === "unavailable"
							? modelChip.accessibilityHint
							: "Choose the model"
					}
					disabled={modelChip.kind !== "value"}
					onPress={() => {
						setContextOpen(false);
						onOpenModels();
					}}
					testID={CONTROL.composerContextModel}
				/>
				{effortChip ? (
					<ContextRow
						label={t("mobile.chrome.composer.row_effort")}
						value={chipRowValue(effortChip)}
						accessibilityLabel={effortChip.accessibilityLabel}
						accessibilityHint={
							effortChip.kind === "unavailable"
								? effortChip.accessibilityHint
								: "Choose the effort"
						}
						disabled={effortChip.kind !== "value"}
						onPress={() => {
							setContextOpen(false);
							onOpenEffort();
						}}
						testID={CONTROL.composerContextEffort}
					/>
				) : null}
				{/* No folder row here: the card leads with the chip, and a second copy
				 *  in More was two entry points for one setting (UX U5). */}
				{contextLabel ? (
					<ContextRow
						label={t("mobile.chrome.composer.row_usage")}
						value={contextLabel}
					/>
				) : null}
				{costLabel ? (
					<ContextRow
						label={t("mobile.chrome.composer.row_cost")}
						value={costLabel}
					/>
				) : null}
				{queuedCount > 0 ? (
					<View>
						<ContextRow
							label={t("mobile.chrome.composer.row_queue")}
							value={t("mobile.chrome.composer.queued", {
								count: queuedCount,
							})}
						/>
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
	/* THE INSET CARRIER (see `dockMotion`). The dock keeps its ref, `onLayout`
	 *  and `testID`, so every measurement the hosts take — `onMeasure`'s rect,
	 *  the recovery height — reads the same box as before; only the carrier's
	 *  padding, which no host measures, holds the inset. */
	return <View style={{ paddingBottom: dockInset }}>{dock}</View>;
};
