// biome-ignore-all lint/suspicious/noArrayIndexKey: every list here is regenerated from the same record on each render (the row's own `files`/`components` arrays), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Image,
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";

import { refusalText } from "@/features/session/asks";
import { SupplementWebView } from "@/features/session/components/supplement-webview";
import { toBase64 } from "@/features/session/runtime";
import {
	COPY_ADJUST,
	COPY_CANCEL,
	COPY_CANCELLED,
	COPY_FAILED,
	COPY_PREPARING,
	COPY_RETRY,
	COPY_SHOW_FEWER,
	countClause,
	displayText,
	type FilesSummaryEntry,
	fileRowParts,
	filesSummaryEntries,
	frameBudgetPx,
	MORE_MAX,
	moreText,
	OP_LEAD,
	planComponentMounts,
	STEER_TEXT_MAX_CHARS,
	type SupplementBeat,
	type SupplementComponent,
	type SupplementFile,
	type SupplementFileClass,
	showAllText,
	supplementDisposition,
	supplementFileClass,
} from "@/features/session/supplements";
import { CONTROL, SURFACE, supplementFileId } from "@/ui/a11y";
import { Input, Shimmer } from "@/ui/components";
import { cx } from "@/ui/variants";

/**
 * The block under a final answer: file callouts, the quiet state line and any
 * generated components (turn-supplements memo §2.8, lane N).
 *
 * THE BODY-ONLY RULE (memo §2.8; operator directive 2026-10-10): the block
 * renders NO header, label, title, badge or separator. It starts directly with
 * its content, seamlessly under the answer's text; spacing and rhythm alone
 * carry the seam. The one caption allowed anywhere in the block is the frame's
 * own `Source: …` line, and the component's `title` is its name for tooling
 * and accessibility, never painted chrome.
 *
 * THE STATES are `supplementDisposition` — the frozen reader rule every surface
 * ports — and this component is only its renderer:
 *   - `preparing` / `files_preparing` — the row's callouts, then
 *     `◌ Preparing highlights… · Adjust… · Cancel`; the pair is drawn together
 *     or not at all, both visible, both ≥ 44 pt (D10 — there is no hover on a
 *     phone, so a control that appears on hover would not exist);
 *   - `block` — files, then components, then nothing else;
 *   - `cancelled_retry` / `failed_retry` — the one quiet line with `· Retry`
 *     (`supplement_restart`, the runtime's own arm);
 *   - `nothing` — renders nothing at all.
 *
 * THE ADJUST FORM'S EXITS (UX round 1, U1/D3): the web pair closes it on
 * Escape; a phone has no Escape key, so the phone's exits are explicit — the
 * `Adjust…` trigger stays visible as a toggle, an empty Return closes the form,
 * and the form closes itself the moment its row leaves `preparing` (it must
 * not outlive the job it steers).
 *
 * DISABLED CONTROLS step their ink (`ink-dim` → `ink-disabled`): the kit's
 * table makes disabled "a colour change, never an opacity change", and this
 * surface's enabled ops already sit at `ink-dim`, so the next rung is the step
 * (design round 1, D2).
 *
 * THE OPS RIDE THE SAME SESSION COMMAND ROUTE every other mutation uses
 * (`use-session.ts`'s supplement wiring → `POST /api/sessions/{id}/command`),
 * scoped by the session in the URL and the anchor+job pair in the frame. The
 * relay forwards them to the live runtime, whose receipt is the answer's
 * `detail` (`cancelled` / `steering` / `restarting` / the neutral
 * `already finished`); this component never paints a receipt as an outcome —
 * the ROW's next state is the outcome, exactly as every surface's receipt rule
 * says. A REFUSAL (no live session: 409; an older owner or a bad shape: 422; a
 * transport failure: 502/504) is the one thing the reader must see, painted
 * under the line in the app's refusal voice (the lead names the press, the rest
 * is the relay's own sentence) and cleared by the next press.
 *
 * WHAT THIS FILE DOES NOT DO. No component document is interpreted; no file
 * is listed or read beyond the row's own recorded callouts (the sensitivity
 * predicate is the server's, re-applied by the relay route — this surface
 * renders what the row carries and fetches only by the row's own index).
 */

/**
 * The block's host calls, injected by the screen: this component never holds a
 * relay client (the `loadImage`/`onOpenAgent` convention of the transcript).
 */
