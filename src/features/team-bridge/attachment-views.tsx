import { Image } from "expo-image";
import { RotateCw, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
	attachmentCacheKey,
	attachmentView,
	dataUri,
	loadAttachment,
} from "@/team-bridge/attachments";
import type { HubClient } from "@/team-bridge/client";
import type { AttachmentDescriptor } from "@/team-bridge/contract";
import {
	ROLE,
	teamBridgeAttachmentChipId,
	teamBridgeAttachmentId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import type { DraftChip } from "./attachment-draft";

/*
 * Rendered images are fitted into this box. A phone column is ~340 pt wide;
 * 240 pt keeps a portrait photo from taking a whole screen of scroll, and the
 * descriptor's dimensions reserve the box BEFORE the bytes arrive, so a row
 * never jumps when its image loads.
 */
const MAX_IMAGE_EDGE = 240;
const PLACEHOLDER_HEIGHT = 96;

function boxFor(descriptor: AttachmentDescriptor): {
	width: number;
	height: number;
} {
	const width = descriptor.width ?? 0;
	const height = descriptor.height ?? 0;
	if (!(width > 0 && height > 0))
		return { width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE * 0.75 };
	const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
	return {
		width: Math.max(48, Math.round(width * scale)),
		height: Math.max(48, Math.round(height * scale)),
	};
}

/** The placeholder box for every state that shows no image. */
function Placeholder({
	text,
	testID,
	action,
}: {
	text: string;
	testID: string;
	action?: { label: string; onPress: () => void };
}) {
	return (
		<View
			testID={testID}
			className="items-center justify-center gap-1 rounded-sm border border-hairline bg-elevated px-3"
			style={{ width: MAX_IMAGE_EDGE, minHeight: PLACEHOLDER_HEIGHT }}
		>
			<Text className="text-meta text-ink-muted">{text}</Text>
			{action ? (
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={action.label}
					onPress={action.onPress}
					style={{ minHeight: TOUCH_FLOOR, justifyContent: "center" }}
				>
					<Text className="text-meta font-semibold text-ink">
						{action.label}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}

/**
 * One bound image, read with the reader's bearer and shown from memory.
 *
 * WHY NOT `source={{ uri, headers }}`. `expo-image` can send headers, but then
 * the token travels inside the image pipeline and the response lands in its
 * disk cache. Reading through `hub.attachmentBytes` keeps the bearer on the
 * client's one request path (refresh-once-on-401, timeouts, error classes),
 * checks the bytes are really PNG/JPEG before anything decodes them, and keeps
 * the image in this process's bounded cache only (cleared on sign-out).
 * `cachePolicy="none"` stops `expo-image` adding a copy of its own.
 */
function RemoteImage({
	hub,
	tenantId,
	conversationId,
	messageId,
	descriptor,
	index,
	count,
}: {
	hub: HubClient;
	tenantId: string;
	conversationId: string;
	messageId: string;
	descriptor: AttachmentDescriptor;
	index: number;
	count: number;
}) {
	const key = attachmentCacheKey(
		tenantId,
		conversationId,
		messageId,
		descriptor.id,
	);
	const [uri, setUri] = useState<string | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "error" | "gone">(
		"loading",
	);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let live = true;
		setState("loading");
		// `attempt` is read so a Retry press re-runs this effect.
		void attempt;
		loadAttachment(key, async () => {
			const { mime, bytes } = await hub.attachmentBytes(
				tenantId,
				conversationId,
				messageId,
				descriptor.id,
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
	}, [hub, key, tenantId, conversationId, messageId, descriptor.id, attempt]);
	const label = count === 1 ? "Image" : `Image ${index + 1} of ${count}`;
	const testID = teamBridgeAttachmentId(descriptor.id);
	if (state === "gone")
		return <Placeholder text="Image unavailable" testID={testID} />;
	if (state === "error")
		return (
			<Placeholder
				text="This image did not load."
				testID={testID}
				action={{ label: "Retry", onPress: () => setAttempt((n) => n + 1) }}
			/>
		);
	const box = boxFor(descriptor);
	return (
		<View
			testID={testID}
			accessible
			accessibilityRole={ROLE.image}
			accessibilityLabel={state === "ready" ? label : `${label}, loading`}
			className="overflow-hidden rounded-sm border border-hairline bg-elevated"
			style={box}
		>
			{uri ? (
				<Image
					source={{ uri }}
					style={box}
					contentFit="cover"
					cachePolicy="none"
					// The descriptor box is already reserved; no fade so the settled
					// frame is the first frame.
					transition={0}
				/>
			) : null}
		</View>
	);
}

/**
 * Every attachment on one message, in send order, each in its own state.
 * Rendered ONLY from the structured `attachments[]` list: an image link in the
 * body text stays alt text (`Markdown`), so a message cannot make this app
 * fetch a URL it names.
 */
export function MessageAttachments({
	hub,
	tenantId,
	conversationId,
	messageId,
	attachments,
}: {
	hub: HubClient;
	tenantId: string;
	conversationId: string;
	messageId: string;
	attachments: ReadonlyArray<AttachmentDescriptor | null>;
}) {
	if (attachments.length === 0) return null;
	return (
		<View className="flex-row flex-wrap gap-2 pt-1">
			{attachments.map((descriptor, index) => {
				const view = attachmentView(descriptor);
				const fallbackId = teamBridgeAttachmentId(`${messageId}-${index}`);
				if (view === "expired" || descriptor === null || view !== "image")
					return (
						<Placeholder
							key={descriptor?.id ?? fallbackId}
							text={view === "expired" ? "Image expired" : "Image unavailable"}
							testID={
								descriptor ? teamBridgeAttachmentId(descriptor.id) : fallbackId
							}
						/>
					);
				return (
					<RemoteImage
						key={descriptor.id}
						hub={hub}
						tenantId={tenantId}
						conversationId={conversationId}
						messageId={messageId}
						descriptor={descriptor}
						index={index}
						count={attachments.length}
					/>
				);
			})}
		</View>
	);
}

const CHIP_SIZE = 64;

/** The composer's strip of staged images, each with remove and (on failure) retry. */
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
	return (
		<View>
			<ScrollView horizontal showsHorizontalScrollIndicator={false}>
				<View className="flex-row gap-1.5">
					{chips.map((chip, index) => {
						const n = index + 1;
						const status =
							chip.status === "ready"
								? "ready"
								: chip.status === "failed"
									? (chip.error ?? "failed")
									: chip.status === "uploading"
										? "uploading"
										: "preparing";
						return (
							<View
								key={chip.key}
								testID={teamBridgeAttachmentChipId(String(index))}
								accessible
								accessibilityLabel={`Image ${n}, ${status}`}
								className="relative"
							>
								<View
									className={`items-center justify-center overflow-hidden rounded-sm border ${chip.status === "failed" ? "border-danger" : "border-border-control"} bg-elevated`}
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
									) : (
										<Text className="text-meta text-ink-muted">…</Text>
									)}
								</View>
								{chip.status === "failed" ? (
									<Pressable
										accessibilityRole={ROLE.button}
										accessibilityLabel={`Retry image ${n}`}
										testID={teamBridgeAttachmentChipId(`${index}-retry`)}
										onPress={() => onRetry(chip.key)}
										style={{
											position: "absolute",
											bottom: 0,
											left: 0,
											width: TOUCH_FLOOR,
											height: TOUCH_FLOOR,
											justifyContent: "flex-end",
										}}
									>
										<View className="m-0.5 h-5 w-5 items-center justify-center rounded-full border border-border-control bg-elevated">
											<RotateCw color={ink} size={12} />
										</View>
									</Pressable>
								) : null}
								{/* The one removal affordance, the session composer's shape: a
								    visible badge with a real name and a 44 pt hit area. */}
								<Pressable
									accessibilityRole={ROLE.button}
									accessibilityLabel={`Remove image ${n}`}
									testID={teamBridgeAttachmentChipId(`${index}-remove`)}
									onPress={() => onRemove(chip.key)}
									style={{
										position: "absolute",
										top: 0,
										right: 0,
										width: TOUCH_FLOOR,
										height: TOUCH_FLOOR,
										alignItems: "flex-end",
									}}
								>
									<View className="m-0.5 h-5 w-5 items-center justify-center rounded-full border border-border-control bg-elevated">
										<X color={ink} size={12} />
									</View>
								</Pressable>
							</View>
						);
					})}
				</View>
			</ScrollView>
			<Text className="pt-1 text-meta text-ink-dim" numberOfLines={1}>
				{summary}
			</Text>
		</View>
	);
}
