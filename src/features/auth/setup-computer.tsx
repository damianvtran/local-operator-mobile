import { useState } from "react";
import { Text, View } from "react-native";

import { useConnectorWait } from "@/features/auth/connector-wait";
import { t } from "@/i18n";
import { CONTROL } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import { CommandBlock } from "@/ui/components/command-block";
import { Input } from "@/ui/components/input";
import { disclosureIcon } from "@/ui/components/refusal-surface";
import { Shimmer } from "@/ui/components/shimmer";
import { tunnelRefusalCopy } from "./refusal";

/**
 * Set up a computer — the flow that turns a signed-in account with no tunnel into
 * a working one (docs/ux/flows.md § 2, F-2).
 *
 * This is the highest-leverage screen in the product: before it, a user who
 * signed in with no tunnel hit a dead end. Three things about it are deliberate
 * and each has a failure it prevents:
 *
 *  1. **Three distinct routes, because the commands are not interchangeable.**
 *     `lop tunnel connect` ATTACHES a tunnel that already exists and refuses with
 *     "Supply the tunnel ID shown in the Radient console." when there is none, so
 *     offering it as the first step would produce an error for exactly the user
 *     this screen exists to rescue. Creating, attaching, and "neither"
 *     (an address and password, F-3) are separate cards with separate copy.
 *
 *  2. **The command carries the REAL quoted amount.** `--accept-monthly-price`
 *     takes the number from `GET /v1/tunnels/billing`, and a reader who has not
 *     run the billing step has no other way to know it. A placeholder in a
 *     command the reader is told to run is a command that fails.
 *
 *  3. **No terminal unless asked for.** The reader of this screen is usually a
 *     Radient user who has never opened a terminal: the desktop app's Phone
 *     access block (Settings → Radient account → Phone access; the desktop has
 *     no Settings item of that name yet, PR #261 U5) does the whole lifecycle
 *     and shows the price first. So that instruction leads, and the commands
 *     below sit behind "Using a terminal?", closed by default. The list behind
 *     this screen re-fetches on focus, on return to the app, on a slow poll
 *     while it is in front, and on "Check again" (`setup-poll.ts`), which is
 *     what the second line promises.
 *
 *  4. **Waiting names what was observed, never "setting up…".** The two signals
 *     are the control-plane row (the cloud route is provisioned) and
 *     `/healthz` answering (the machine is up). `status: active` is NOT a
 *     heartbeat, so this screen never promotes it to "connected".
 */

/** The create command. Exported so the composition is testable rather than only
 *  visible in a screenshot.
 *
 * **The amount is a placeholder the reader fills from the console.** The merged
 * client (PR #7) surfaces billing ELIGIBILITY through discovery — `eligible` and
 * the console's own sentence — and not the quoted price; a number this app cannot
 * verify must not be worn as if it had. The step above names where the real amount
 * is shown, and the guide's rule stands: only pass the exact amount the reader
 * accepted. */
export function createCommands(): string {
	const accept = " --accept-monthly-price <amount>";
	return [
		"lop login radient",
		`lop tunnel create${accept}`,
		"lop tunnel install",
	].join("\n");
}

/** The TUI alternative: the same lifecycle in two commands. */
export function tuiCommands(): string {
	const amount = null as string | null;
	return [
		"/mobile billing",
		amount ? `/mobile enable ${amount}` : "/mobile enable <amount>",
	].join("\n");
}

export type SetupComputerProps = {
	/** What the console says about billing, from discovery: `eligible` and its own
	 *  sentence. `null` before any computer is known. */
	billing: {
		active?: boolean | null;
		eligible: boolean | null;
		message: string | null;
	} | null;
	onWaitForConnector: () => void;
	waiting: boolean;
	/** Lists the account again now (PR #261 U2): the reader who just finished on
	 *  the desktop needs a control outside the terminal disclosure. */
	onCheckAgain?: () => void;
	/** A list request is in flight (the poll's or the button's). */
	checking?: boolean;
};

/** The create and attach routes, for a reader who uses a terminal. Its own
 *  component (rather than inline under the disclosure) so the cards keep the
 *  nesting depth they had, and the copy inside them its line breaks: the
 *  strings baseline records each literal's first line, and a reflow would read
 *  as new, un-keyed copy. The tunnel id lives here because only this half
 *  needs it. */