export interface SupplementClient {
	/** One component's assembled document, `{html}`; rejects with the relay's
	 *  own refusal when the route refuses. */
	loadDocument: (digest: string) => Promise<string>;
	/** One callout's bytes, addressed by the row's own index. */
	loadFile: (
		job: string,
		index: number,
	) => Promise<{ bytes: Uint8Array; mimeType: string | null }>;
	/** `supplement_cancel` | `supplement_restart` | `supplement_steer`. */
	command: (
		op: "cancel" | "restart" | "steer",
		anchor: string,
		job: string,
		text?: string,
	) => Promise<void>;
}

/**
 * How much of a text preview renders. The route caps a served file at 10 MB,
 * and a phone cannot lay out ten megabytes of text; the tail is cut here and
 * the cut is SAID (a `first N characters` caption) — never silently, so a
 * reader never mistakes the end of a preview for the end of a file.
 */
const PREVIEW_TEXT_MAX_CHARS = 32000;

export type SupplementBlockProps = {
	beat: SupplementBeat;
	/** `beatLive(beat, projection.pid)` — computed where the projection is read;
	 *  the stale-row rule's input. */
	jobLive: boolean;
	/** The screen's host calls: one session-scoped client, so the block (and its
	 *  rows) never hold a relay client or a session id of their own. */
	client: SupplementClient;
};

