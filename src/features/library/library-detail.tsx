/**
 * One Library asset: preview, metadata, and the chat about it.
 *
 * THE PREVIEW IS THE HONEST HALF. The server has no office rasteriser and this
 * build has no native PDF/PPTX renderer, so those kinds paint a designed
 * "open on the desktop" state that names the file and the reason — never a blank
 * pane that looks like a failed load. Image/audio/video use the native players;
 * markdown/text/HTML use the renderers the transcript already ships.
 *
 * THE COMPOSER FOLLOWS THE CONTRACT'S CHAT RULE (§4.1): if the asset already has
 * a chat, the message goes to that session; otherwise this screen creates a
 * session, sends the first prompt whose first context line is the asset's
 * path/digest, then records the link. It never invents a second session route —
 * `startSession` and the ordinary prompt command are the same two calls the home
 * composer makes.
 *
 * METADATA EDITS USE A BUSY LATCH. Every write disables the sheet's controls
 * until the relay answers, because a double-tap on Save is two PATCHes and the
 * second can overwrite the first with a stale field. A refusal is the relay's
 * own sentence, verbatim; this screen never re-words one.
 */

import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import {
	FileAudio,
	FileText,
	Lock,
	LockOpen,
	Pause,
	Play,
	Star,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Image,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import type { LibraryAsset, LibraryTag } from "@/contracts";
import {
	useConnection,
	useListState,
} from "@/features/auth/connection-provider";
import { useLibraryMedia } from "@/features/library/library-media";
import {
	assetFacts,
	composerPrompt,
	editorShouldReset,
	effectiveName,
	libraryEnabled,
	mergeVocabulary,
	previewKind,
	promptImage,
	saveAssetMetadata,
	unsupportedReason,
} from "@/features/library/library-model";
import { publishLibraryUpdate } from "@/features/library/library-updates";
import { Markdown } from "@/features/session/components/markdown";
import { t } from "@/i18n";
import type { RelayEndpoints } from "@/relay";
import { isRelayError } from "@/relay";
import {
	CONTROL,
	EMPTY,
	libraryDetailTagId,
	librarySourceId,
	ROLE,
	SCREEN,
	SURFACE,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Chip } from "@/ui/components/chip";
import { Dialog } from "@/ui/components/dialog";
import { EmptyState } from "@/ui/components/empty-state";
import { Input } from "@/ui/components/input";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { Textarea } from "@/ui/components/textarea";

/** The most tags one asset may carry in the editor. It was a bare `12` in two
 *  places and a third time in the English sentence; one constant keeps the
 *  gate and the sentence (which takes it as the `{limit}` placeholder) from
 *  drifting apart. */
const MAX_ASSET_TAGS = 12;

export default function LibraryDetail() {
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id: string }>();
	const assetId = typeof id === "string" ? id : "";
	const { relay } = useConnection();
	const client = relay();
	const capabilities = useListState((state) => state.capabilities);
	const frameCount = useListState((state) => state.frameCount);
	/* A DIRECT LINK arrives before the sessions stream has answered, so the
	 *  capability bag is still empty. "Unknown" must not render as "absent": the
	 *  screen attempts the read and the relay's own 404 is the refusal. Once a
	 *  frame has landed, the flag is the relay's word and the gate applies. */
	const enabled = frameCount === 0 || libraryEnabled(capabilities);

	const [asset, setAsset] = useState<LibraryAsset | null>(null);
	const [tags, setTags] = useState<LibraryTag[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [busyAction, setBusyAction] = useState<string | null>(null);

	const load = useCallback(
		async (signal?: { cancelled: boolean }) => {
			if (client === null || assetId === "") {
				setLoading(false);
				return;
			}
			setLoading(true);
			setError(null);
			try {
				const [detail, vocabulary] = await Promise.all([
					client.libraryAsset(assetId),
					client.libraryTags().catch(() => ({ tags: [] as LibraryTag[] })),
				]);
				if (signal?.cancelled) return;
				setAsset(detail);
				setTags(vocabulary.tags);
			} catch (failure) {
				if (signal?.cancelled) return;
				setError(
					displaySentence(failure, "We couldn't open this asset just now."),
				);
			} finally {
				if (!signal?.cancelled) setLoading(false);
			}
		},
		[client, assetId],
	);

	useEffect(() => {
		const signal = { cancelled: false };
		void load(signal);
		return () => {
			signal.cancelled = true;
		};
	}, [load]);

	const patch = useCallback(
		async (changes: {
			favorite?: boolean;
			locked?: boolean;
			name?: string;
			description?: string;
		}) => {
			if (client === null || asset === null) return;
			setBusyAction(changes.favorite !== undefined ? "favorite" : "lock");
			try {
				const updated = await client.patchLibraryAsset(asset.id, changes);
				setAsset(updated);
				publishLibraryUpdate({ asset: updated, tags: null });
			} catch (failure) {
				setError(
					displaySentence(failure, "That change did not stick. Try again."),
				);
			} finally {
				setBusyAction(null);
			}
		},
		[client, asset],
	);

	if (!enabled) {
		return (
			<Screen title={t("mobile.library.title")} testID={SCREEN.libraryDetail}>
				<EmptyState
					testID={EMPTY.library}
					headline="The Library is not on this computer yet."
					next="Update Local Operator on the computer you are connected to, then reopen this asset."
				/>
			</Screen>
		);
	}

	return (
		<Screen
			title={t("mobile.library.title")}
			testID={SCREEN.libraryDetail}
			scroll={false}
			headerLeading={
				<Button
					testID={CONTROL.libraryDetailBack}
					label={t("mobile.common.back")}
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
			headerAction={
				asset !== null ? (
					<Button
						testID={CONTROL.libraryEdit}
						label={t("mobile.library.action.edit")}
						onPress={() => setEditorOpen(true)}
						variant="quiet"
						size="sm"
					/>
				) : null
			}
		>
			{error !== null && asset === null ? (
				<View className="gap-3">
					<Alert severity="error" testID={SURFACE.libraryError}>
						{error}
					</Alert>
					<Button
						label={t("mobile.common.try_again")}
						onPress={() => void load()}
						variant="outline"
						testID={CONTROL.libraryDetailRetry}
					/>
				</View>
			) : loading && asset === null ? (
				<Skeleton lines={8} testID={SURFACE.libraryDetailLoading} />
			) : asset === null ? (
				<EmptyState
					testID={EMPTY.library}
					headline="This asset is no longer in your library."
					next="Go back and pick another one."
					action={{
						label: "Back to the library",
						onPress: () => router.back(),
						testID: CONTROL.libraryBack,
					}}
				/>
			) : (
				<KeyboardAvoidingView
					className="flex-1"
					behavior={Platform.OS === "ios" ? "padding" : undefined}
				>
					<View className="flex-1" testID={SURFACE.libraryDetailPopulated}>
						<ScrollView
							keyboardShouldPersistTaps="handled"
							contentContainerStyle={{ gap: 16, paddingBottom: 24 }}
						>
							<LibraryPreview asset={asset} client={client} />

							{!asset.exists ? (
								<View className="px-4">
									<Alert severity="warning">
										{t("mobile.library.detail.missing_file")}
									</Alert>
								</View>
							) : null}

							<View className="gap-1 px-4">
								<Text className="text-title text-ink">
									{effectiveName(asset)}
								</Text>
								<Text className="text-body-sm text-ink-muted">
									{assetFacts(asset)}
								</Text>
								{asset.organized !== null ? (
									<Text className="text-meta text-ink-dim">
										Organized by {asset.organized.by || "the Librarian"}
									</Text>
								) : null}
							</View>

							{asset.description.trim() !== "" ? (
								<Text className="px-4 text-body text-ink-muted">
									{asset.description}
								</Text>
							) : null}

							<View className="flex-row flex-wrap gap-2 px-4">
								<Button
									label={asset.favorite ? "Favorited" : "Favorite"}
									onPress={() => void patch({ favorite: !asset.favorite })}
									loading={busyAction === "favorite"}
									disabled={busyAction !== null}
									variant="outline"
									size="sm"
									leadingIcon={({ color, size }) => (
										<Star color={color} size={size} />
									)}
									testID={CONTROL.libraryFavorite}
								/>
								<Button
									label={asset.locked ? "Locked" : "Lock"}
									onPress={() => void patch({ locked: !asset.locked })}
									loading={busyAction === "lock"}
									disabled={busyAction !== null}
									variant="outline"
									size="sm"
									leadingIcon={({ color, size }) =>
										asset.locked ? (
											<Lock color={color} size={size} />
										) : (
											<LockOpen color={color} size={size} />
										)
									}
									testID={CONTROL.libraryLock}
								/>
								{asset.chat !== null ? (
									<Button
										label={t("mobile.library.action.open_chat")}
										onPress={() =>
											router.push(`/session/${asset.chat?.session_id}`)
										}
										variant="outline"
										size="sm"
										testID={CONTROL.libraryOpenChat}
									/>
								) : null}
							</View>

							{asset.tags.length > 0 ? (
								<View className="flex-row flex-wrap gap-2 px-4">
									{asset.tags.map((tag) => (
										<View
											key={tag.id}
											className="rounded-full border border-hairline px-3 py-1"
										>
											<Text className="text-mono-sm text-ink-muted">
												{tag.name}
											</Text>
										</View>
									))}
								</View>
							) : (
								<Text className="px-4 text-body-sm text-ink-dim">
									{t("mobile.library.detail.no_tags")}
								</Text>
							)}

							<View className="gap-2 px-4">
								<Text className="text-body-sm text-ink-muted">
									{t("mobile.library.detail.seen_in")}
								</Text>
								{asset.occurrences.length === 0 ? (
									<Text className="text-body-sm text-ink-dim">
										{t("mobile.library.detail.no_source")}
									</Text>
								) : (
									asset.occurrences.slice(0, 8).map((occurrence) => (
										<Pressable
											key={`${occurrence.session_id}-${occurrence.at}`}
											accessibilityRole={ROLE.link}
											disabled={occurrence.session_id === ""}
											onPress={() => {
												if (occurrence.session_id !== "")
													router.push(`/session/${occurrence.session_id}`);
											}}
											testID={librarySourceId(occurrence.session_id)}
											className="min-h-11 justify-center border-hairline border-b py-2"
										>
											<Text className="text-body text-ink" numberOfLines={1}>
												{occurrence.session_title || "A conversation"}
											</Text>
											<Text
												className="text-meta text-ink-dim"
												numberOfLines={1}
											>
												{occurrence.origin}
												{occurrence.tool !== "" ? ` · ${occurrence.tool}` : ""}
											</Text>
										</Pressable>
									))
								)}
							</View>

							{error !== null ? (
								<View className="px-4">
									<Alert severity="error" testID={SURFACE.libraryError}>
										{error}
									</Alert>
								</View>
							) : null}
						</ScrollView>

						<AssetComposer
							asset={asset}
							client={client}
							onLinked={(updated) => setAsset(updated)}
						/>
					</View>

					<MetadataEditor
						visible={editorOpen}
						asset={asset}
						vocabulary={tags}
						client={client}
						onClose={() => setEditorOpen(false)}
						onPatched={(updated) => {
							setAsset(updated);
							/* The metadata half landed even though the tags did not;
							 *  Back must still show the new name/description. */
							publishLibraryUpdate({ asset: updated, tags: null });
						}}
						onSaved={(updated, nextTags) => {
							setAsset(updated);
							setTags(nextTags);
							setEditorOpen(false);
							publishLibraryUpdate({ asset: updated, tags: nextTags });
						}}
					/>
				</KeyboardAvoidingView>
			)}
		</Screen>
	);
}

/* ------------------------------------------------------------------ preview */

function LibraryPreview({
	asset,
	client,
}: {
	asset: LibraryAsset;
	client: RelayEndpoints | null;
}) {
	const kind = previewKind(asset);
	const inkDim = useTokenColor("ink-dim");
	const { media, loading, error } = useLibraryMedia(client, asset);

	if (!asset.exists) return null;
	if (kind === "unsupported") {
		return (
			<View
				className="items-center justify-center gap-2 rounded-md border border-hairline bg-elevated px-4 py-10"
				testID={SURFACE.libraryUnsupported}
			>
				<FileText size={32} color={inkDim} />
				<Text className="text-center text-body text-ink-muted">
					{unsupportedReason(asset)}
				</Text>
				<Text className="text-center text-meta text-ink-dim" numberOfLines={2}>
					{asset.ref.display_path}
				</Text>
			</View>
		);
	}
	if (loading) {
		return <Skeleton lines={5} testID={SURFACE.libraryDetailLoading} />;
	}
	if (error !== null) {
		return <Alert severity="error">{error}</Alert>;
	}
	if (media === null) return null;

	switch (media.kind) {
		case "image":
			return (
				/* The ratio lives on the BOX, not the image: react-native-web renders the
				 *  intrinsic 1×1 of a freshly-uploaded asset as a square if the `img`
				 *  alone carries `aspectRatio`, and the hero then disagrees with the
				 *  row's own width/height. The box owns the geometry, the image fills it. */
				<View
					className="overflow-hidden rounded-md bg-elevated"
					style={{
						width: "100%",
						aspectRatio:
							(asset.width ?? 0) > 0 && (asset.height ?? 0) > 0
								? (asset.width ?? 0) / (asset.height ?? 1)
								: 4 / 3,
					}}
				>
					<Image
						source={{ uri: media.uri }}
						resizeMode="contain"
						style={{ width: "100%", height: "100%" }}
						accessibilityLabel={`${effectiveName(asset)} preview`}
					/>
				</View>
			);
		case "audio":
			return <AudioPreview uri={media.uri} />;
		case "video":
			return <VideoPreview uri={media.uri} />;
		case "html":
			return (
				<WebView
					originWhitelist={["about:blank"]}
					source={{ html: media.html, baseUrl: "about:blank" }}
					/* The document is shown, never executed: a library HTML asset is
					 *  content, and a WebView that runs its script is a second, unreviewed
					 *  trust boundary inside the app. */
					javaScriptEnabled={false}
					allowFileAccess={false}
					incognito
					style={{ minHeight: 320, borderRadius: 8 }}
				/>
			);
		case "text":
			return asset.kind === "markdown" ? (
				<Markdown text={media.text} />
			) : (
				<View className="rounded-md border border-hairline bg-elevated p-3">
					<Text className="text-mono-sm text-ink-muted" selectable>
						{media.text}
					</Text>
				</View>
			);
	}
}

function AudioPreview({ uri }: { uri: string }) {
	const player = useAudioPlayer(uri);
	const status = useAudioPlayerStatus(player);
	const inkDim = useTokenColor("ink-dim");
	const playing = status.playing;
	return (
		<View className="gap-3 rounded-md border border-hairline bg-elevated p-4">
			<View className="flex-row items-center gap-3">
				<FileAudio size={28} color={inkDim} />
				<Button
					label={playing ? "Pause" : "Play"}
					onPress={() => {
						if (playing) player.pause();
						else player.play();
					}}
					variant="outline"
					size="sm"
					testID={CONTROL.libraryAudioPlay}
					leadingIcon={({ color, size }) =>
						playing ? (
							<Pause color={color} size={size} />
						) : (
							<Play color={color} size={size} />
						)
					}
				/>
			</View>
			<Text className="text-meta text-ink-dim">
				{formatClock(status.currentTime)} / {formatClock(status.duration)}
			</Text>
		</View>
	);
}

function VideoPreview({ uri }: { uri: string }) {
	const player = useVideoPlayer(uri, (instance) => {
		instance.loop = false;
	});
	return (
		<VideoView
			player={player}
			nativeControls
			contentFit="contain"
			style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
		/>
	);
}

const formatClock = (seconds: number): string => {
	const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return `${minutes}:${String(rest).padStart(2, "0")}`;
};

/* ----------------------------------------------------------------- composer */

function AssetComposer({
	asset,
	client,
	onLinked,
}: {
	asset: LibraryAsset;
	client: RelayEndpoints | null;
	onLinked: (asset: LibraryAsset) => void;
}) {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	/* The sentence sits ABOVE the field, inside the composer: a refusal painted
	 *  in the scrolling body above is behind the pinned composer exactly when the
	 *  reader needs it (the same defect the project editor's slash note names). */
	const [refusal, setRefusal] = useState<string | null>(null);
	const inFlight = useRef(false);

	const send = useCallback(() => {
		if (inFlight.current || client === null || draft.trim() === "") return;
		inFlight.current = true;
		setSending(true);
		setRefusal(null);
		void (async () => {
			let sessionId = asset.chat?.session_id ?? null;
			let started = false;
			try {
				if (sessionId === null) {
					const created = await client.startSession({});
					sessionId = created.session_id;
					started = true;
				}
				/* Images travel as bytes where the prompt wire has a place for them;
				 *  audio does not have one, so its clip is named by path/digest in the
				 *  prompt's first line instead of being attached. */
				const image =
					asset.kind === "image"
						? await client
								.libraryContent(asset.id)
								.then(({ bytes }) => promptImage(asset, bytes))
								.catch(() => null)
						: null;
				await client.command(sessionId, {
					op: "prompt",
					command_id: randomUUID(),
					text: composerPrompt(asset, draft),
					...(image !== null ? { images: [image] } : {}),
				});
				if (asset.chat === null) {
					try {
						const linked = await client.linkLibraryChat(asset.id, sessionId);
						onLinked({ ...asset, chat: linked.chat });
					} catch {
						// The message did arrive; only the association is missing. Saying so
						// is better than pretending the link exists and losing it silently.
						setRefusal(
							"The message was sent, but this asset was not linked to the chat.",
						);
					}
				}
				setDraft("");
				router.push(`/session/${sessionId}`);
			} catch (failure) {
				setRefusal(
					displaySentence(
						failure,
						started
							? "The session started, but your message was not sent."
							: "Your message was not sent. Try again.",
					),
				);
			} finally {
				inFlight.current = false;
				setSending(false);
			}
		})();
	}, [asset, client, draft, onLinked, router]);

	return (
		<View
			className="border-0 px-4 pt-2"
			style={{ paddingBottom: Math.max(insets.bottom, 8) }}
			testID={SURFACE.libraryComposer}
		>
			{refusal !== null ? (
				<View className="pb-2">
					<Alert severity="error">{refusal}</Alert>
				</View>
			) : null}
			<View className="flex-row items-end gap-2">
				<View className="flex-1">
					<Textarea
						label={t("mobile.library.detail.message_label")}
						value={draft}
						onChangeText={setDraft}
						placeholder={
							asset.chat !== null
								? "Reply in this chat"
								: "Ask about this asset"
						}
						maxLines={4}
						placeholderMaxLines={1}
						testID={CONTROL.libraryComposeField}
					/>
				</View>
				<Button
					label={t("mobile.common.send")}
					onPress={() => send()}
					loading={sending}
					disabled={sending || draft.trim() === ""}
					testID={CONTROL.libraryComposeSend}
				/>
			</View>
		</View>
	);
}

/* ------------------------------------------------------------------- editor */

function MetadataEditor({
	visible,
	asset,
	vocabulary,
	client,
	onClose,
	onPatched,
	onSaved,
}: {
	visible: boolean;
	asset: LibraryAsset;
	vocabulary: LibraryTag[];
	client: RelayEndpoints | null;
	onClose: () => void;
	/** Metadata landed but the tag half did not: update the row WITHOUT closing
	 *  the sheet, so the refusal sentence stays on screen and the reader can
	 *  retry the tags. */
	onPatched: (asset: LibraryAsset) => void;
	onSaved: (asset: LibraryAsset, tags: LibraryTag[]) => void;
}) {
	const [name, setName] = useState(asset.name);
	const [description, setDescription] = useState(asset.description);
	const [assigned, setAssigned] = useState<string[]>(
		asset.tags.map((tag) => tag.id),
	);
	const [available, setAvailable] = useState<LibraryTag[]>(vocabulary);
	const [newTag, setNewTag] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [discard, setDiscard] = useState(false);
	/* The asset id this sheet last reset for. `undefined` means closed. A PATCH
	 *  answer updates the parent row while the sheet is open; that must not rerun
	 *  the reset (review round 1, major 2). */
	const openedFor = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (!visible) {
			openedFor.current = undefined;
			return;
		}
		if (!editorShouldReset(visible, openedFor.current, asset.id)) return;
		openedFor.current = asset.id;
		setName(asset.name);
		setDescription(asset.description);
		setAssigned(asset.tags.map((tag) => tag.id));
		setAvailable(vocabulary);
		setNewTag("");
		setError(null);
	}, [visible, asset, vocabulary]);

	const dirty =
		name !== asset.name ||
		description !== asset.description ||
		assigned.slice().sort().join(",") !==
			asset.tags
				.map((tag) => tag.id)
				.slice()
				.sort()
				.join(",");

	const close = () => {
		if (busy) return;
		if (dirty) setDiscard(true);
		else onClose();
	};

	const save = () => {
		if (busy || client === null) return;
		setBusy(true);
		setError(null);
		void (async () => {
			try {
				/* One Save reconciles the two writes explicitly: a tag refusal keeps
				 *  the intended selection and the sheet OPEN, so the sentence and the
				 *  retry are both reachable. */
				const outcome = await saveAssetMetadata(client, {
					asset,
					name,
					description,
					assigned,
					vocabulary: available,
				});
				setAvailable(outcome.vocabulary);
				setAssigned(outcome.assigned);
				setError(outcome.refusal);
				if (outcome.close) onSaved(outcome.asset, outcome.vocabulary);
				else onPatched(outcome.asset);
			} catch (failure) {
				setError(displaySentence(failure, "That did not save. Try again."));
			} finally {
				setBusy(false);
			}
		})();
	};

	const addTag = () => {
		const value = newTag.trim().toLowerCase();
		if (value === "" || busy || client === null) return;
		setBusy(true);
		setError(null);
		void (async () => {
			try {
				const created = await client.createLibraryTag(value);
				setAvailable((current) => mergeVocabulary(current, [created.tag]));
				setAssigned((current) =>
					current.includes(created.tag.id)
						? current
						: [...current, created.tag.id],
				);
				setNewTag("");
			} catch (failure) {
				setError(displaySentence(failure, "That tag was not created."));
			} finally {
				setBusy(false);
			}
		})();
	};

	return (
		<>
			<Sheet
				visible={visible}
				onClose={close}
				title={t("mobile.library.editor.title")}
				testID={SURFACE.libraryEditorSheet}
				footer={
					<View className="gap-3">
						{/* Pinned next to Save, not in the scrolling body: a partial
						 *  failure's sentence and its retry must be reachable at every
						 *  text size and scroll position (review round 1, major 2). */}
						{error !== null ? <Alert severity="error">{error}</Alert> : null}
						<View className="flex-row justify-end gap-2">
							<Button
								label={t("mobile.common.cancel")}
								onPress={close}
								variant="quiet"
								disabled={busy}
								testID={CONTROL.libraryCloseEditor}
							/>
							<Button
								label={t("mobile.common.save")}
								onPress={save}
								loading={busy}
								disabled={busy}
								testID={CONTROL.libraryEditSave}
							/>
						</View>
					</View>
				}
			>
				<View className="gap-4">
					<Input
						label={t("mobile.library.editor.name")}
						value={name}
						onChangeText={setName}
						disabled={busy}
						testID={CONTROL.libraryEditName}
					/>
					<Textarea
						label={t("mobile.library.editor.description")}
						value={description}
						onChangeText={setDescription}
						disabled={busy}
						maxLines={5}
						testID={CONTROL.libraryEditDescription}
					/>
					<View className="gap-2">
						<Text className="text-body-sm text-ink-muted">
							{t("mobile.library.editor.tags")}
						</Text>
						<View className="flex-row flex-wrap gap-2">
							{available.map((tag) => {
								const selected = assigned.includes(tag.id);
								const atLimit = assigned.length >= MAX_ASSET_TAGS && !selected;
								return (
									<Chip
										key={tag.id}
										label={tag.name}
										selected={selected}
										disabled={busy || atLimit}
										onPress={() =>
											setAssigned((current) =>
												current.includes(tag.id)
													? current.filter((id) => id !== tag.id)
													: [...current, tag.id],
											)
										}
										testID={libraryDetailTagId(tag.id)}
									/>
								);
							})}
						</View>
						{assigned.length >= MAX_ASSET_TAGS ? (
							<Text className="text-meta text-ink-dim">
								{t("mobile.library.editor.tag_limit", {
									limit: MAX_ASSET_TAGS,
								})}
							</Text>
						) : null}
						<View className="flex-row items-end gap-2">
							<View className="flex-1">
								<Input
									label={t("mobile.library.editor.new_tag")}
									value={newTag}
									onChangeText={setNewTag}
									disabled={busy}
									autoCapitalize="none"
									placeholder={t("mobile.library.editor.new_tag_placeholder")}
									testID={CONTROL.libraryNewTag}
								/>
							</View>
							<Button
								label={t("mobile.library.action.add_tag")}
								onPress={addTag}
								variant="outline"
								disabled={busy || newTag.trim() === ""}
								testID={CONTROL.libraryNewTagAdd}
							/>
						</View>
					</View>
				</View>
			</Sheet>
			<Dialog
				visible={discard}
				title={t("mobile.library.editor.discard_title")}
				body={t("mobile.library.discard_not_saved")}
				confirmLabel={t("mobile.library.discard_confirm")}
				destructive
				busy={busy}
				onCancel={() => setDiscard(false)}
				onConfirm={() => {
					setDiscard(false);
					onClose();
				}}
				testID={CONTROL.libraryDiscardDialog}
			/>
		</>
	);
}

/** The relay's own sentence when it gave one, else the screen's fallback. Never
 *  a status code and never a runtime's prose. */
function displaySentence(failure: unknown, fallback: string): string {
	if (isRelayError(failure) && failure.displayableMessage !== undefined) {
		return failure.displayableMessage;
	}
	return fallback;
}
