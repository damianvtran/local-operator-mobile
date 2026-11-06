import { useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { startingLine, suggestionSlotFor } from "@/features/home/home-copy";
import { t } from "@/i18n";
import { ROLE, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { TYPE_STEPS } from "@/ui/tokens.gen";
import { buttonClasses, cx } from "@/ui/variants";

/**
 * The splash: what the home shows before there is anything to show.
 *
 * It is the answer to the one question this screen exists for — "what can this
 * do?" — under a composer that is ready for the answer. Composed from the
 * spec's anatomy: mark, greeting, suggestions, tip, then the composer below (the
 * composer is NOT this component's child; the home composes them, and that is
 * what keeps the composer's foot position invariant in every yield below).
 *
 * **The yield order.** When the free area cannot hold the splash, the splash
 * gives pieces up rather than growing into the composer: the tip goes first, then
 * the mark, then the third suggestion row, and only then does the region scroll
 * (the spec's order, at the sizes it names: the tip is −34 pt at 200 % and the
 * difference between fitting at 348 of 352 and not). The rule behind the order:
 * the greeting and the suggestions are the screen's content; the mark and the tip
 * are its decoration, and decoration yields first.
 *
 * The measurement is two `onLayout`s — the region's box and the content's
 * natural height — and the levels re-run from zero whenever the region changes
 * (rotation, a text-scale change, the keyboard opening), because a yield
 * computed for one box is wrong for the next. Nothing here can move the
 * composer: it is a sibling, and every yield only makes this region shorter.
 *
 * **The tip rotates on twelve seconds and is not announced** (`home-copy.ts`
 * has the pool and the reasons). Its presence is a function of the region's
 * height and the pool at large — never of the current entry's length — and its
 * reserve is fixed for the scale (one `meta` line, two at large text, where the
 * line would otherwise paint wider than the phone and be cut at both ends —
 * review round 3, D2), so a rotation never moves anything below it.
 */
export type HomeSplashProps = {
	draft: string;
	editing?: boolean;
	/** The suggestions' slot is the connect action when nothing is connected. */
	connected: boolean;
	onPick: (text: string) => void;
	onConnect: () => void;
	/** The first send is in flight: the splash yields to one line. */
	starting: boolean;
};

/** One suggestion row: the `quiet` variant's language at full width.
 *
 * The rows are not `Button`s because a Button sizes to its label and these are
 * full-width targets (the spec's "full-width ghost rows"); they borrow the
 * variant's own classes so the press feedback is the kit's, not a new one.
 *
 * **No rule between rows** (user feedback, this batch). A hairline under each row
 * turned a stack of controls into a table: the divider is the desktop's list
 * grammar, not its suggestion grammar. The desktop's measured stack does exactly
 * what these rows do now — text at rest, a `bg-elevated` surface on the row under
 * the pointer — and the kit's `quiet` variant already paints the pressed surface
 * from the same token. The row stays full-bleed with its 44 pt floor, so the whole
 * width is still the target and no boundary is needed to find it.
 *
 * The one-line cap was calibrated at 100 % text scale. Large text instead gets
 * two centred lines, matching the tip's rule, so longer localized labels remain
 * readable rather than ending in an ellipsis. The minimum touch height stays a
 * floor: the row and its pressed surface grow with the wrapped label. */
const SuggestionRow = ({
	label,
	largeText,
	onPress,
	testID,
}: {
	label: string;
	largeText: boolean;
	onPress: () => void;
	/** Set on the offline state's Connect row (`homeConnect`); the suggestion
	 *  rows themselves carry no ids — they are content, and a flow presses them
	 *  by their label. */
	testID?: string;
}) => {
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			onPress={onPress}
			testID={testID}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					className={cx(
						buttonClasses("quiet", "md", { pressed }),
						/* The pressed surface carries the row's edge feedback now that the rule
						 * is gone: `elevated` is the token the desktop's `hover:bg-elevated`
						 * uses, so one gesture means one thing on both clients. */
						"w-full",
						pressed && "bg-elevated",
					)}
					style={{ borderRadius: 8 }}
				>
					{/* A NAMED TYPE ROLE, not a bare colour class. A `<Text>` carrying only
					 *  `text-ink-muted` inherits the stylesheet's fixed 14 px: it never reads a
					 *  `--text-*` role, so it was the one string on the splash that ignored the
					 *  reader's text size — measured by the capture at iphone-15-landscape, where
					 *  the row's 14 px held at 200 % while every other role doubled (body 16→32,
					 *  title 20→40), and the cell was reported UNREADY (median text 1.74x at
					 *  200 %, needs ≥ 1.9x) because of it.
					 *
					 *  `body-sm` is the kit's role for a full-width row's label: the same row
					 *  grammar this kit already uses for the panel's conversation rows, the past
					 *  list's rows and the settings rows (`text-body-sm text-ink`), and it is the
					 *  step the row already PAINTS (14 px / 400) — so the fix is scale-only and
					 *  the row's 100 % rendering is untouched. `label` (15 px / 600) is the role
					 *  for a control's own label (Button, Segmented) and would restyle a row that
					 *  reads as copy, not as a caption; a bare colour class is the defect. */}
					<Text
						className={cx(
							"text-body-sm",
							pressed ? "text-ink" : "text-ink-muted",
							largeText && "text-center",
						)}
						numberOfLines={largeText ? 2 : 1}
					>
						{label}
					</Text>
				</View>
			)}
		</Pressable>
	);
};