export const SupplementBlock = ({
	beat,
	jobLive,
	client,
}: SupplementBlockProps) => {
	const disposition = supplementDisposition(beat, jobLive);
	const [adjusting, setAdjusting] = useState(false);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [opError, setOpError] = useState("");
	/*
	 * The rendered heights of frames already on screen, by digest: written by
	 * the frames' own resize beats, read by the budget's accrual. ONLY rendered
	 * heights arrive here (a frame reports after its first resize beat, never
	 * its reserved estimate): `planComponentMounts` holds the walk at any frame
	 * that has not reported, so a reserved value standing in for a measurement
	 * would defeat the accrual it exists for.
	 */
	const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(
		() => new Map(),
	);
	/*
	 * The sticky auto-mount count: a frame that ever mounted stays mounted, so
	 * a later measurement that makes the accrual STOP fitting (a document that
	 * overran its hint) never unmounts it under the reader. The state only
	 * grows, and `Math.max` against the live suggestion means a late
	 * measurement can mount the next frame in the same commit.
	 */
	const [sticky, setSticky] = useState(0);

	const { height: windowHeight } = useWindowDimensions();

	const sendOp = useCallback(
		async (op: "cancel" | "restart" | "steer", text = ""): Promise<void> => {
			setBusy(true);
			setOpError("");
			try {
				await client.command(op, beat.anchor, beat.job, text);
			} catch (error) {
				/* The refusal is composed, never echoed raw: the lead names the
				   press, the rest is the relay's own sentence (which a phone user
				   needs — "session not connected" and "update the owner" ask for
				   different next steps). */
				setOpError(`${OP_LEAD[op]}: ${refusalText(error)}`);
			} finally {
				setBusy(false);
			}
		},
		[beat.anchor, beat.job, client],
	);

	const steer = () => {
		const text = draft.trim();
		if (!text) {
			/* An empty Return is the phone's dismiss (there is no Escape key here;
			   the web pair closes on one — U1/D3). */
			setAdjusting(false);
			setDraft("");
			return;
		}
		setAdjusting(false);
		setDraft("");
		void sendOp("steer", text);
	};

	/*
	 * The form's third exit (D3): the moment the row leaves `preparing` — the
	 * job settled, failed, was cancelled, or the beat went stale — the form
	 * closes. Left open it would outlive the line it steers and turn a Send
	 * into the neutral `already finished` receipt with nothing to repaint.
	 * Declared before the `nothing` early return so the hook order is fixed.
	 */
	const preparing =
		disposition === "preparing" || disposition === "files_preparing";
	useEffect(() => {
		if (adjusting && !preparing) setAdjusting(false);
	}, [adjusting, preparing]);

	const noteHeight = useCallback((digest: string, height: number) => {
		setMeasured((prev) => {
			if (prev.get(digest) === height) return prev;
			const next = new Map(prev);
			next.set(digest, height);
			return next;
		});
	}, []);

	/*
	 * The aggregate frame budget (§2.8): frames mount automatically only within
	 * a cumulative min(480px, 40vh) of block height, accrued from each frame's
	 * RENDERED height; the rest sit behind ONE disclosure that expands in place
	 * on an explicit action. The stickiness below is the other half — an
	 * already-mounted frame stays even when a late measurement says the accrual
	 * no longer fits.
	 */
	const budgetPx = frameBudgetPx(windowHeight);
	const { visible } = planComponentMounts(beat.components, budgetPx, measured);
	useEffect(() => {
		setSticky((count) => Math.max(count, visible.length));
	}, [visible.length]);
	const autoCount = Math.min(
		beat.components.length,
		Math.max(sticky, visible.length),
	);
	/*
	 * The head mounts automatically; the tail is the disclosure's. Splitting
	 * ONCE (rather than a `shown`/`hidden` pair) is deliberate: an early draft
	 * computed a head and a tail independently and the open state then rendered
	 * the tail twice — once through the head it had swallowed and once through
	 * the disclosure's children.
	 */
	const head = useMemo(
		() => beat.components.slice(0, autoCount),
		[beat.components, autoCount],
	);
	const tail = useMemo(
		() => beat.components.slice(autoCount),
		[beat.components, autoCount],
	);

	const [moreOpen, setMoreOpen] = useState(false);
	const [showAllOpen, setShowAllOpen] = useState(false);

	if (disposition === "nothing") return null;

	const files = beat.files;
	const moreCount = beat.filesMore;
	const components = beat.components;
	const totalFiles = files.length + moreCount;

	/*
	 * The one quiet line for the arms that carry one (§2.8's copy table). The
	 * dot is the app's own Shimmer over a standing `ink-dim` fill: the shimmer
	 * is an opacity pulse (floor 0.72), so the fill underneath must itself be
	 * perceptible — `sunken` measured 1.06:1 against the canvas and read as
	 * nothing, parked or pulsing (design round 1, D4); `ink-dim` is 5.36/6.24:1,
	 * and the mark still parks rather than vanishing under reduced motion.
	 */
	const cancelled =
		disposition === "cancelled_retry" ||
		disposition === "files_cancelled_retry";
	const failed =
		disposition === "failed_retry" || disposition === "files_failed_retry";
	const stateLine =
		preparing || cancelled || failed ? (
			<View
				className="flex-row flex-wrap items-center gap-x-2 gap-y-1"
				testID={SURFACE.supplementStateLine}
			>
				{preparing ? (
					<>
						<Shimmer active>
							<View className="size-3 rounded-full bg-ink-dim" />
						</Shimmer>
						<Text className="text-meta text-ink-muted">{COPY_PREPARING}</Text>
					</>
				) : null}
				{cancelled ? (
					<Text className="text-meta text-ink-muted">{COPY_CANCELLED}</Text>
				) : null}
				{failed ? (
					<Text className="text-meta text-ink-muted">{COPY_FAILED}</Text>
				) : null}
				{/* The action pair is drawn TOGETHER or not at all (D10), both
				    visible, each a ≥ 44 pt target: a phone has no hover, so a
				    control that only appears on hover would not exist.
				    THE FLOOR IS `min-w-11`, not the label: `px-1` plus the
				    glyphs only clears 44 pt for the longer words, so `Retry`
				    measured 37 pt wide and failed U-01 on the failed line's
				    own frame (2 rows at one phone/100 %, 4 at CI's two-profile
				    scope) — a lone control, so the rubric's dense-list window
				    cannot apply. `min-w-11` is the same token step `min-h-11`
				    uses for height, so no label can shrink the target. */}
				{preparing ? (
					<>
						<Text aria-hidden className="text-meta text-ink-dim">
							·
						</Text>
						<Pressable
							accessibilityRole="button"
							/* A toggle, NOT a disappearing trigger (U1): the web pair closes the
							   form on Escape, and a phone has no Escape key — the trigger itself
							   is the explicit dismiss, so it stays visible while the form is
							   open. */
							accessibilityState={{ expanded: adjusting }}
							className="min-w-11 min-h-11 justify-center px-1"
							testID={CONTROL.supplementAdjust}
							onPress={() => setAdjusting((open) => !open)}
						>
							<Text className="text-meta text-ink-dim">{COPY_ADJUST}</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityState={{
								disabled: busy || beat.state === "cancelling",
							}}
							disabled={busy || beat.state === "cancelling"}
							className="min-w-11 min-h-11 justify-center px-1"
							testID={CONTROL.supplementCancel}
							onPress={() => void sendOp("cancel")}
						>
							<Text
								className={cx(
									"text-meta",
									busy || beat.state === "cancelling"
										? "text-ink-disabled"
										: "text-ink-dim",
								)}
							>
								{COPY_CANCEL}
							</Text>
						</Pressable>
					</>
				) : null}
				{cancelled || failed ? (
					<>
						<Text aria-hidden className="text-meta text-ink-dim">
							·
						</Text>
						<Pressable
							accessibilityRole="button"
							accessibilityState={{ disabled: busy }}
							disabled={busy}
							className="min-w-11 min-h-11 justify-center px-1"
							testID={CONTROL.supplementRetry}
							onPress={() => void sendOp("restart")}
						>
							<Text
								className={cx(
									"text-meta",
									busy ? "text-ink-disabled" : "text-ink-dim",
								)}
							>
								{COPY_RETRY}
							</Text>
						</Pressable>
					</>
				) : null}
			</View>
		) : null;

	const adjustLine = adjusting ? (
		<View
			className="flex-row items-center gap-2"
			testID={SURFACE.supplementAdjustForm}
		>
			<View className="min-w-0 flex-1">
				<Input
					label="Adjust the graphic"
					autoFocus
					returnKeyType="send"
					placeholder="Adjust the graphic…"
					value={draft}
					onChangeText={(value) =>
						setDraft(value.slice(0, STEER_TEXT_MAX_CHARS))
					}
					onSubmitEditing={steer}
					testID={CONTROL.supplementAdjustField}
				/>
			</View>
			{draft.length >= STEER_TEXT_MAX_CHARS - 50 ? (
				/* The bound is visible before it bites (U4): the field truncates at the
				   same constant, so a pasted tail is never lost unseen. */
				<Text className="text-meta text-ink-dim">
					{draft.length}/{STEER_TEXT_MAX_CHARS}
				</Text>
			) : null}
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ disabled: busy || draft.trim() === "" }}
				disabled={busy || draft.trim() === ""}
				className="min-h-11 justify-center px-2"
				testID={CONTROL.supplementSteerSend}
				onPress={steer}
			>
				<Text
					className={cx(
						"text-meta",
						busy || draft.trim() === "" ? "text-ink-disabled" : "text-ink-dim",
					)}
				>
					Send
				</Text>
			</Pressable>
		</View>
	) : null;

	/* A refusal the reader must see; cleared by the next press. */
	const errorLine = opError ? (
		<Text className="text-meta text-danger" testID={SURFACE.supplementOpError}>
			{opError}
		</Text>
	) : null;

	/*
	 * The files half first (memo §0). The ≤ 2 files one-liner applies when no
	 * COMPONENT rides the row and the whole known set is two files or fewer
	 * (the TUI's own rule, `total_files <= 2 and not components_present`), and
	 * it serves the preparing arm's callouts too — they are the same callouts a
	 * moment earlier. The copy comes from the model's own builder so the
	 * one-liner and the expanded block can never disagree — and each FEATURED
	 * name carries its own preview affordance (U3: the line must not be a dead
	 * end on a phone).
	 */
	let filesSection: React.ReactNode = null;
	if (files.length > 0 || moreCount > 0) {
		if (totalFiles <= 2 && components.length === 0) {
			const entries = filesSummaryEntries(beat);
			filesSection =
				entries.length === 0 ? null : (
					<SummaryFilesLine entries={entries} job={beat.job} client={client} />
				);
		} else {
			filesSection = (
				<View className="flex-col" testID={SURFACE.supplementFiles}>
					{files.map((file, index) => (
						<CalloutRow
							key={`${file.path}:${file.name}`}
							file={file}
							index={index}
							job={beat.job}
							client={client}
						/>
					))}
					{moreCount > 0 ? (
						/* The disclosure TOGGLES its words with the state, the sibling
						   surfaces' grammar exactly (`N more files` ⇄ `Show fewer` — the
						   relay web and the desktop UI; UX round 1, R6): the chevron says
						   the state, the label says the action. The tail's rows carry NO
						   preview affordance: the file route addresses `files[i]` by index
						   and the stored tail has none, so the honest row is name-only. */
						<View className="flex-col">
							<Pressable
								accessibilityRole="button"
								accessibilityState={{ expanded: moreOpen }}
								className="min-h-11 flex-row items-center gap-1"
								testID={CONTROL.supplementMoreFiles}
								onPress={() => setMoreOpen((open) => !open)}
							>
								<Text className="text-meta text-ink-dim" aria-hidden>
									{moreOpen ? "▾" : "▸"}
								</Text>
								<Text className="text-meta text-ink-dim">
									{moreOpen ? COPY_SHOW_FEWER : moreText(moreCount)}
								</Text>
							</Pressable>
							{moreOpen ? (
								<View className="flex-col gap-1 pb-1">
									{beat.more.slice(0, MORE_MAX).map((item) => (
										<View key={item} className="flex-row items-center gap-2">
											<Text
												className="min-w-0 flex-1 text-meta text-ink-muted"
												numberOfLines={1}
											>
												{displayText(item)}
											</Text>
										</View>
									))}
								</View>
							) : null}
						</View>
					) : null}
				</View>
			);
		}
	}

	/* The components, only on a settled block. The disclosure mounts the tail's
	   frames only while it is open — an explicit action, which is the memo's
	   own condition for mounting beyond the budget. */
	const componentsSection =
		disposition === "block" && components.length > 0 ? (
			<View className="flex-col gap-2" testID={SURFACE.supplementComponents}>
				{head.map((component) => (
					<FrameSlot
						key={component.attachment}
						component={component}
						onRetry={() => void sendOp("restart")}
						onHeight={noteHeight}
						client={client}
					/>
				))}
				{tail.length > 0 ? (
					<View className="flex-col">
						{/* The same toggle grammar as the files disclosure above
						   (`Show all N graphics` ⇄ `Show fewer`). */}
						<Pressable
							accessibilityRole="button"
							accessibilityState={{ expanded: showAllOpen }}
							className="min-h-11 flex-row items-center gap-1"
							testID={CONTROL.supplementShowAll}
							onPress={() => setShowAllOpen((open) => !open)}
						>
							<Text className="text-meta text-ink-dim" aria-hidden>
								{showAllOpen ? "▾" : "▸"}
							</Text>
							<Text className="text-meta text-ink-dim">
								{showAllOpen ? COPY_SHOW_FEWER : showAllText(tail.length)}
							</Text>
						</Pressable>
						{showAllOpen ? (
							<View className="flex-col gap-2 pb-1">
								{tail.map((component) => (
									<FrameSlot
										key={component.attachment}
										component={component}
										onRetry={() => void sendOp("restart")}
										onHeight={noteHeight}
										client={client}
									/>
								))}
							</View>
						) : null}
					</View>
				) : null}
			</View>
		) : null;

	/* THE ROOT'S STEP IS `gap-2`, the block's own inter-part step — the same 8 pt
	 *  `componentsSection` and the tail list use inside it, so the block reads as
	 *  one rhythm rather than a root tighter than its own children. It was
	 *  `gap-1.5` (6 pt): a half-step the utility vocabulary does not have, and the
	 *  only off-scale value U-42 found in this block (16 rows on one phone at
	 *  100 %, one per cell and scale — 96 at CI's six-cell x two-profile x
	 *  three-scale scope). The audit reads the scale, and 8 is a step of it. */
	return (
		<View className="flex-col gap-2" testID={SURFACE.supplementBlock}>
			{filesSection}
			{stateLine}
			{adjustLine}
			{errorLine}
			{componentsSection}
		</View>
	);
};

