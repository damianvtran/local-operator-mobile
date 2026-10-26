/**
 * Team Bridge people, drawn: the photo-or-initials mark and the profile card.
 *
 * DISPLAY ONLY. Nothing here sends, receives or creates anything. The card's
 * "Message" action hands a `model.Target` to `useOpenTarget`, the same
 * navigation the People and Chiefs of staff rows use, so an existing DM opens
 * and a new one is created on first send by the existing thread path.
 *
 * WHY A SHEET. The desktop opens this card on hover (local-operator-ui
 * v0.44.0). A phone has no hover, so a tap on a person's photo or name opens
 * it as a sheet, which brings its own dismiss (the Close control and the
 * scrim) and its own modal accessibility scope.
 */
import { useRouter } from "expo-router";
import { Clock, MessageSquare } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { toBase64 } from "@/features/session/runtime";
import {
	type AvatarPixels,
	avatarFailure,
	avatarKey,
	avatarVersion,
} from "@/team-bridge/avatars";
import type { DirectoryMember } from "@/team-bridge/contract";
import type * as model from "@/team-bridge/model";
import {
	type ProfileSubject,
	profileCard,
	profileMessageTarget,
	subjectMarkLabel,
} from "@/team-bridge/profile";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import { Sheet } from "@/ui/components/sheet";
import type { AvatarSize } from "@/ui/variants";
import { ProfileDetails } from "./profile-details";

/** Rows read the 64 px variant; only the card's large mark reads 256 px. */
const PIXELS: Record<AvatarSize, AvatarPixels> = { sm: 64, md: 64, lg: 256 };

/**
 * The `data:` URI of one directory row's photo, or `null` (render initials).
 *
 * Reads through the account-scoped cache, so a list of twenty rows for the
 * same person makes one request, and a row with no photo makes none.
 * `onError` is the decoder's refusal: remembered as permanent for that hash
 * so the next mount does not read the same undecodable bytes again.
 */
export function useAvatarUri(
	member: DirectoryMember | null | undefined,
	size: AvatarSize,
): { uri: string | null; onError: () => void } {
	const { hub, avatars } = useTeamBridge();
	const version = avatarVersion(member);
	// Primitives, so the effect re-runs exactly when the photo identity changes
	// and not on every directory refresh that rebuilds the row object.
	const accountId = version?.accountId ?? null;
	const hash = version?.hash ?? null;
	const pixels = PIXELS[size];
	const key = accountId && hash ? avatarKey(accountId, hash, pixels) : null;
	const [uri, setUri] = useState<string | null>(() =>
		key ? avatars.peek(key) : null,
	);
	useEffect(() => {
		if (!key || !accountId || !hash) {
			setUri(null);
			return;
		}
		let live = true;
		setUri(avatars.peek(key));
		void avatars
			.load(
				key,
				async () => {
					const { mime, bytes } = await hub.avatarBytes(
						accountId,
						hash,
						pixels,
					);
					return `data:${mime};base64,${toBase64(bytes)}`;
				},
				avatarFailure,
			)
			.then((value) => {
				if (live) setUri(value);
			});
		return () => {
			live = false;
		};
	}, [avatars, hub, key, accountId, hash, pixels]);
	const onError = useCallback(() => {
		if (key) avatars.fail(key, "permanent");
		setUri(null);
	}, [avatars, key]);
	return { uri, onError };
}

/**
 * The kit's `Avatar`, given this person's photo when they have one. `label`
 * is what the initials are taken from; the mark stays decorative.
 */
export function PersonAvatar({
	member,
	label,
	size = "md",
}: {
	member: DirectoryMember | null | undefined;
	label: string;
	size?: AvatarSize;
}) {
	const { uri, onError } = useAvatarUri(member, size);
	return (
		<Avatar
			initials={initialsOf(label)}
			size={size}
			imageUri={uri}
			onImageError={onError}
		/>
	);
}

/**
 * Navigation to a Team Bridge target: an existing conversation by id, or a
 * draft DM (`conversationId: "new"`) that the thread creates on first send.
 * The ONE spelling of that route, shared by the list rows and the card.
 */
export function useOpenTarget(): (target: model.Target) => void {
	const router = useRouter();
	return useCallback(
		(target: model.Target) => {
			const params =
				target.kind === "conversation"
					? { tenantId: target.tenantId, conversationId: target.conversationId }
					: { ...target, conversationId: "new" };
			router.push({
				pathname: "/team-bridge/[tenantId]/[conversationId]",
				params,
			});
		},
		[router],
	);
}

