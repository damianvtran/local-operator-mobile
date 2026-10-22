import { Image } from "expo-image";
import { ChevronLeft, ChevronRight, RotateCw, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	type LayoutChangeEvent,
	Modal,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	attachmentCacheKey,
	attachmentView,
	type Box,
	cachedAttachment,
	createViewerPager,
	dataUri,
	GRID_GAP,
	gridCell,
	loadAttachment,
	singleImageBox,
	viewablePosition,
} from "@/team-bridge/attachments";
import type { HubClient } from "@/team-bridge/client";
import type { AttachmentDescriptor } from "@/team-bridge/contract";
import {
	ROLE,
	SURFACE,
	teamBridgeAttachmentChipId,
	teamBridgeAttachmentId,
	teamBridgeViewerId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import {
	ModalScopeContext,
	useModalStackEntry,
} from "@/ui/components/modal-stack-entry";
import { TOUCH_FLOOR } from "@/ui/layout";
import {
	CHIP_STRIP_LAYOUT,
	chipBadgeRects,
	chipControlRects,
	chipStateLabel,
	type DraftChip,
} from "./attachment-draft";

/** The message row's fixed horizontal gutters; see `MessageAttachments`. */
const MESSAGE_ROW_GUTTERS = 76;

/**
 * One numbering for the thread and the viewer (R3-04): a bound image is
 * counted among the message's viewable images only.
 */
const imageLabel = (position: { index: number; count: number } | null) =>
	!position || position.count === 1
		? "Image"
		: `Image ${position.index + 1} of ${position.count}`;

type Source = {
	hub: HubClient;
	tenantId: string;
	conversationId: string;
	messageId: string;
};

/**
 * Bytes for one bound image through the app's bearer route and its bounded
 * memory cache. Shared by the thread cell and the full-screen viewer, so
 * opening the viewer never refetches what the thread already shows.
 */
function useAttachmentUri(source: Source, attachmentId: string) {
	const { hub, tenantId, conversationId, messageId } = source;
	const key = attachmentCacheKey(
		tenantId,
		conversationId,
		messageId,
		attachmentId,
	);
	const [uri, setUri] = useState<string | null>(
		() => cachedAttachment(key) ?? null,
	);
	const [state, setState] = useState<"loading" | "ready" | "error" | "gone">(
		() => (cachedAttachment(key) ? "ready" : "loading"),
	);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let live = true;
		// `attempt` is read so a Retry press re-runs this effect.
		void attempt;
		loadAttachment(key, async () => {
			const { mime, bytes } = await hub.attachmentBytes(
				tenantId,
				conversationId,
				messageId,
				attachmentId,
			);
			return dataUri(mime, bytes);
		})
			.then((value) => {
				if (!live) return;
				setUri(value);
				setState("ready");
			})
			.catch((error: unknown) => {
				if (!live) return;
				// 404 is the hub's uniform "not yours / not there" answer (also a
				// purge that raced this view); no retry would change it.
				const kind = (error as { kind?: string } | null)?.kind;
				setState(kind === "not_found" ? "gone" : "error");
			});
		return () => {
			live = false;
		};
	}, [hub, key, tenantId, conversationId, messageId, attachmentId, attempt]);
	const retry = useCallback(() => {
		setState("loading");
		setAttempt((n) => n + 1);
	}, []);
	return { uri, state, retry };
}

/**
 * Every non-image state is drawn in the image's OWN box (design round 1, D5),
 * so a failed load, an expiry or a purge never reflows the thread. The words
 * carry the state; the box keeps the layout.
 */