/* ---------------------------------------------------------------------------
 * One callout row, with the type-appropriate preview (§2.7/§3.4 N5)
 * ------------------------------------------------------------------------- */

type FilePreview =
	| { kind: "loading" }
	| { kind: "text"; text: string; truncated: boolean }
	| { kind: "image"; uri: string }
	| { kind: "refused"; message: string };

/** One callout's bytes → the preview state its row renders; shared by the
 *  expanded rows and the ≤ 2 files one-liner's links so the fetch, the class
 *  split and the refusal sentence can never drift between the two. */
async function loadFilePreview(
	client: SupplementClient,
	job: string,
	index: number,
	fileClass: SupplementFileClass,
): Promise<FilePreview> {
	try {
		const { bytes, mimeType } = await client.loadFile(job, index);
		if (fileClass === "image") {
			const type = mimeType ?? "image/png";
			return { kind: "image", uri: `data:${type};base64,${toBase64(bytes)}` };
		}
		const text = new TextDecoder().decode(bytes);
		return {
			kind: "text",
			text: text.slice(0, PREVIEW_TEXT_MAX_CHARS),
			truncated: text.length > PREVIEW_TEXT_MAX_CHARS,
		};
	} catch (error) {
		return {
			kind: "refused",
			message: `Could not preview: ${refusalText(error)}`,
		};
	}
}