/** The tip's own line height at 100 %: the spec's 20 pt. A tick that changed the
 *  line's height would move everything under it (the desktop's rule) — the
 *  height is therefore fixed PER SCALE, and the two numbers that fix it are
 *  this one and the reserve below. */
const TIP_LINE_PX = 20;

/** The reserve the tip rotates inside at a text scale: one `meta` line at
 *  normal text, two above `LARGE_TEXT_SCALE` — computed from the ONE type
 *  table (`tokens.gen`), not hand-copied, so it moves with the tokens.
 *
 *  Why two lines are the large-text shape: at 200 % the pool's own budget
 *  paints ~444-497 dp against a 358 dp content column on a 390 pt phone, and
 *  the longest entry still wraps to two lines on a 320 pt phone (each line
 *  holds roughly half its 45 glyphs), so two lines is what the copy needs and
 *  the clamp below is its mop-up exactly as `numberOfLines={1}` was at 100 %.
 *  FIXED for the scale — never for the current entry's length — so a rotation
 *  moves nothing below it; a scale change re-measures the whole splash anyway
 *  (the two `onLayout`s), which is the one case this number is allowed to
 *  change in. */
const _tipReserveDp = (scale: number, largeText: boolean): number =>
	largeText
		? 2 * TYPE_STEPS.meta.size * scale * TYPE_STEPS.meta.lineHeight
		: TIP_LINE_PX;

/** Connected empty state only. Recovery lives at the home composition boundary:
 * never paint a welcome/connect hero behind an expired or restoring session. */
export const HomeSplash = ({
	draft,
	editing,
	connected,
	onPick,
	starting,
}: HomeSplashProps) => {
	const { width } = useWindowDimensions();
	const { effectiveScale } = useTextScale();
	const slot = suggestionSlotFor({ connected, draft, width });
	const rows =
		slot.kind === "suggestions" && !draft.length && !editing
			? slot.rows.slice(0, 2)
			: [];
	return (
		<View className="flex-1" testID={SURFACE.homeSplash}>
			<ScrollView
				contentContainerStyle={{ padding: 16, paddingTop: 24 }}
				keyboardShouldPersistTaps="handled"
			>
				<Text
					className="text-title text-ink"
					testID={starting ? SURFACE.homeStarting : SURFACE.homeGreeting}
				>
					{starting ? startingLine() : t("mobile.chrome.home.greeting")}
				</Text>
				{rows.length ? (
					<View testID={SURFACE.homeSuggestions}>
						{rows.map((label) => (
							<SuggestionRow
								key={label}
								label={label}
								largeText={effectiveScale > LARGE_TEXT_SCALE}
								onPress={() => onPick(label)}
							/>
						))}
					</View>
				) : null}
			</ScrollView>
		</View>
	);
};

export type HomeRecoveryKind =
	| "restoring"
	| "no-host"
	| "auth"
	| "offline"
	| "error";
/** Presentation of already-decided connection facts only; never retries on mount,
 * changes authorization, or replays a quarantined draft. Details are opt-in. */
export const HomeRecovery = ({
	kind,
	host,
	detail,
	onRetry,
	onSignIn,
	onConnect,
}: {
	kind: HomeRecoveryKind;
	host: string;
	detail?: string;
	onRetry: () => void;
	onSignIn: () => void;
	onConnect: () => void;
}) => {
	const [details, setDetails] = useState(false);
	const title =
		kind === "restoring"
			? t("mobile.chrome.home.connecting", { host })
			: kind === "no-host"
				? t("mobile.chrome.home.connect")
				: kind === "auth"
					? t("mobile.chrome.home.sign_in")
					: kind === "offline"
						? t("mobile.chrome.home.reconnecting", { host })
						: t("mobile.computers.session_error");
	return (
		<View className="px-4 pt-6 pb-3 gap-2" testID={SURFACE.homeRecovery}>
			<View className="flex-row items-center gap-2">
				{kind === "restoring" ? <ActivityIndicator /> : null}
				<Text className="text-title text-ink" accessibilityRole="header">
					{title}
				</Text>
			</View>
			{kind !== "restoring" && kind !== "no-host" ? (
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.chrome.home.saved_draft")}
				</Text>
			) : null}
			{kind !== "restoring" ? (
				<Button
					label={
						kind === "auth"
							? t("mobile.chrome.home.sign_in")
							: kind === "no-host"
								? t("mobile.chrome.home.connect")
								: t("mobile.computers.retry")
					}
					onPress={
						kind === "auth"
							? onSignIn
							: kind === "no-host"
								? onConnect
								: onRetry
					}
					testID={SURFACE.homeRecoveryAction}
				/>
			) : null}
			{detail ? (
				<>
					<Button
						variant="quiet"
						label={t(
							details
								? "mobile.computers.hide_details"
								: "mobile.computers.show_details",
						)}
						onPress={() => setDetails((v) => !v)}
						testID={SURFACE.homeRecoveryDetails}
					/>
					{details ? (
						<Text className="text-body-sm text-ink-dim">{detail}</Text>
					) : null}
				</>
			) : null}
		</View>
	);
};