/**
 * A person's photo as a control that opens their card. A SIBLING of the row's
 * own link, never nested inside it: a control inside a control is merged into
 * one element by VoiceOver and announced as nothing by react-native-web.
 */
export function ProfileAvatarButton({
	subject,
	label,
	size = "md",
	onOpen,
	testID,
}: {
	subject: ProfileSubject;
	label: string;
	size?: AvatarSize;
	onOpen: (subject: ProfileSubject) => void;
	testID: string;
}) {
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={`View profile for ${label}`}
			hitSlop={6}
			onPress={() => onOpen(subject)}
			testID={testID}
		>
			<PersonAvatar
				member={subject.person}
				label={subjectMarkLabel(subject)}
				size={size}
			/>
		</Pressable>
	);
}

/**
 * A thread author: the photo and the name open the same card, so they are ONE
 * accessible control (design round 1, D3). The name is the focus stop,
 * labelled with the name, and its hit box is padded to 44 pt with an equal
 * negative margin so the header keeps its line height. The photo stays
 * tappable for touch, but is hidden from assistive tech and the tab order so
 * it is not a second stop doing the same thing.
 */
export function ProfileAuthorName({
	subject,
	label,
	onOpen,
	testID,
}: {
	subject: ProfileSubject;
	label: string;
	onOpen: (subject: ProfileSubject) => void;
	testID: string;
}) {
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={label}
			accessibilityHint="Opens their profile"
			onPress={() => onOpen(subject)}
			testID={testID}
			className="-my-2.5 py-2.5"
		>
			<Text className="text-body font-semibold text-ink">{label}</Text>
		</Pressable>
	);
}

/** The author's photo: a touch target for the card, invisible to assistive tech. */
export function ProfileAuthorPhoto({
	subject,
	onOpen,
}: {
	subject: ProfileSubject;
	onOpen: (subject: ProfileSubject) => void;
}) {
	return (
		<Pressable
			accessible={false}
			// Native reads `focusable`; react-native-web ignores it and reads
			// `tabIndex`, so both are set or the web keeps a second tab stop.
			focusable={false}
			tabIndex={-1}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			// Both props above are native-only; react-native-web copies
			// `aria-hidden`, which is what keeps the initials out of the web
			// accessibility tree (design round 2, D7; `brand-mark.tsx` likewise).
			aria-hidden
			hitSlop={6}
			onPress={() => onOpen(subject)}
		>
			<PersonAvatar
				member={subject.person}
				label={subjectMarkLabel(subject)}
				size="sm"
			/>
		</Pressable>
	);
}

/**
 * The card. `subject` null is closed. `currentConversationId` lets the thread
 * screen close the sheet instead of pushing the conversation it already shows.
 */
export function ProfileSheet({
	subject,
	tenantId,
	onClose,
	currentConversationId,
}: {
	subject: ProfileSubject | null;
	tenantId: string;
	onClose: () => void;
	currentConversationId?: string | null;
}) {
	const open = useOpenTarget();
	const selfAccountId = useTeamBridgeState((s) => s.selfAccountId);
	const conversations = useTeamBridgeState(
		(s) => s.orgs[tenantId]?.conversations,
	);
	const mutedInk = useTokenColor("ink-muted");
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		if (!subject) return;
		// The card states a clock; keep it true while it stays open.
		setNow(new Date());
		const timer = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(timer);
	}, [subject]);
	const card = subject ? profileCard(subject, now) : null;
	const target = subject
		? profileMessageTarget(
				subject,
				conversations ?? [],
				selfAccountId,
				tenantId,
			)
		: null;
	return (
		<Sheet
			visible={!!subject}
			onClose={onClose}
			/* "Profile", not the name: the title row is one line and truncates,
			 * and a long name or "Agent (Owner)" pair was cut there (design D1).
			 * The full name is the body's first heading and wraps. */
			title="Profile"
			testID={SURFACE.teamBridgeProfile}
			footer={
				target ? (
					<View className="p-4">
						<Button
							label="Message"
							leadingIcon={({ color, size }) => (
								<MessageSquare color={color} size={size} />
							)}
							testID={CONTROL.teamBridgeProfileMessage}
							onPress={() => {
								onClose();
								if (
									target.kind === "conversation" &&
									target.conversationId === currentConversationId
								)
									return;
								open(target);
							}}
						/>
					</View>
				) : undefined
			}
		>
			{subject && card && (
				<ProfileDetails
					card={card}
					clock={<Clock size={14} color={mutedInk} />}
					photo={
						<PersonAvatar
							member={subject.person}
							label={card.markLabel}
							size="lg"
						/>
					}
				/>
			)}
		</Sheet>
	);
}