/** The preview one open callout renders: the fetched bytes (text in a sunken
 *  monospace panel, images as an `<Image>`), the said cut caption, or the
 *  relay's own refusal sentence — shared like `loadFilePreview`. */
function PreviewPanel({
	preview,
	label,
}: {
	preview: FilePreview;
	label: string;
}) {
	return (
		<View className="min-w-0" testID={SURFACE.supplementPreview}>
			{preview.kind === "loading" ? (
				<Shimmer active>
					<View className="h-16 rounded-sm bg-sunken" />
				</Shimmer>
			) : null}
			{preview.kind === "text" ? (
				<>
					<ScrollView
						className="max-h-64 rounded-sm bg-sunken"
						contentContainerStyle={{
							/* 8/8, not 8/6: `paddingVertical: 6` was the same off-scale
							   half-step as the block root above (U-42); the preview panel is
							   not in a scored cell yet, but it is owed one (design round 1's
							   preview-panel captures), and a value that fails the rule
							   there is not worth landing. */
							paddingHorizontal: 8,
							paddingVertical: 8,
						}}
						nestedScrollEnabled
					>
						<Text className="font-mono text-mono-sm text-ink-muted">
							{preview.text}
						</Text>
					</ScrollView>
					{preview.truncated ? (
						<Text className="pt-1 text-meta text-ink-dim">
							first {PREVIEW_TEXT_MAX_CHARS.toLocaleString()} characters
						</Text>
					) : null}
				</>
			) : null}
			{preview.kind === "image" ? (
				<Image
					source={{ uri: preview.uri }}
					resizeMode="contain"
					className="max-h-64 w-full rounded-sm border border-hairline"
					accessibilityLabel={label}
				/>
			) : null}
			{preview.kind === "refused" ? (
				<Text className="text-meta text-danger">{preview.message}</Text>
			) : null}
		</View>
	);
}

