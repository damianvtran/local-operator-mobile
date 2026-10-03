// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { useEffect, useMemo, useRef } from "react";
import {
	Image,
	Platform,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";

import type { PromptImage } from "@/contracts";
import type { ComposerChip } from "@/features/session/chip-labels";
import { ComposerStateMarkers } from "@/features/session/components/state-markers";
import {
	attachmentLabel,
	COMPOSER_COPY,
	type ComposerControls,
} from "@/features/session/composer";
import { isSendKey } from "@/features/session/keyboard";
import { CONTROL, composerAttachmentId, ROLE, SURFACE, state } from "@/ui/a11y";
import { Button, Chip, Skeleton, Textarea } from "@/ui/components";
import { cx } from "@/ui/variants";

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
	addEventListener: (
		type: string,
		listener: (event: WebKeyEvent) => void,
	) => void;
	removeEventListener: (
		type: string,
		listener: (event: WebKeyEvent) => void,
	) => void;
	querySelector: (selector: string) => unknown;
};

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
	onAttach: () => void;
	attaching?: boolean;
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
	/** The two chips, each in one of its three states — value, unavailable, or
	 *  loading while a projection is still expected. The decision lives in
	 *  `chip-labels.ts` rather than here, because "loading" and "unavailable" look
	 *  alike on screen and mean opposite things (design round 1 D6, round 2 D14;
	 *  review round 4 R7/R8). */
	modelChip: ComposerChip;
	effortChip: ComposerChip;
	onOpenModels: () => void;
	onOpenEffort: () => void;
	/** A leading `/` opens the sheet; `null` keeps it shut. */
	slashQuery: string | null;
	slashSheet: React.ReactNode;
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
	attaching = false,
	onSend,
	onStop,
	retainedMessage,
	notice,
	onRetry,
	showResume,
	onResume,
	error,
	queuedCount,
	modelChip,
	effortChip,
	onOpenModels,
	onOpenEffort,
	slashQuery,
	slashSheet,
	testID,
}: ComposerProps) => {
	const attachmentSummary = useMemo(
		() => images.map(attachmentLabel).join(" · "),
		[images],
	);

	/* The handler the listener calls, kept in a ref: re-attaching the listener on
	 * every render (to capture the current closure) is the other way to do this, and
	 * it drops keydowns in the gap between removing and adding. */
	const sendRef = useRef(onSend);
	const canSendRef = useRef(false);
	useEffect(() => {
		sendRef.current = onSend;
		canSendRef.current = !controls.primary.disabled && !attaching;
	}, [onSend, controls.primary.disabled, attaching]);

	const rootRef = useRef<View | null>(null);
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
						// Kept because it is the callback a hardware keyboard submits
						// through, and it costs nothing — but see the note above: on this RN
						// version a multiline field never dispatches it. Native is NOT RUN
						// here, so this records the gap rather than a behaviour.
						onSubmitEditing={onSend}
						testID={CONTROL.composerInput}
					/>
				</View>
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel="Attach an image"
					accessibilityState={state({ busy: attaching, disabled: attaching })}
					disabled={attaching}
					onPress={onAttach}
					testID={CONTROL.composerAttach}
				>
					<View className="h-11 w-11 items-center justify-center rounded-full border border-control">
						<Text className="text-ink-muted" aria-hidden>
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
						<Text
							className={cx(
								"text-body-sm font-medium",
								controls.primary.disabled
									? "text-ink-disabled"
									: "text-on-accent",
							)}
						>
							{controls.primary.label}
						</Text>
					</View>
				</Pressable>
			</View>

			{/* The receipt line: the queued count is the only thing here that changes on
			    its own, and the chips are the reader's two levers on the turn.

			    `flex-wrap` is what keeps the levers REACHABLE at 200 % platform text
			    (design round 4, D28): the model chip's label alone is 213 pt there, so a
			    nowrap row put the effort chip entirely beyond a 320 pt viewport
			    (measured: `composer-effort-chip` 267.2 → 336.4 at 150 %, 335.6 → 419.2 at
			    200 %) — a control no finger can reach. Wrapping costs a second line only
			    at the scales that need one, and takes nothing away at 100 %. */}
			<View className="flex-row flex-wrap items-center gap-2 pt-1.5">
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
				<ComposerChipButton
					chip={effortChip}
					onPress={onOpenEffort}
					chooseHint="Choose the effort"
					loadingWidthClassName="w-7"
					testID={CONTROL.composerEffortChip}
				/>
			</View>
			{/* The receipt anchor `08-connection-loss-recovery` asserts after a send
			    across a reconnect: it is the composer's own "the instruction left" mark. */}
			<View testID={SURFACE.composerReceipt} aria-hidden />
			{slashQuery !== null ? slashSheet : null}
		</View>
	);
};
