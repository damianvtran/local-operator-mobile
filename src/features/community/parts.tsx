/**
 * Small pieces every community screen shares: the row, the section heading,
 * the load-failure block and the route frame.
 *
 * WHY ONE FRAME FOR EVERY ROUTE. The community is DARK (`flag.ts`) and needs a
 * Radient sign-in of its own (RFC §7.2: the phone is a direct client). Every
 * `/community/*` route goes through `CommunityFrame` so none can be reached by a
 * deep link while the flag is off, and none paints community chrome for a
 * signed-out reader, rather than each screen repeating (and drifting on) the
 * two checks.
 */
import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { CommunityError } from "@/community/client";
import { communityEnabled } from "@/community/flag";
import { useCommunity } from "@/community/provider";
import { useConnection } from "@/features/auth/connection-provider";
import { countLabel } from "@/features/notifications/notifications-model";
import { t } from "@/i18n";
import { state as a11yState, CONTROL, ROLE } from "@/ui/a11y";
import { BackButton } from "@/ui/components/back-button";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { useComposedDir } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";
import { errorSentence } from "./labels";

export function CommunityBack({
	fallback = "/team-bridge",
}: {
	fallback?: string;
}) {
	const router = useRouter();
	const { actions } = useCommunity();
	return (
		<BackButton
			accessibilityLabel={t("mobile.team_bridge.back")}
			testID={CONTROL.teamBridgeBack}
			onPress={() => {
				if (router.canGoBack()) {
					router.back();
					return;
				}
				/* No history: the fallback MOUNTS the list fresh, and its opening
				 * rule would send a reader leaving this community straight back
				 * into it (`CommunityOpening`). Leaving is switching back. */
				if (fallback === "/team-bridge") actions.holdOpening();
				router.replace(fallback as Parameters<typeof router.replace>[0]);
			}}
		/>
	);
}

/**
 * The route frame: the flag and the sign-in, before any community chrome. A
 * web fixture build stands in a synthetic token for the sign-in (the seam's own
 * gates keep that path out of every real build).
 */
export function CommunityFrame({
	title,
	testID,
	headerAction,
	headerDetail,
	scroll = true,
	fallback,
	children,
}: {
	title: string;
	testID: string;
	headerAction?: ReactNode;
	headerDetail?: ReactNode;
	scroll?: boolean;
	fallback?: string;
	children: ReactNode;
}) {
	const connection = useConnection();
	const { fixture } = useCommunity();
	const signedIn = Boolean(connection.radientAccountId) || fixture;
	const open = communityEnabled() && signedIn;
	return (
		<Screen
			title={open ? title : t("mobile.community.common.unavailable")}
			headerLeading={<CommunityBack fallback={fallback} />}
			headerAction={open ? headerAction : undefined}
			headerDetail={open ? headerDetail : undefined}
			scroll={scroll}
			testID={testID}
		>
			{open ? (
				children
			) : (
				<View className="gap-3 px-4 py-6">
					<Text className="text-body text-ink-muted">
						{signedIn
							? t("mobile.community.error.not_found")
							: t("mobile.community.error.sign_in")}
					</Text>
				</View>
			)}
		</Screen>
	);
}

export function SectionLabel({ label }: { label: string }) {
	return (
		<Text
			accessibilityRole={ROLE.header}
			className="px-4 pb-1 pt-4 text-meta font-semibold text-ink-dim"
		>
			{label}
		</Text>
	);
}

/** A failed read, its cause, and a retry. `role=alert` so it is announced. */
export function LoadFailure({
	error,
	onRetry,
}: {
	error: CommunityError | null;
	onRetry: () => void;
}) {
	return (
		<View className="gap-2 px-4 py-3">
			<Text accessibilityRole={ROLE.alert} className="text-body-sm text-danger">
				{errorSentence(error, "read")}
			</Text>
			<View className="self-start">
				<Button
					label={t("mobile.community.common.retry")}
					variant="outline"
					size="sm"
					testID={CONTROL.communityLoadRetry}
					onPress={onRetry}
				/>
			</View>
		</View>
	);
}

