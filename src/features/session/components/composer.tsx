// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { useMemo } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

import type { PromptImage } from "@/contracts";
import {
	attachmentLabel,
	COMPOSER_COPY,
	type ComposerControls,
} from "@/features/session/composer";

import { ROLE, state } from "@/ui/a11y";
import { Button, Chip, Textarea } from "@/ui/components";
import { cx } from "@/ui/variants";

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
	modelLabel: string;
	effortLabel: string;
	onOpenModels: () => void;
	onOpenEffort: () => void;
	/** A leading `/` opens the sheet; `null` keeps it shut. */
	slashQuery: string | null;
	slashSheet: React.ReactNode;
	testID?: string;
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
	modelLabel,
	effortLabel,
	onOpenModels,
	onOpenEffort,
	slashQuery,
	slashSheet,
	testID = "session-composer",
}: ComposerProps) => {
	const attachmentSummary = useMemo(
		() => images.map(attachmentLabel).join(" · "),
		[images],
	);

	return (
		<View className="border-t border-hairline px-3 pt-1.5 pb-2" testID={testID}>
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
									testID={`composer-attachment-${index}`}
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
						testID="composer-resume"
					/>
				</View>
			) : null}

			{notice !== null ? (
				<View className="pb-1.5 rounded-sm border border-success-border bg-success-wash px-3 py-2">
					<Text
						className="text-body-sm text-success"
						accessibilityLiveRegion="polite"
						testID="composer-notice"
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
						testID="composer-retained"
					>
						{retainedMessage}
					</Text>
					<View className="pt-2">
						<Button
							label={COMPOSER_COPY.retryLabel}
							variant="outline"
							size="sm"
							onPress={onRetry}
							testID="composer-retry"
						/>
					</View>
					{/* U4: name why the primary is dead while the retry is unresolved, so a
					    disabled ↑ reads as intentional rather than as a broken button. */}
					<Text className="pt-1.5 text-meta text-danger">
						{COMPOSER_COPY.retryDisabledHint}
					</Text>
				</View>
			) : null}

			{error !== null ? (
				<View className="mb-1.5 rounded-sm border border-danger-border bg-danger-wash px-3 py-2">
					<Text
						className="text-body-sm text-danger"
						accessibilityLiveRegion="assertive"
						testID="composer-error"
					>
						{error}
					</Text>
				</View>
			) : null}

			<View className="flex-row items-end gap-2">
				<View className="min-w-0 flex-1">
					<Textarea
						label="Message"
						value={draft}
						onChangeText={onDraftChange}
						placeholder={COMPOSER_COPY.placeholder}
						maxLines={6}
						testID="composer-input"
					/>
				</View>
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel="Attach an image"
					accessibilityState={state({ busy: attaching, disabled: attaching })}
					disabled={attaching}
					onPress={onAttach}
					testID="composer-attach"
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
						testID="composer-stop"
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
					testID="composer-send"
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
			    its own, and the chips are the reader's two levers on the turn. */}
			<View className="flex-row items-center gap-2 pt-1.5">
				{queuedCount > 0 ? (
					<Text
						className="text-mono-sm text-ink-dim"
						testID="queued-message-chip"
					>
						{queuedCount} queued
					</Text>
				) : null}
				<View className="flex-1" />
				<Chip
					label={modelLabel}
					onPress={onOpenModels}
					accessibilityHint="Choose the model"
					testID="composer-model-chip"
				/>
				<Chip
					label={effortLabel}
					onPress={onOpenEffort}
					accessibilityHint="Choose the effort"
					testID="composer-effort-chip"
				/>
			</View>
			{/* The receipt anchor `08-connection-loss-recovery` asserts after a send
			    across a reconnect: it is the composer's own "the instruction left" mark. */}
			<View testID="composer-receipt" aria-hidden />
			{slashQuery !== null ? slashSheet : null}
		</View>
	);
};