function Placeholder({
	text,
	box,
	testID,
	action,
}: {
	text: string;
	box: Box;
	testID: string;
	action?: { label: string; onPress: () => void };
}) {
	return (
		<View
			testID={testID}
			className="items-center justify-center gap-1 overflow-hidden rounded-sm border border-border-control bg-elevated px-2"
			style={box}
		>
			<Text className="text-center text-meta text-ink-muted">{text}</Text>
			{action ? (
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={action.label}
					onPress={action.onPress}
					// A full 44 pt target in both axes (D6), centred on the label.
					style={{
						minHeight: TOUCH_FLOOR,
						minWidth: TOUCH_FLOOR,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<Text className="text-meta font-semibold text-ink">
						{action.label}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}

/** One bound image in the thread: tap opens the full-screen viewer (D2). */
function ThreadImage({
	source,
	descriptor,
	box,
	label,
	onOpen,
}: {
	source: Source;
	descriptor: AttachmentDescriptor;
	box: Box;
	label: string;
	onOpen: () => void;
}) {
	const { uri, state, retry } = useAttachmentUri(source, descriptor.id);
	const testID = teamBridgeAttachmentId(descriptor.id);
	if (state === "gone")
		return <Placeholder text="Image unavailable" box={box} testID={testID} />;
	if (state === "error")
		return (
			<Placeholder
				text="This image did not load."
				box={box}
				testID={testID}
				action={{ label: "Retry", onPress: retry }}
			/>
		);
	return (
		<Pressable
			testID={testID}
			accessibilityRole={ROLE.imagebutton}
			accessibilityLabel={state === "ready" ? label : `${label}, loading`}
			accessibilityHint="Opens the image full screen"
			disabled={state !== "ready"}
			onPress={onOpen}
			className="overflow-hidden rounded-sm border border-hairline bg-elevated"
			style={box}
		>
			{uri ? (
				<Image
					source={{ uri }}
					style={box}
					contentFit="cover"
					cachePolicy="none"
					// The box is already reserved; no fade, so the settled frame is the
					// first frame.
					transition={0}
				/>
			) : null}
		</Pressable>
	);
}

/**
 * Every attachment on one message, in send order, each in its own state.
 * Rendered ONLY from the structured `attachments[]` list: an image link in the
 * body text stays alt text (`Markdown`), so a message cannot make this app
 * fetch a URL it names.
 *
 * Layout (D3): one image keeps its aspect in a 240 pt box; two or more are a
 * two-column grid of square cells (2×2 for four), sized from the measured
 * column so the block is never taller than it is wide.
 */
export function MessageAttachments({
	hub,
	tenantId,
	conversationId,
	messageId,
	attachments,
	initialViewerIndex,
}: {
	hub: HubClient;
	tenantId: string;
	conversationId: string;
	messageId: string;
	attachments: ReadonlyArray<AttachmentDescriptor | null>;
	/** Fixture/QA seam: open the viewer at this image on mount. */
	initialViewerIndex?: number;
}) {
	const { width: windowWidth } = useWindowDimensions();
	/*
	 * Seeded from the window so the FIRST frame already draws grid cells at
	 * their final size (R3-03): the message row spends 76 pt on fixed gutters
	 * (16 + 16 padding, a 32 pt avatar column, a 12 pt gap). `onLayout` then
	 * corrects it to the measured column, which on a phone is the same number.
	 */
	const [columnWidth, setColumnWidth] = useState(() =>
		Math.max(0, windowWidth - MESSAGE_ROW_GUTTERS),
	);
	const [viewerAt, setViewerAt] = useState<number | null>(
		initialViewerIndex ?? null,
	);
	const onLayout = (event: LayoutChangeEvent) => {
		const measured = Math.round(event.nativeEvent.layout.width);
		if (measured > 0 && measured !== columnWidth) setColumnWidth(measured);
	};
	if (attachments.length === 0) return null;
	const source = { hub, tenantId, conversationId, messageId };
	const count = attachments.length;
	const cell = gridCell(count, columnWidth);
	// Only bound images open in the viewer; its pages are those, in order.
	const viewable = attachments.flatMap((d) =>
		d !== null && attachmentView(d) === "image" ? [d] : [],
	);
	return (
		<View onLayout={onLayout} className="pt-1">
			{count > 1 && !cell ? null : (
				<View
					className="flex-row flex-wrap"
					style={{
						gap: GRID_GAP,
						maxWidth: cell ? cell.width * 2 + GRID_GAP : undefined,
					}}
				>
					{attachments.map((descriptor, index) => {
						const view = attachmentView(descriptor);
						const box =
							cell ?? singleImageBox(descriptor?.width, descriptor?.height);
						const fallbackId = teamBridgeAttachmentId(`${messageId}-${index}`);
						// `view !== "image"` alone decides; `descriptor === null` is there
						// only so TypeScript narrows `descriptor` for the branch below.
						if (view !== "image" || descriptor === null)
							return (
								<Placeholder
									key={descriptor?.id ?? fallbackId}
									box={box}
									text={
										view === "expired" ? "Image expired" : "Image unavailable"
									}
									testID={
										descriptor
											? teamBridgeAttachmentId(descriptor.id)
											: fallbackId
									}
								/>
							);
						return (
							<ThreadImage
								key={descriptor.id}
								source={source}
								descriptor={descriptor}
								box={box}
								label={imageLabel(viewablePosition(attachments, descriptor.id))}
								onOpen={() =>
									setViewerAt(
										viewablePosition(attachments, descriptor.id)?.index ?? 0,
									)
								}
							/>
						);
					})}
				</View>
			)}
			{viewerAt !== null && viewable.length > 0 ? (
				<ImageViewer
					source={source}
					images={viewable}
					initialIndex={Math.min(Math.max(0, viewerAt), viewable.length - 1)}
					onClose={() => setViewerAt(null)}
				/>
			) : null}
		</View>
	);
}

/**
 * The full-screen image viewer (design round 1, D2: Slack/Discord parity).
 *
 * - Paging: a horizontal `pagingEnabled` ScrollView, one page per bound image
 *   of the message; swipe on touch, and Previous/Next buttons so it works with
 *   a pointer, a keyboard and a screen reader too.
 * - Zoom: each page is its own ScrollView with `maximumZoomScale` (native
 *   pinch-zoom on iOS; Android and web show the image fitted). That costs no
 *   gesture library and no new dependency; a full pan-zoom on every platform
 *   would need reanimated/gesture-handler wiring and is not in this slice.
 * - Close: a 44 pt button and the system back gesture (`onRequestClose`).
 * - Privacy: pages read from the same in-memory cache as the thread; nothing
 *   is saved or shared from here.
 */
function ImageViewer({
	source,
	images,
	initialIndex,
	onClose,
}: {
	source: Source;
	images: readonly AttachmentDescriptor[];
	initialIndex: number;
	onClose: () => void;
}) {
	const { width, height } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const ink = useTokenColor("ink");
	const pager = useRef<ScrollView>(null);
	const [index, setIndex] = useState(initialIndex);
	// Joins the app's modal stack like `Dialog`/`Sheet`, so a sheet raised
	// over the viewer (or the viewer over one) never paints two full surfaces.
	const { covered, scope } = useModalStackEntry(true);
	/*
	 * One controller owns the page (`createViewerPager` has the rules and the
	 * tests): opening at `initialIndex` on web (R3-01), following `onScroll`,
	 * and the buttons' pending target that keeps an animated scroll's early
	 * ticks from stepping the counter backwards (R4-01). Refs keep one
	 * controller across renders.
	 */
	const indexRef = useRef(index);
	indexRef.current = index;
	const pagerEvents = useRef(
		createViewerPager({
			initialIndex,
			count: images.length,
			scrollTo: (x, animated) => pager.current?.scrollTo({ x, animated }),
			currentIndex: () => indexRef.current,
			setIndex,
		}),
	).current;
	const onPagerLayout = (event: LayoutChangeEvent) =>
		pagerEvents.onLayout(event.nativeEvent.layout.width);
	// A drag or touch start is the reader taking over from a button's scroll.
	const onUserScroll = () => pagerEvents.onUserScroll();
	const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
		pagerEvents.onScroll(
			event.nativeEvent.contentOffset.x,
			event.nativeEvent.layoutMeasurement.width,
		);
	const many = images.length > 1;
	const position = many ? `${index + 1} of ${images.length}` : "";
	const button = (
		label: string,
		icon: React.ReactNode,
		onPress: () => void,
		testID: string,
		disabled = false,
	) => (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
			className="items-center justify-center rounded-full bg-elevated"
			style={{
				width: TOUCH_FLOOR,
				height: TOUCH_FLOOR,
				opacity: disabled ? 0.4 : 1,
			}}
		>
			{icon}
		</Pressable>
	);
	return (
		<ModalScopeContext.Provider value={scope}>
			<Modal
				visible={!covered}
				transparent={false}
				animationType="fade"
				onRequestClose={onClose}
				accessibilityViewIsModal
				testID={SURFACE.teamBridgeImageViewer}
			>
				{/* The dialog's accessible name (D12), the `Sheet` pattern: RN's
				    AccessibilityRole has no dialog, so `role` + `aria-label`. */}
				<View
					role={ROLE.dialog}
					aria-label="Image viewer"
					className="flex-1 bg-canvas"
				>
					<ScrollView
						ref={pager}
						horizontal
						pagingEnabled
						showsHorizontalScrollIndicator={false}
						contentOffset={{ x: initialIndex * width, y: 0 }}
						onLayout={onPagerLayout}
						onScroll={onScroll}
						onScrollBeginDrag={onUserScroll}
						onTouchStart={onUserScroll}
						scrollEventThrottle={16}
					>
						{images.map((descriptor, page) => (
							<ViewerPage
								key={descriptor.id}
								source={source}
								descriptor={descriptor}
								width={width}
								height={height}
								label={many ? `Image ${page + 1} of ${images.length}` : "Image"}
							/>
						))}
					</ScrollView>
					<View
						pointerEvents="box-none"
						className="absolute right-0 left-0 flex-row items-center justify-between px-4"
						style={{ top: insets.top + 8 }}
					>
						{button(
							"Close image",
							<X color={ink} size={20} />,
							onClose,
							teamBridgeViewerId("close"),
						)}
						{many ? (
							<Text
								role={ROLE.status}
								className="rounded-full bg-elevated px-3 py-1 text-meta text-ink"
							>
								{position}
							</Text>
						) : null}
					</View>
					{many ? (
						<View
							pointerEvents="box-none"
							className="absolute right-0 left-0 flex-row justify-between px-4"
							style={{ bottom: insets.bottom + 16 }}
						>
							{button(
								"Previous image",
								<ChevronLeft color={ink} size={22} />,
								() => pagerEvents.step(-1),
								teamBridgeViewerId("previous"),
								index === 0,
							)}
							{button(
								"Next image",
								<ChevronRight color={ink} size={22} />,
								() => pagerEvents.step(1),
								teamBridgeViewerId("next"),
								index === images.length - 1,
							)}
						</View>
					) : null}
				</View>
			</Modal>
		</ModalScopeContext.Provider>
	);
}

function ViewerPage({
	source,
	descriptor,
	width,
	height,
	label,
}: {
	source: Source;
	descriptor: AttachmentDescriptor;
	width: number;
	height: number;
	label: string;
}) {
	const { uri, state, retry } = useAttachmentUri(source, descriptor.id);
	const box = { width, height };
	if (state === "gone" || state === "error")
		return (
			<View style={box} className="items-center justify-center">
				<Placeholder
					box={{ width: Math.min(width - 32, 320), height: 160 }}
					text={
						state === "gone" ? "Image unavailable" : "This image did not load."
					}
					testID={teamBridgeViewerId(`page-${descriptor.id}`)}
					action={
						state === "error" ? { label: "Retry", onPress: retry } : undefined
					}
				/>
			</View>
		);
	return (
		<ScrollView
			style={box}
			contentContainerStyle={{
				width,
				height,
				alignItems: "center",
				justifyContent: "center",
			}}
			maximumZoomScale={4}
			minimumZoomScale={1}
			centerContent
			showsHorizontalScrollIndicator={false}
			showsVerticalScrollIndicator={false}
			testID={teamBridgeViewerId(`page-${descriptor.id}`)}
		>
			{uri ? (
				<Image
					source={{ uri }}
					style={box}
					contentFit="contain"
					cachePolicy="none"
					transition={0}
					accessible
					accessibilityRole={ROLE.image}
					accessibilityLabel={label}
				/>
			) : (
				<ActivityIndicator accessibilityLabel={`${label}, loading`} />
			)}
		</ScrollView>
	);
}

const CHIP_SIZE = 64;

/**
 * The composer's strip of staged images. Each chip says its state in words
 * under the thumbnail (D1), and the strip's summary line counts failures
 * first. Controls sit in separate corners so their 44 pt targets never overlap
 * (D7): Remove top-right, Retry bottom-left, each only as large as its own
 * corner quadrant plus the gutter around the chip.
 */
export function ComposerAttachments({
	chips,
	summary,
	onRemove,
	onRetry,
}: {
	chips: readonly DraftChip[];
	summary: string;
	onRemove: (key: string) => void;
	onRetry: (key: string) => void;
}) {
	const ink = useTokenColor("ink");
	if (chips.length === 0) return null;
	const rects = chipControlRects(CHIP_SIZE, TOUCH_FLOOR);
	// Where each badge DRAWS inside its hit rect (D13), from the same helper the
	// no-overlap test reads.
	const badges = chipBadgeRects(CHIP_SIZE, TOUCH_FLOOR);
	return (
		<View>
			{/* R4-02: the margin goes on the ScrollView, which GROWS its viewport by
			    the outset on every side, and the padding on its content, so the
			    chips keep their place and no 44 pt target is clipped. (Both on the
			    inner View cancel out: the content box shrinks back to the chips.) */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={CHIP_STRIP_LAYOUT.scroll}
				contentContainerStyle={CHIP_STRIP_LAYOUT.content}
			>
				<View className="flex-row gap-3">
					{chips.map((chip, index) => {
						const n = index + 1;
						const state = chipStateLabel(chip);
						const failed = chip.status === "failed";
						const busy =
							chip.status === "preparing" || chip.status === "uploading";
						return (
							<View
								key={chip.key}
								testID={teamBridgeAttachmentChipId(String(index))}
								style={{ width: CHIP_SIZE }}
							>
								<View
									accessible
									accessibilityLabel={`Image ${n}, ${failed ? (chip.error ?? "failed") : (state ?? "ready")}`}
									className={`items-center justify-center overflow-hidden rounded-sm border ${failed ? "border-danger" : "border-border-control"} bg-elevated`}
									style={{ width: CHIP_SIZE, height: CHIP_SIZE }}
								>
									{chip.preview ? (
										<Image
											source={{ uri: chip.preview }}
											style={{
												width: CHIP_SIZE,
												height: CHIP_SIZE,
												opacity: chip.status === "ready" ? 1 : 0.5,
											}}
											contentFit="cover"
											cachePolicy="none"
											transition={0}
										/>
									) : null}
									{busy ? (
										<View className="absolute inset-0 items-center justify-center">
											<ActivityIndicator color={ink} />
										</View>
									) : null}
								</View>
								{state ? (
									/* Hidden from assistive tech (R3-05): the chip's own
									   label already says the full state sentence. */
									<Text
										accessibilityElementsHidden
										aria-hidden
										importantForAccessibility="no"
										className={`pt-0.5 text-center text-meta ${failed ? "text-danger" : "text-ink-muted"}`}
										numberOfLines={1}
									>
										{state}
									</Text>
								) : null}
								{failed && chip.retryable ? (
									<Pressable
										accessibilityRole={ROLE.button}
										accessibilityLabel={`Retry image ${n}`}
										testID={teamBridgeAttachmentChipId(`${index}-retry`)}
										onPress={() => onRetry(chip.key)}
										// The band below Remove's: disjoint by construction (D7).
										style={{
											position: "absolute",
											left: rects.retry.x,
											top: rects.retry.y,
											width: rects.retry.width,
											height: rects.retry.height,
										}}
									>
										<View
											className="absolute h-6 w-6 items-center justify-center rounded-full border border-border-control bg-elevated"
											style={{
												left: badges.retry.x - rects.retry.x,
												top: badges.retry.y - rects.retry.y,
											}}
										>
											<RotateCw color={ink} size={13} />
										</View>
									</Pressable>
								) : null}
								<Pressable
									accessibilityRole={ROLE.button}
									accessibilityLabel={`Remove image ${n}`}
									testID={teamBridgeAttachmentChipId(`${index}-remove`)}
									onPress={() => onRemove(chip.key)}
									// The top band, above Retry's: disjoint by construction (D7).
									style={{
										position: "absolute",
										left: rects.remove.x,
										top: rects.remove.y,
										width: rects.remove.width,
										height: rects.remove.height,
									}}
								>
									<View
										className="absolute h-6 w-6 items-center justify-center rounded-full border border-border-control bg-elevated"
										style={{
											left: badges.remove.x - rects.remove.x,
											top: badges.remove.y - rects.remove.y,
										}}
									>
										<X color={ink} size={13} />
									</View>
								</Pressable>
							</View>
						);
					})}
				</View>
			</ScrollView>
			<Text
				role={ROLE.status}
				className={`pt-1 text-meta ${chips.some((c) => c.status === "failed") ? "text-danger" : "text-ink-dim"}`}
			>
				{summary}
			</Text>
		</View>
	);
}
