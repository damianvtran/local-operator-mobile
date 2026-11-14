import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { SignInPanel } from "@/features/auth/sign-in-panel";
import { signInPresentation } from "@/features/auth/sign-in-presentation";
import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Card } from "@/ui/components/card";
import { Dialog } from "@/ui/components/dialog";
import { useComposedDir, useIsRTL } from "@/ui/direction";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { NAV_CARD_MIN_HEIGHT, navCardClasses } from "@/ui/variants";

/**
 * Settings' account card: who this phone is signed in as, and — when it is NOT
 * signed in with Radient — the way to sign in.
 *
 * WHY THIS IS ITS OWN COMPONENT. Sherman's Settings (relayed by Aida) showed
 * "Not signed in with Radient" on an inert card that read as the way to sign in.
 * The first fix keyed the button on `connectionStore.accountLabel == null`, and
 * PR #258's review (R1, B1) found nothing in production ever writes a non-null
 * `accountLabel`: EVERY reader, signed in or not, got a button whose
 * `signInWithRadient` retires the live grant and ends the route before the
 * browser opens. Split out so the decision is rendered and pressed in a test
 * (`account-card.test.tsx`), not pinned as source text.
 *
 * THE SIGNAL is the provider's `radientSignedIn` — the rendered mirror of the
 * held Radient tokens every request path reads — and nothing else. The title,
 * the avatar's name and the button all derive from it, so the card cannot say
 * "Not signed in" to a signed-in reader (the pre-existing wrong title, which is
 * also what Sherman saw). Before `coldStartSettled` the tokens may simply not be
 * restored yet, so the card stays inert rather than offer a sign-in that would
 * throw a restoring grant away.
 *
 * THE FLOW is Welcome's, not a fork: the provider's `signInWithRadient` (which
 * opens the usual computer, `openUsualComputer`), landed through
 * `signInPresentation` with the same `router.replace`, and the same
 * `SignInPanel` for progress and failure.
 *
 * THE CONFIRM (R1 m1). `signInWithRadient` ends the current route
 * synchronously. A direct or own-tunnel reader is legitimately not signed in
 * with Radient and may have a working connection; one tap on a card must not
 * end it unasked. So with a working route the card first opens the sign-out
 * Dialog's pattern, naming the effect. With no route, or a refused one (which
 * Computers already offers this same sign-in for), nothing works to lose and the
 * card starts directly.
 */