/**
 * A tappable list row: a leading glyph, a label, an optional detail, a trailing slot.
 *
 * THE LABEL STATES THE PAGE'S DIRECTION (design review round 1, D2). Channel,
 * member and community names are usually Latin; left to react-native-web's
 * `dir="auto"`, a Latin name lays out left-to-right inside a mirrored RTL row,
 * so in Urdu `general` sat ~260 px away from its `#` glyph. The page's base is
 * stated instead (`useComposedDir`, the fix `computers.tsx` and
 * `transient-notice.tsx` already carry); a Latin word inside an RTL paragraph
 * still renders left-to-right by the bidi algorithm, so nothing is reversed.
 *
 * `inset="switcher"` matches the private org rows in the switcher sheet (px-3,
 * a 24 pt leading tile), so both groups share one column (D4).
 */
export function CommunityRow({
	label,
	detail,
	leading,
	trailing,
	accessibilityLabel,
	selected,
	bold,
	inset = "list",
	onPress,
	testID,
}: {
	label: string;
	detail?: string | null;
	leading?: ReactNode;
	trailing?: ReactNode;
	accessibilityLabel?: string;
	selected?: boolean;
	bold?: boolean;
	inset?: "list" | "switcher";
	onPress: () => void;
	testID: string;
}) {
	/* See `SectionHeader`: `dir` is a react-native-web prop RN's TextProps lack. */
	const dir: object = useComposedDir();
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityState={a11yState({ selected: selected || undefined })}
			onPress={onPress}
			testID={testID}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					className={cx(
						"flex-1 flex-row items-center gap-3 rounded-sm py-2",
						inset === "switcher" ? "px-3" : "px-4",
						selected
							? "bg-row-selected"
							: pressed
								? "bg-row-hover"
								: "bg-transparent",
					)}
				>
					{leading ? (
						<View
							className={
								inset === "switcher"
									? "h-6 w-6 items-center justify-center"
									: ""
							}
							aria-hidden
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
						>
							{leading}
						</View>
					) : null}
					<View className="min-w-0 flex-1 justify-center">
						<Text
							{...dir}
							className={cx("text-body text-ink", bold ? "font-semibold" : "")}
							numberOfLines={1}
						>
							{label}
						</Text>
						{detail ? (
							<Text
								{...dir}
								className="text-meta text-ink-dim"
								numberOfLines={2}
							>
								{detail}
							</Text>
						) : null}
					</View>
					{trailing}
				</View>
			)}
		</Pressable>
	);
}

/** The unread pill; nothing for zero (unknown is not drawn as zero either). */
export function UnreadPill({ count }: { count: number }) {
	if (!count) return null;
	return (
		<View
			className="rounded-full bg-accent px-2 py-0.5"
			aria-hidden
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			<Text className="text-mono-label tabular-nums text-on-accent">
				{countLabel(count)}
			</Text>
		</View>
	);
}

/**
 * The trailing column every switcher row shares: unread pill, then the check.
 * The check keeps its 18 pt slot even when unchecked so pills line up down the
 * sheet whichever row is selected.
 */
export function SwitcherTrailing({
	unread,
	checked,
	checkColor,
}: {
	unread: number;
	checked: boolean;
	checkColor: string;
}) {
	return (
		<View className="flex-row items-center gap-2">
			<UnreadPill count={unread} />
			<View className="h-[18px] w-[18px]" aria-hidden>
				{checked ? <Check size={18} color={checkColor} aria-hidden /> : null}
			</View>
		</View>
	);
}

/**
 * An explicit agreement tick: starts unticked, the whole row is the target, and
 * it is a real checkbox to assistive tech. Shared by the guidelines agreement
 * (join) and the DM report consent, because both are consent the server takes
 * as a literal `true` and neither may ever be pre-ticked.
 */
export function ConsentTick({
	checked,
	label,
	onToggle,
	disabled,
	testID,
}: {
	checked: boolean;
	label: string;
	onToggle: () => void;
	disabled?: boolean;
	testID: string;
}) {
	return (
		<Pressable
			accessibilityRole={ROLE.checkbox}
			accessibilityState={{ checked, disabled: disabled || undefined }}
			accessibilityLabel={label}
			disabled={disabled}
			onPress={onToggle}
			testID={testID}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			<View className="flex-row items-start gap-3 py-1">
				<View
					className={cx(
						"mt-0.5 h-5 w-5 items-center justify-center rounded-sm border",
						checked
							? "border-accent bg-accent"
							: "border-border-control bg-transparent",
					)}
					aria-hidden
				>
					{checked ? (
						<Text className="text-mono-label text-on-accent">✓</Text>
					) : null}
				</View>
				<Text className="min-w-0 flex-1 text-body-sm text-ink">{label}</Text>
			</View>
		</Pressable>
	);
}