const TerminalRoutes = ({
	onWaitForConnector,
	waiting,
}: Pick<SetupComputerProps, "onWaitForConnector" | "waiting">) => {
	const [tunnelId, setTunnelId] = useState("");
	return (
		<>
			{/* (a) Create — recommended for terminal users; needs no console. */}
			<Card>
				<View className="gap-3">
					<Text className="text-heading text-ink">
						Create one on the computer
					</Text>
					<Text className="text-body-sm text-ink-muted">
						In a terminal on the computer you want to control:
					</Text>
					<CommandBlock
						id="terminal"
						label="Terminal"
						command={createCommands()}
					/>
					{/* The amount is a placeholder and the copy says where the real one
					 *  is: this app no longer reads the quoted price (the merged client
					 *  surfaces eligibility, not the amount), and inventing a number is
					 *  the one thing the guide forbids on this step. */}
					<Text className="text-body-sm text-ink-dim">
						`&lt;amount&gt;` is the price the Radient console shows for this
						account — `lop tunnel create` refuses anything else, and step 1 of
						the tunnel guide links to where it is shown.
					</Text>
					<Text className="text-body-sm text-ink-muted">
						Or in the Local Operator TUI, in two commands:
					</Text>
					<CommandBlock id="tui" label="TUI" command={tuiCommands()} />
					<Button
						testID={CONTROL.setupCreateTunnel}
						label={waiting ? "Watching for it" : "I've run it — connect it"}
						onPress={onWaitForConnector}
						loading={waiting}
					/>
				</View>
			</Card>

			{/* (b) Attach — only right when the tunnel already exists. */}
			<Card>
				<View className="gap-3">
					<Text className="text-heading text-ink">
						Attach one that already exists
					</Text>
					<Text className="text-body-sm text-ink-muted">
						If you created the tunnel in the Radient console, attach it by the
						id the console shows. This command is for a tunnel that already
						exists — it will not create one.
					</Text>
					<Input
						testID={CONTROL.setupTunnelId}
						label="Tunnel id"
						value={tunnelId}
						onChangeText={setTunnelId}
						placeholder="0123…-lop"
						autoCapitalize="none"
					/>
					<CommandBlock
						id="attach"
						label="Attach"
						command={`lop tunnel connect ${tunnelId.trim() || "<tunnel-id>"}`}
					/>
				</View>
			</Card>
		</>
	);
};

export const SetupComputer = ({
	billing,
	onWaitForConnector,
	waiting,
	onCheckAgain,
	checking = false,
}: SetupComputerProps) => {
	const [showTerminal, setShowTerminal] = useState(false);
	/* The 403 split's own words for the account's billing (PR #261 R5): "phone
	 *  access" vocabulary, keyed, and the never-turned-on vs out-of-credit split
	 *  instead of the console's one English sentence. */
	const billingCopy =
		billing?.active === false || billing?.eligible === false
			? tunnelRefusalCopy(
					{
						billing: {
							active: billing.active ?? null,
							eligible: billing.eligible,
							message: billing.message,
						},
						rawStatus: "",
					},
					"",
				)
			: null;

	return (
		<View className="gap-4 pt-2">
			<Text className="text-body text-ink">
				This app drives the sessions on your own computer, so that computer has
				to run a connector and stay awake. Your code stays on it.
			</Text>

			{billingCopy ? (
				<Alert severity="warning" title={billingCopy.title}>
					{billingCopy.body ?? ""}
				</Alert>
			) : null}

			<Card>
				<View className="gap-2">
					<Text className="text-body text-ink">
						{t("mobile.computers.setup.open_settings")}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.setup.list_updates")}
					</Text>
					{onCheckAgain ? (
						<Button
							testID={CONTROL.setupCheckAgain}
							label={t(
								checking
									? "mobile.computers.setup.checking"
									: "mobile.computers.setup.check_again",
							)}
							variant="outline"
							loading={checking}
							onPress={onCheckAgain}
						/>
					) : null}
				</View>
			</Card>

			<Button
				testID={CONTROL.setupTerminalToggle}
				label={t("mobile.refusal.terminal.toggle")}
				variant="quiet"
				expanded={showTerminal}
				trailingIcon={disclosureIcon(showTerminal)}
				onPress={() => setShowTerminal((open) => !open)}
			/>
			{showTerminal ? (
				<TerminalRoutes
					onWaitForConnector={onWaitForConnector}
					waiting={waiting}
				/>
			) : null}

			{/* (c) Neither — a machine Radient does not know about. */}
			<Card>
				<View className="gap-3">
					<Text className="text-heading text-ink">Use an address instead</Text>
					<Text className="text-body-sm text-ink-muted">
						If your relay is reachable at a URL you already know, connect to it
						with the relay's own password. This is the route for a machine that
						is not on Radient at all.
					</Text>
				</View>
			</Card>
		</View>
	);
};

/** The wait panel (W1—W5). It is separate from the three routes above because it
 *  REPLACES them while it runs: offering the commands again while a connector is
 *  coming up is how a reader creates two tunnels. */
export const ConnectorWaitPanel = ({
	hostname,
	status,
	onUse,
}: {
	hostname: string | null;
	status: string | null;
	onUse: (() => void) | null;
}) => {
	if (status === null) {
		return (
			<View className="gap-2 rounded-sm border border-hairline bg-surface p-4">
				<Shimmer active>
					<Text className="text-body text-ink">
						Waiting for Radient to list your computer…
					</Text>
				</Shimmer>
				<Text className="text-body-sm text-ink-dim">
					Nothing has appeared yet. Nothing to do on this screen.
				</Text>
			</View>
		);
	}
	return (
		<View className="gap-2 rounded-sm border border-hairline bg-surface p-4">
			<Text className="text-body text-ink">
				Radient has the tunnel — {status === "active" ? "provisioned" : status}.
			</Text>
			<Text className="text-body-sm text-ink-dim">
				{hostname
					? `Waiting for ${hostname.split("-")[0]}-lop to answer. The cloud route existing is not the same as your computer being up.`
					: "Waiting for your computer to answer."}
			</Text>
			{onUse ? (
				<Button
					label="Use this computer"
					onPress={onUse}
					testID={CONTROL.setupUseThisComputer}
				/>
			) : null}
		</View>
	);
};

export { useConnectorWait };