export function AccountCard() {
	const router = useRouter();
	const {
		signInWithRadient,
		signInState,
		signInDiagnostics,
		restoredAccount,
		busy,
		radientSignedIn,
		coldStartSettled,
		refusal,
	} = useConnection();
	const route = useConnectionState((state) => state.route);
	const accountLabel = useConnectionState((state) => state.accountLabel);
	const computers = useConnectionState((state) => state.computers);
	/* The title is the account label (a Latin email or name) OR a translated
	 * phrase that in Urdu begins with the Latin `Radient`. RN-web's `dir="auto"`
	 * then resolves it LTR on an RTL page and it sits on the wrong edge, away from
	 * its same-card subtitle (design review D2). Both lines state the page's
	 * base so they share one edge. */
	const composedDir = useComposedDir();
	const rtl = useIsRTL();
	const chevronInk = useTokenColor("ink-dim");
	/* The RENDERED text scale: on the web the platform's own signal multiplies
	 * through `rem`, so this is the number a reader perceives. */
	const stacked = useTextScale().effectiveScale > LARGE_TEXT_SCALE;

	const offersSignIn = coldStartSettled && !radientSignedIn;
	/* A route that is not refused is one the reader may be using right now. */
	const holdsWorkingRoute = route !== null && refusal === null;

	const [initiated, setInitiated] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const startSignIn = useCallback(() => {
		setConfirming(false);
		setInitiated(true);
		void signInWithRadient();
	}, [signInWithRadient]);
	const onPress = useCallback(() => {
		if (holdsWorkingRoute) setConfirming(true);
		else startSignIn();
	}, [holdsWorkingRoute, startSignIn]);
	/* Hooks run whether or not the button is shown: a successful sign-in flips
	 * `radientSignedIn` (the button goes away) before the landing navigates. */
	const landing = signInPresentation({
		initiated,
		restoredAccount,
		busy,
		routed: route !== null,
		state: signInState,
	});
	useEffect(() => {
		if (landing.navigate) router.replace(landing.destination);
	}, [landing.navigate, landing.destination, router]);

	const signedInTitle =
		accountLabel ?? t("mobile.settings.account.signed_in_radient");
	const title = radientSignedIn
		? signedInTitle
		: t("mobile.settings.account.not_signed_in");

	/* A COLUMN above `LARGE_TEXT_SCALE`, not a `flex-wrap` — wrapping does
	 *  nothing here, because the text beside the avatar is `flex-1` and will
	 *  always take whatever width is left rather than move to a new line. At
	 *  200 % on a 320 pt phone that left it a 180 pt column and "Radient"
	 *  broke mid-word; stacking puts the identity under its own mark. */
	const body = (
		<View
			className={stacked ? "items-start gap-2" : "flex-row items-center gap-3"}
		>
			<Avatar
				initials={initialsOf(
					accountLabel ??
						computers[0]?.name ??
						t("mobile.settings.account.app_name"),
				)}
				size="md"
				accessibilityLabel={
					radientSignedIn
						? t("mobile.settings.account.signed_in")
						: t("mobile.settings.account.not_signed_in")
				}
			/>
			<View
				className={stacked ? "min-w-0 w-full gap-1" : "min-w-0 flex-1 gap-1"}
			>
				<Text
					className="text-body text-ink"
					testID={CONTROL.settingsAccountTitle}
					{...composedDir}
				>
					{title}
				</Text>
				<Text
					className="text-body-sm text-ink-dim"
					numberOfLines={1}
					ellipsizeMode="tail"
					{...composedDir}
				>
					{route
						? route.mode === "radient"
							? t("mobile.settings.account.route_radient")
							: t("mobile.settings.account.route_direct", {
									baseUrl: route.baseUrl,
								})
						: t("mobile.settings.status.no_connection")}
				</Text>
			</View>
		</View>
	);

	return (
		<>
			{offersSignIn ? (
				/* Signed out: the whole card is the sign-in button, in the nav-card
				 *  family (`navCardClasses`) with its chevron, so it reads as a place
				 *  to go rather than an inert panel. */
				<Pressable
					accessibilityRole={ROLE.button}
					/* Spoken as the action, with the state as the hint — the Team
					 *  Bridge card's shape (label + caption-as-hint). */
					accessibilityLabel={t("mobile.signin.start")}
					accessibilityHint={t("mobile.settings.account.not_signed_in")}
					accessibilityState={{ busy, disabled: busy }}
					disabled={busy}
					onPress={onPress}
					testID={CONTROL.settingsAccountSignIn}
				>
					{({ pressed }) => (
						<View
							className={navCardClasses({ pressed })}
							style={{ minHeight: NAV_CARD_MIN_HEIGHT }}
						>
							<View className="min-w-0 flex-1 gap-2">
								{body}
								{/* The visible label: the card must SAY it signs you in; a
								 *  status line and a chevron alone read as "go and look".
								 *  Welcome's own key, so the two doors match. */}
								<Text className="text-label text-accent" {...composedDir}>
									{t("mobile.signin.start")}
								</Text>
							</View>
							{rtl ? (
								<ChevronLeft size={18} color={chevronInk} aria-hidden />
							) : (
								<ChevronRight size={18} color={chevronInk} aria-hidden />
							)}
						</View>
					)}
				</Pressable>
			) : (
				<Card>{body}</Card>
			)}
			{/* The SAME progress and failure surface Welcome renders under its
			 *  button. Gated on this card's own attempt, so a sign-in state left by
			 *  another screen is not narrated here; it renders nothing while idle. */}
			{initiated ? (
				<SignInPanel
					state={landing.state}
					diagnostics={signInDiagnostics}
					onStart={startSignIn}
					onUseAddress={() => undefined}
				/>
			) : null}
			<Dialog
				visible={confirming}
				title={t("mobile.settings.sign_in_confirm.title")}
				body={t("mobile.settings.sign_in_confirm.body")}
				confirmLabel={t("mobile.settings.sign_in_confirm.confirm")}
				onConfirm={startSignIn}
				onCancel={() => setConfirming(false)}
				destructive
				testID={CONTROL.settingsAccountSignInConfirm}
			/>
		</>
	);
}