function CalloutRow({
	file,
	index,
	job,
	client,
}: {
	file: SupplementFile;
	index: number;
	job: string;
	client: SupplementClient;
}) {
	const { name, path, size } = fileRowParts(file);
	const fileClass = supplementFileClass(file.path);
	const previewable = fileClass === "text" || fileClass === "image";
	const [open, setOpen] = useState(false);
	const [preview, setPreview] = useState<FilePreview | null>(null);

	const toggle = async () => {
		if (!previewable) return;
		if (open) {
			setOpen(false);
			/* A refusal is not a result: it belongs to the fetch that just failed,
			   so closing drops it and the next open refetches — the row must not
			   stay stuck on a stale refusal with no retry (UX round 1, U2). */
			setPreview((current) => (current?.kind === "refused" ? null : current));
			return;
		}
		setOpen(true);
		if (preview !== null) return;
		setPreview({ kind: "loading" });
		setPreview(await loadFilePreview(client, job, index, fileClass));
	};

	const label = name || displayText(file.path);

	return (
		<View className="flex-col gap-1" testID={supplementFileId(index)}>
			<View className="flex-row items-center gap-2">
				{previewable ? (
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ expanded: open }}
						className="min-h-11 min-w-0 flex-1 justify-center"
						testID={CONTROL.supplementFileOpen}
						onPress={() => void toggle()}
					>
						<Text className="text-meta text-ink" numberOfLines={1}>
							{label}
							{path && name ? (
								<Text className="text-ink-muted"> {path}</Text>
							) : null}
						</Text>
					</Pressable>
				) : (
					<Text
						className="min-h-11 min-w-0 flex-1 text-meta text-ink"
						numberOfLines={1}
					>
						{label}
						{path && name ? (
							<Text className="text-ink-muted"> {path}</Text>
						) : null}
					</Text>
				)}
				{size ? <Text className="text-meta text-ink-dim">{size}</Text> : null}
			</View>
			{open && preview !== null ? (
				<PreviewPanel preview={preview} label={label} />
			) : null}
		</View>
	);
}

