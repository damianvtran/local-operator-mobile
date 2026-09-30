import { AlertTriangle } from "lucide-react-native";
import { Text, View } from "react-native";

import { REGION, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";

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
	/** A client bug. It states that it is one and offers no loop. */
	| "diagnostic"
	/** The tunnel's certificate was rejected. Its own cause, because the fix is
	 *  the certificate — not the address, and not the network. */
	| "certificate-rejected"
	/** The host name does not resolve: a typo, or a tunnel that no longer
	 *  publishes that name. */
	| "host-unresolved";

export type RefusalSurfaceProps = {
	kind: RefusalKind;
	/** What was being reached, named for the reader ("Your computer", the URL).
	 *  Never a tunnel id. */
	subject: string;
	/** The gateway's or the relay's own sentence, shown verbatim when it has one
	 *  — that copy is written for a phone and is more specific than anything this
	 *  component could invent. */
	detail?: string | null;
	/** The local command that fixes a machine-side cause, when one exists. */
	remedy?: string | null;
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

/** The headline. It names the cause in the reader's terms, never the transport's. */
const HEADLINE: Record<RefusalKind, (subject: string) => string> = {
	"computer-offline": (subject) => `${subject} is not answering.`,
	"relay-stopped": (subject) => `The relay is not running on ${subject}.`,
	"tunnel-gone": (subject) => `${subject} is no longer a tunnel.`,
	console: (subject) => `${subject} needs attention in Radient.`,
	password: () => "That password was not accepted.",
	"sign-in": (subject) =>
		`Your Radient session expired. Sign in to reconnect to ${subject}.`,
	retry: (subject) => `${subject} is not ready yet.`,
	diagnostic: () => "This request was built incorrectly.",
	"certificate-rejected": () => "That tunnel's certificate was rejected.",
	"host-unresolved": () => "That host name could not be found.",
};

/** The second line: what to do. One idea, on whose machine. */
const NEXT: Record<RefusalKind, (subject: string) => string> = {
	"computer-offline": (subject) =>
		`Wake ${subject}, and check the connector is running. Its last known state is above.`,
	"relay-stopped": (subject) =>
		`On ${subject}, run \`lop mobile\` and leave it running.`,
	"tunnel-gone": () =>
		"Create a tunnel again in Radient, then add this computer.",
	console: () =>
		"Open the Radient console to fix it there. Signing in on this phone will not change it.",
	password: () => "Check the relay password on the computer, then try again.",
	"sign-in": () =>
		"The browser finishes the sign-in, so the app never sees your password.",
	retry: () => "It clears by itself — this will keep trying.",
	diagnostic: () =>
		"Nothing on this screen can fix it; this is a bug in the app.",
	"certificate-rejected": () =>
		"Use the https:// address the tunnel printed, choose a tunnel with a certificate a phone will trust, or replace a self-signed certificate — this app will not skip the check.",
	"host-unresolved": () =>
		"Check the address for a typo, and that the tunnel still publishes that name.",
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
	testID = "connection-refusal",
}: RefusalSurfaceProps) => {
	const danger = useTokenColor("danger");
	const waitSeconds = retryAfterMs ? Math.round(retryAfterMs / 1000) : null;

	return (
		<View className="gap-3 py-6" testID={testID}>
			<View className="flex-row items-center gap-2">
				<AlertTriangle color={danger} size={20} />
				<Text
					className="flex-1 text-heading text-ink"
					accessibilityRole={ROLE.header}
					testID={CAUSE_ID[kind]}
				>
					{HEADLINE[kind](subject)}
				</Text>
			</View>
			<Text className="text-body-sm text-ink-muted">{NEXT[kind](subject)}</Text>
			{/* The gateway's own sentence sits UNDER the plain one: the reader gets the
			 *  short version first, and the specific one when they want it. It is never
			 *  the only line, because a gateway sentence assumes the relay's vocabulary. */}
			{detail ? (
				<Text className="text-body-sm text-ink-dim">{detail}</Text>
			) : null}
			{remedy ? (
				<View
					className="rounded-sm border border-hairline bg-sunken p-3"
					testID={REGION.connectionErrorMachineRemedy}
				>
					<Text className="text-mono-sm text-ink-muted">{remedy}</Text>
				</View>
			) : null}
			{kind === "retry" ? (
				<View className="flex-row items-center gap-2">
					<Text
						className="text-body-sm text-ink-dim"
						testID={REGION.connectionErrorClearsByItself}
					>
						{waitSeconds
							? `Trying again in about ${waitSeconds}s.`
							: "Trying again in a moment."}
					</Text>
				</View>
			) : null}

			<View className="gap-2 pt-1">
				{/* Retry is prominent only where retrying can work. `tunnel-gone` and
				 *  `console` deliberately have no primary action: the fix is elsewhere. */}
				{(kind === "computer-offline" ||
					kind === "relay-stopped" ||
					kind === "retry" ||
					kind === "password") &&
				onRetry ? (
					<View testID={REGION.connectionErrorRetryProminent}>
						<Button
							label={kind === "retry" ? "Try now" : "Try again"}
							onPress={onRetry}
						/>
					</View>
				) : null}
				{kind === "sign-in" && onSignIn ? (
					<Button label="Sign in again" onPress={onSignIn} />
				) : null}
				{(kind === "console" || kind === "tunnel-gone") && onOpenConsole ? (
					<Button
						label="Open the Radient console"
						onPress={onOpenConsole}
						variant="outline"
						testID={REGION.connectionErrorConsoleLink}
					/>
				) : null}
				{onUseAnotherAddress ? (
					<Button
						label="Use another address"
						onPress={onUseAnotherAddress}
						variant="quiet"
					/>
				) : null}
			</View>
		</View>
	);
};
