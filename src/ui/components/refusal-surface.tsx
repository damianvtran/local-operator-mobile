import * as WebBrowser from "expo-web-browser";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { t } from "@/i18n";

import { CONTROL, LIVE_REGION, REGION, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { CommandBlock } from "@/ui/components/command-block";
import { DIAGNOSTIC_FALLBACK } from "@/ui/components/diagnostic-fallback";
import { Sheet } from "@/ui/components/sheet";
import { useComposedDir } from "@/ui/direction";
import { useTextScale } from "@/ui/text-scale-provider";
import { TYPE_STEPS } from "@/ui/tokens.gen";

/**
 * The refusal surface: what the app shows when a connection CANNOT be made
 * (`docs/ux/flows.md` § 9, `C5`—`C7`; `docs/relay/tunnel-edge.md` § 6).
 *
 * The rule this component exists to enforce is that a failure names **a cause
 * and a remedy**, and never a status code. The taxonomy that decides which cause
 * is `src/relay/errors.ts` (`ErrorSurface`), and it is deliberately *not* a type
 * imported here: the design system must not depend on the protocol layer, and
 * the mapping from one to the other is a decision with copy attached — so it
 * lives in the feature that makes it (`src/features/auth/refusal.ts`).
 *
 * Two failures this shape is built to prevent, both from the audit flows'
 * own assertions:
 *
 *  - **A machine-side problem must not offer "Sign in again."** The gateway's
 *    `login_required` and `authorization_refused` are fixed on the computer or
 *    in the console; a phone-side re-authentication cannot fix either, and
 *    offering it sends the reader round a loop that terminates nowhere.
 *  - **A terminal problem must not offer a prominent Retry.** A tunnel that no
 *    longer exists will not come back by tapping again.
 */
export type RefusalKind =
	/** The computer is not reachable: the connector is stopped, or the machine is
	 *  asleep. `C7`. */
	| "computer-offline"
	/** The relay is not running on the computer (`503 relay-not-installed`). */
	| "relay-stopped"
	/** The address is no longer a tunnel (`404 unknown tunnel host`). */
	| "tunnel-gone"
	/** The reader must act in the Radient console or on the computer. */
	| "console"
	/** The relay rejected the password. */
	| "password"
	/** The Radient session expired (`401` + `X-Radient-Login`). `C5`. */
	| "sign-in"
	/** Transient and self-clearing: the gateway is deferring authorization, so
	 *  the honest thing is to wait and retry rather than to send anyone away. */
	| "retry"
	/** An app-side request/response error. User-initiated Retry and redacted
	 * details also apply to invalid routes and relay contract failures; this is
	 * deliberately shared, never an automatic retry loop. */
	| "diagnostic"
	/** The phone is signed into a different account than this tunnel's owner. */
	| "account-mismatch"
	/** The tunnel's certificate was rejected. Its own cause, because the fix is
	 *  the certificate — not the address, and not the network. */
	| "certificate-rejected"
	/** The host name does not resolve: a typo, or a tunnel that no longer
	 *  publishes that name. */
	| "host-unresolved";

/** One action of a cause the feature layer named exactly. Declared here,
 *  structurally, so the design system still does not import the protocol layer;
 *  `src/features/auth/refusal.ts` builds values of this shape. */
export type RefusalSurfaceAction =
	| { id: "retry" | "refresh-list" | "how-to"; label: string }
	| {
			id: "open-billing" | "add-credit" | "open-console";
			label: string;
			url: string;
	  };

/** Plain-language copy that REPLACES the per-kind headline, next line and
 *  gateway detail, and the kind's default buttons. Present only for causes the
 *  feature layer can name (billing, offline, relay stopped, …). */
export type RefusalSurfaceCopy = {
	cause: string;
	title: string;
	body: string | null;
	actions: RefusalSurfaceAction[];
	help: string | null;
	/** The cause is fixed in the reader's Radient account (billing, the
	 *  console): "Use another address" is hidden under it, because the
	 *  own-relay password route it opens cannot fix any of them (PR #261 U10). */
	accountCause?: boolean;
};

/** The open/closed mark for a disclosure button (PR #261 D3). Up/down rather
 *  than a side-pointing chevron, so it needs no mirroring on an RTL page. */
export const disclosureIcon =
	(expanded: boolean) =>
	({ color, size }: { color: string; size: number }) =>
		expanded ? (
			<ChevronUp color={color} size={size} />
		) : (
			<ChevronDown color={color} size={size} />
		);

const ACTION_ID: Record<RefusalSurfaceAction["id"], string> = {
	retry: CONTROL.refusalActionRetry,
	"refresh-list": CONTROL.refusalRefreshList,
	"how-to": CONTROL.refusalHowTo,
	"open-billing": CONTROL.refusalOpenBilling,
	"add-credit": CONTROL.refusalAddCredit,
	/* The id the sign-in proof and S13 flow already assert for "the console". */
	"open-console": REGION.connectionErrorConsoleLink,
};

export type RefusalSurfaceProps = {
	kind: RefusalKind;
	/** What was being reached, named for the reader ("Your computer", the URL).
	 *  Never a tunnel id. */
	subject: string;
	/** The gateway's or the relay's own sentence, shown verbatim when it has one
	 *  — that copy is written for a phone and is more specific than anything this
	 *  component could invent. */
	detail?: string | null;
	/** The local command that fixes a machine-side cause, when one exists. Shown
	 *  only behind "Using a terminal?": most readers of this surface never open a
	 *  terminal, and a command as the instruction was a dead end for them. */
	remedy?: string | null;
	/** Plain copy and actions for a named cause; replaces the kind's defaults. */
	copy?: RefusalSurfaceCopy | null;
	/** "Refresh list" (tunnel gone). Falls back to `onRetry` on screens with no
	 *  list of their own. */
	onRefreshList?: () => void;
	/** Opens a link action. Defaults to the in-app browser, as the console
	 *  handlers on Computers and Settings already do. */
	onOpenUrl?: (url: string) => void;
	/** A server-supplied backoff, in ms, when the failure said to wait. */
	retryAfterMs?: number | null;
	onRetry?: () => void;
	onSignIn?: () => void;
	onUseAnotherAddress?: () => void;
	/** Opens the Radient console in the system browser. Only meaningful for
	 *  `console` and `tunnel-gone`. */
	onOpenConsole?: () => void;
	testID?: string;
};

/** The headline. It names the cause in the reader's terms, never the transport's.
 *
 *  Each entry renders a catalogue message at CALL time, never at module load, so
 *  a locale change re-renders the right language. `{subject}` stays a parameter
 *  of the message rather than a concatenation, because word order around the
 *  computer's name differs by language ("{subject} is not answering." opens with
 *  the name in English and ends with it elsewhere). These arrow bodies are
 *  invisible to the string scanner, so `refusal-surface.test.ts` asserts every
 *  key they return exists in the English catalogue (M3 S2b-2a). */
const HEADLINE: Record<RefusalKind, (subject: string) => string> = {
	"computer-offline": (subject) =>
		t("mobile.computers.refusal.offline_title", { subject }),
	"relay-stopped": (subject) =>
		t("mobile.computers.refusal.relay_stopped_title", { subject }),
	"tunnel-gone": (subject) =>
		t("mobile.computers.refusal.tunnel_gone_title", { subject }),
	console: (subject) =>
		t("mobile.computers.refusal.console_title", { subject }),
	password: () => t("mobile.computers.refusal.password_title"),
	"sign-in": (subject) =>
		t("mobile.computers.refusal.sign_in_title", { subject }),
	retry: (subject) => t("mobile.computers.refusal.retry_title", { subject }),
	diagnostic: () => t("mobile.computers.session_error"),
	"account-mismatch": () => t("mobile.computers.account_mismatch"),
	"certificate-rejected": () => t("mobile.computers.refusal.certificate_title"),
	"host-unresolved": () => t("mobile.computers.refusal.host_title"),
};

/** The second line: what to do. One idea, on whose machine.
 *
 *  The two imperatives that used to interpolate `subject` now name the machine as
 *  "that computer", because the subject of these surfaces is a bare ADDRESS: with
 *  it in both lines the address was printed three times in four lines and "Wake
 *  http://…" read as apparatus rather than as advice (design round 4, D23). The
 *  headline above names what failed; the remedy chip below names the command.
 *
 *  No entry takes the subject any more, so the map does not ask for one. The type
 *  used to promise `(subject: string) => string` while all ten entries ignored it,
 *  which read as a dependency the copy might use and could not (review round 6,
 *  N-B); a parameter nothing reads is a promise a reader has to disprove. */
const NEXT: Record<RefusalKind, () => string> = {
	"computer-offline": () => t("mobile.computers.refusal.offline_next"),
	/* The command lives ONLY in the chip below. Naming it here too made the same
	 *  instruction appear twice in two consecutive lines — "On that computer, run
	 *  `lop mobile`…" above "On that computer: lop mobile" — which the design round
	 *  ruled an echo rather than emphasis (D27). The line keeps the ADVICE and the
	 *  chip keeps the WHERE and the WHAT, which is how `computer-offline` is
	 *  already shaped. */
	"relay-stopped": () => t("mobile.computers.refusal.relay_stopped_next"),
	"tunnel-gone": () => t("mobile.computers.refusal.tunnel_gone_next"),
	console: () => t("mobile.computers.refusal.console_next"),
	password: () => t("mobile.computers.refusal.password_next"),
	/* R1-5: a 401 revokes the authorization generation, so unfinished work is
	 *  quarantined — not sent, not adopted again by signing back in. The sentence
	 *  has to say that, because "we kept your draft" would be a promise the storage
	 *  scoping cannot keep. */
	"sign-in": () => t("mobile.computers.refusal.sign_in_next"),
	/* No promise of an automatic retry: nothing on the paths that raise this
	 *  surface (a cold-start restore that could not reach Radient, a mint's network
	 *  failure) schedules one, and a driven wait saw ONE request in 30 s (PR #121
	 *  design round 1, D2/D3). The button below is the retry. */
	retry: () => t("mobile.computers.refusal.retry_next"),
	diagnostic: () => t("mobile.computers.session_error_help"),
	"account-mismatch": () => t("mobile.computers.account_help"),
	/* `https://` is a protocol token, not prose: it is passed in as `{scheme}` so
	 *  no translation can localise or reorder it (same rule as `verdict_tls`). */
	"certificate-rejected": () =>
		t("mobile.computers.refusal.certificate_next", { scheme: "https://" }),
	"host-unresolved": () => t("mobile.computers.refusal.host_next"),
};

/** The identifier each cause carries, so a flow asserts a CAUSE by name rather
 *  than inferring it from prose that the next copy pass may rewrite. */
const CAUSE_ID: Partial<Record<RefusalKind, string>> = {
	"computer-offline": REGION.connectionErrorComputerOffline,
	"relay-stopped": REGION.connectionErrorRelayNotInstalled,
	"tunnel-gone": REGION.connectionErrorTunnelUnavailable,
	"sign-in": REGION.connectionErrorSignIn,
	retry: REGION.connectionErrorWaiting,
	"certificate-rejected": REGION.connectionErrorCertificate,
	"host-unresolved": REGION.connectionErrorHostUnresolved,
};

/** The mark beside the headline. */
const ALERT_GLYPH_SIZE = 20;

/**
 * How far the mark's top sits below the headline's, so it lands on the FIRST line
 * however many lines the sentence takes.
 *
 * The row used `items-center`, which centres the glyph on the headline BLOCK: with
 * a four-line headline at 320 pt / 200 % the mark's centre sat 81.81 pt below the
 * sentence's first line, level with the third of four — beside the middle of the
 * URL rather than beside "The relay is not running" (design round 5, D28). At
 * 100 % the block is one line and the same rule happened to be right, which is
 * why nothing caught it until the headline learned to wrap (D22).
 *
 * The offset is DERIVED from the type token and the glyph's own size rather than
 * tuned by eye, and it therefore follows the reader's text size: the line box is
 * what grows, not the glyph, so the correction is 1.475 dp at 100 % and 12.95 dp
 * at 200 %. (Centring on the first line means half the line box, less half the
 * glyph.) */
const alertGlyphOffset = (scale: number): number =>
	Math.max(
		0,
		(TYPE_STEPS.heading.size * TYPE_STEPS.heading.lineHeight * scale -
			ALERT_GLYPH_SIZE) /
			2,
	);

export const RefusalSurface = ({
	kind,
	subject,
	detail,
	remedy,
	retryAfterMs,
	onRetry,
	onSignIn,
	onUseAnotherAddress,
	onOpenConsole,
	copy,
	onRefreshList,
	onOpenUrl = (url) => void WebBrowser.openBrowserAsync(url),
	testID = SURFACE.refusalSurface,
}: RefusalSurfaceProps) => {
	const [showDetails, setShowDetails] = useState(false);
	const [showTerminal, setShowTerminal] = useState(false);
	const [showHowTo, setShowHowTo] = useState(false);
	const runAction = (item: RefusalSurfaceAction) => {
		switch (item.id) {
			case "retry":
				onRetry?.();
				return;
			case "refresh-list":
				(onRefreshList ?? onRetry)?.();
				return;
			case "how-to":
				setShowHowTo(true);
				return;
			default:
				onOpenUrl(item.url);
		}
	};
	const danger = useTokenColor("danger");
	/* The console-side help (`mobile.computers.billing_help`, `disabled_help`,
	 *  `harness_help`) starts with "Radient" in Urdu, so RN-web's `dir="auto"`
	 *  laid an Urdu sentence out left-to-right on a right-to-left page (#243 QA
	 *  Q-02). The page's direction, stated, is the fix S1 applied elsewhere. */
	const composedDir = useComposedDir();
	const waitSeconds = retryAfterMs ? Math.round(retryAfterMs / 1000) : null;
	const { effectiveScale } = useTextScale();

	return (
		<View
			className="gap-3 py-6"
			testID={testID}
			/* Announced when it appears, as the kit's `Banner` is: a failed switch
			 *  closes the sheet onto this surface while focus returns to the control
			 *  that opened it, so without a live region a screen-reader user heard the
			 *  button and not the reason (PR #122 UX round 2, U14). Polite, because the
			 *  reader's own tap caused it; the headline keeps its `header` role. */
			accessibilityRole={ROLE.alert}
			accessibilityLiveRegion={LIVE_REGION.polite}
		>
			<View className="flex-row items-start gap-2">
				<AlertTriangle
					color={danger}
					size={ALERT_GLYPH_SIZE}
					style={{ marginTop: alertGlyphOffset(effectiveScale) }}
				/>
				<Text
					/* `min-w-0` beside `flex-1`, and it is load-bearing rather than tidying: the
					 *  subject of three of these headlines is a bare ADDRESS, and a URL is one
					 *  unbreakable token. A flex item's automatic minimum size is its min-content
					 *  width, so the box could not shrink below the URL: the headline measured
					 *  344.66 pt inside a 288 pt pane and took the DOCUMENT to 369/320 at 200 % on
					 *  a 320 pt phone, clipping the address mid-string (D22 / review r5-m1). With
					 *  the floor removed, react-native-web's own `overflow-wrap: break-word`
					 *  breaks the address inside the box, so the reader keeps every character of
					 *  the one name they have to act on. */
					/* Six English titles OPEN with `{subject}` — a Latin URL or name — so
					 *  a translation keeping that order would give the line an LTR base on
					 *  an RTL page; state the page's base (#257 design D2). Emits nothing in
					 *  an LTR catalogue. No `style` on this element: see `useComposedDir`. */
					{...composedDir}
					className="min-w-0 flex-1 text-heading text-ink"
					accessibilityRole={ROLE.header}
					testID={CAUSE_ID[kind]}
				>
					{copy ? copy.title : HEADLINE[kind](subject)}
				</Text>
			</View>
			{copy ? (
				copy.body ? (
					<Text {...composedDir} className="text-body-sm text-ink-muted">
						{copy.body}
					</Text>
				) : null
			) : (
				/* Same reason as the headline (#257 design D2). */
				<Text {...composedDir} className="text-body-sm text-ink-muted">
					{NEXT[kind]()}
				</Text>
			)}
			{/* The gateway's own sentence sits UNDER the plain one: the reader gets the
			 *  short version first, and the specific one when they want it. It is never
			 *  the only line, because a gateway sentence assumes the relay's vocabulary. */}
			{/* A named cause's copy already says it in the reader's words; the
			 *  gateway's sentence beside it was the "tunnel isn't active" line that
			 *  sent a billing problem to a terminal. */}
			{detail && kind !== "diagnostic" && !copy ? (
				<Text {...composedDir} className="text-body-sm text-ink-dim">
					{detail}
				</Text>
			) : null}
			{/* Only the server's own backoff is worth a line, and it is stated as
			 *  advice, not as a retry this screen schedules — none is scheduled (D2). */}
			{kind === "retry" && waitSeconds ? (
				<View className="flex-row items-center gap-2">
					<Text
						className="text-body-sm text-ink-dim"
						testID={REGION.connectionErrorClearsByItself}
					>
						{/* An ICU plural, not "{n}s": the bare unit suffix read as
						 *  apparatus in English and has no equivalent in most locales. */}
						{t("mobile.computers.refusal.wait_seconds", {
							seconds: waitSeconds,
						})}
					</Text>
				</View>
			) : null}

			{copy ? (
				<View className="gap-2 pt-1">
					{/* The named cause's own actions, first one primary. Each can act on
					 *  the cause from this phone (a link, a retry, a help sheet) — none
					 *  of them is "run this command". Every one passes `labelDir`: ur
					 *  `open_billing` and `open_console` open with the Latin `Radient`, the
					 *  UR-C1 defect #257 fixed on the kind's console button (it emits
					 *  nothing in an LTR catalogue). */}
					{copy.actions.map((item, index) =>
						item.id === "retry" ? (
							<View key={item.id} testID={REGION.connectionErrorRetryProminent}>
								<Button
									testID={ACTION_ID[item.id]}
									label={item.label}
									labelDir={composedDir}
									onPress={() => runAction(item)}
									variant={index === 0 ? "primary" : "outline"}
								/>
							</View>
						) : (
							<Button
								key={item.id}
								testID={ACTION_ID[item.id]}
								label={item.label}
								labelDir={composedDir}
								onPress={() => runAction(item)}
								variant={index === 0 ? "primary" : "outline"}
							/>
						),
					)}
					{onUseAnotherAddress && !copy.accountCause ? (
						<Button
							testID={CONTROL.refusalAnotherAddress}
							label={t("mobile.computers.refusal.another_address")}
							onPress={onUseAnotherAddress}
							variant="quiet"
						/>
					) : null}
				</View>
			) : (
				<View className="gap-2 pt-1">
					{/* Retry is prominent only where retrying can work. `tunnel-gone` and
					 *  `console` deliberately have no primary action: the fix is elsewhere. */}
					{(kind === "computer-offline" ||
						kind === "relay-stopped" ||
						kind === "retry" ||
						kind === "password" ||
						kind === "diagnostic") &&
					onRetry ? (
						<View testID={REGION.connectionErrorRetryProminent}>
							<Button
								testID={CONTROL.refusalSignIn}
								label={
									kind === "diagnostic"
										? t("mobile.computers.retry")
										: kind === "retry"
											? t("mobile.computers.refusal.try_now")
											: t("mobile.computers.refusal.try_again")
								}
								onPress={onRetry}
							/>
						</View>
					) : null}
					{(kind === "sign-in" || kind === "account-mismatch") && onSignIn ? (
						<Button
							label={t("mobile.computers.refusal.sign_in_again")}
							onPress={onSignIn}
							testID={CONTROL.refusalRetry}
						/>
					) : null}
					{(kind === "console" || kind === "tunnel-gone") && onOpenConsole ? (
						<Button
							label={t("mobile.computers.refusal.open_console")}
							/* ur `Radient کنسول کھولیں` opens with the Latin product name, so
							 * `dir="auto"` would lay the label LTR on an RTL page (M3 S2b-2a
							 * ur audit UR-C1); state the page's base, as sign-in does. */
							labelDir={composedDir}
							onPress={onOpenConsole}
							variant="outline"
							testID={REGION.connectionErrorConsoleLink}
						/>
					) : null}
					{kind === "diagnostic" ? (
						<>
							<Button
								label={t(
									showDetails
										? "mobile.computers.hide_details"
										: "mobile.computers.show_details",
								)}
								testID={CONTROL.refusalDetailsToggle}
								variant="quiet"
								expanded={showDetails}
								onPress={() => setShowDetails((open) => !open)}
							/>
							{showDetails ? (
								<Text
									testID={REGION.connectionDetails}
									className="text-center text-caption text-ink-dim"
								>
									{detail ?? DIAGNOSTIC_FALLBACK}
								</Text>
							) : null}
						</>
					) : null}
					{onUseAnotherAddress ? (
						<Button
							testID={CONTROL.refusalAnotherAddress}
							label={t("mobile.computers.refusal.another_address")}
							onPress={onUseAnotherAddress}
							variant="quiet"
						/>
					) : null}
				</View>
			)}
			{/* Commands live ONLY here, closed by default: a reader who does not use
			 *  a terminal never meets one, and a reader who does gets the exact,
			 *  copyable command rather than prose that paraphrases it. */}
			{remedy ? (
				<View className="gap-2">
					<Button
						testID={CONTROL.refusalTerminalToggle}
						label={t("mobile.refusal.terminal.toggle")}
						variant="quiet"
						expanded={showTerminal}
						trailingIcon={disclosureIcon(showTerminal)}
						onPress={() => setShowTerminal((open) => !open)}
					/>
					{showTerminal ? (
						<View testID={REGION.connectionErrorMachineRemedy}>
							<CommandBlock
								id="refusal-remedy"
								label={t("mobile.refusal.terminal.label")}
								command={remedy}
							/>
						</View>
					) : null}
				</View>
			) : null}
			{copy?.help ? (
				<Sheet
					visible={showHowTo}
					onClose={() => setShowHowTo(false)}
					title={t("mobile.refusal.how_to.title")}
					titleLines={2}
					returnFocusTestID={CONTROL.refusalHowTo}
					testID={CONTROL.refusalHowToSheet}
				>
					<Text {...composedDir} className="text-body text-ink">
						{copy.help}
					</Text>
				</Sheet>
			) : null}
		</View>
	);
};