/* ---------------------------------------------------------------------------
 * The ≤ 2 files one-liner, with its affordance (UX round 1, U3)
 * ------------------------------------------------------------------------- */

/**
 * `2 files: latency.md, bench.csv` — the copy is the model's, byte for byte.
 * The names that address a row carry the affordance: a tap opens that file's
 * preview UNDER the line (one at a time), and a second tap closes it. A phone
 * has no hover, and the one-liner must not be a dead end; a stored tail name
 * (no row index) stays plain text, exactly as the expanded block renders it.
 * The underline is the tappable run's mark, in the line's own ink — not new
 * chrome, and the same "this run is addressable" idiom the find sheet uses.
 */
function SummaryFilesLine({
	entries,
	job,
	client,
}: {
	entries: FilesSummaryEntry[];
	job: string;
	client: SupplementClient;
}) {
	const [openAt, setOpenAt] = useState<number | null>(null);
	const [preview, setPreview] = useState<FilePreview | null>(null);

	const previewable = (entry: FilesSummaryEntry): boolean => {
		if (entry.file === null) return false;
		const fileClass = supplementFileClass(entry.file.path);
		return fileClass === "text" || fileClass === "image";
	};

	const toggle = async (at: number) => {
		const entry = entries[at];
		if (entry === undefined || entry.file === null || entry.index === null)
			return;
		if (openAt === at) {
			setOpenAt(null);
			setPreview(null);
			return;
		}
		setOpenAt(at);
		setPreview({ kind: "loading" });
		setPreview(
			await loadFilePreview(
				client,
				job,
				entry.index,
				supplementFileClass(entry.file.path),
			),
		);
	};

	const openEntry = openAt === null ? null : (entries[openAt] ?? null);

	return (
		<View className="flex-col gap-1" testID={SURFACE.supplementFilesSummary}>
			{/* The names are SIBLING inline runs on one wrapping line, not a
			    pressable <Text> nested inside the wrapping one. On web the nested
			    pressable gets its own box COINCIDENT with its sibling text run, so
			    the pair measured as a 119x29 pt overlap at 200 % once the header
			    stopped pushing this line off screen (QA round 1, Q2). A sibling
			    `View` in a flex-row wrap is one run of the same sentence and paints
			    exactly where its text is. */}
			<View className="flex-row flex-wrap items-baseline">
				<Text className="text-meta text-ink-muted">
					{`${countClause(entries.length, "file")}: `}
				</Text>
				{entries.map((entry, at) => (
					<Text
						key={`${entry.index ?? "tail"}:${entry.name}`}
						className="text-meta text-ink-muted"
					>
						{/* The separator trails the PRECEDING name: a leading ", " wraps
						    onto the next line on its own at 200 %. */}
						{previewable(entry) ? (
							<Text
								className="text-meta text-ink-muted"
								onPress={() => void toggle(at)}
								style={{ textDecorationLine: "underline" }}
							>
								{entry.name}
							</Text>
						) : (
							entry.name
						)}
						{at < entries.length - 1 ? ", " : ""}
					</Text>
				))}
			</View>
			{openAt !== null && preview !== null && openEntry !== null ? (
				<PreviewPanel preview={preview} label={openEntry.name} />
			) : null}
		</View>
	);
}

/* ---------------------------------------------------------------------------
 * One component: the document fetch, then the sandboxed frame
 * ------------------------------------------------------------------------- */

function FrameSlot({
	component,
	onRetry,
	onHeight,
	client,
}: {
	component: SupplementComponent;
	onRetry?: () => void;
	onHeight: (digest: string, height: number) => void;
	client: SupplementClient;
}) {
	const [html, setHtml] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setHtml(null);
		setFailed(false);
		client
			.loadDocument(component.attachment)
			.then((documentHtml) => {
				if (!cancelled) setHtml(documentHtml);
			})
			.catch(() => {
				/* The document could not be fetched (a pruned blob, a refusal,
				   a malformed body): the frame paints the frame-level fallback
				   line instead of holding its reserved box forever. */
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [client, component.attachment]);

	return (
		<SupplementWebView
			component={component}
			documentHtml={html}
			documentFailed={failed}
			onRetry={onRetry}
			onHeightChange={(height) => onHeight(component.attachment, height)}
		/>
	);
}
