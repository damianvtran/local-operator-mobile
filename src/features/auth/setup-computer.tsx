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
 *  3. **Waiting names what was observed, never "setting up…".** The two signals
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

/** The TUI alternative: the same lifecycle in two commands. The amount is the
 *  same placeholder as in `createCommands`, for the same reason. The branch that
 *  once filled in a quoted price was dead (its amount was a constant `null`), and
 *  as a conditional it read to the i18n scanner as copy: the commands are values
 *  the reader types, never translated. */
export function tuiCommands(): string {
	return ["/mobile billing", "/mobile enable <amount>"].join("\n");
}

export type SetupComputerProps = {
	/** What the console says about billing, from discovery: `eligible` and its own
	 *  sentence. `null` before any computer is known. */
	billing: { eligible: boolean | null; message: string | null } | null;
	onWaitForConnector: () => void;
	waiting: boolean;
};

export const SetupComputer = ({
	billing,
	onWaitForConnector,
	waiting,
}: SetupComputerProps) => {
	const [tunnelId, setTunnelId] = useState("");
	const billingInactive = billing?.eligible === false;

	return (
		<View className="gap-4 pt-2">
			<Text className="text-body text-ink">
				{t("mobile.computers.setup.intro")}
			</Text>

			{billingInactive ? (
				<Alert
					severity="warning"
					title={t("mobile.computers.setup.billing_title")}
				>
					{/* The console's own sentence passes through as sent: it is server
					 *  copy this app cannot translate, and the catalogue line is only
					 *  the fallback when the console sent none. */}
					{billing?.message ?? t("mobile.computers.setup.billing_fallback")}
				</Alert>
			) : null}

			{/* (a) Create — recommended, and the one that needs no console. */}
			<Card>
				<View className="gap-3">
					<Text className="text-heading text-ink">
						{t("mobile.computers.setup.create_title")}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.setup.create_help")}
					</Text>
					<CommandBlock
						id="terminal"
						label={t("mobile.computers.setup.terminal_label")}
						command={createCommands()}
					/>
					{/* The amount is a placeholder and the copy says where the real one
					 *  is: this app no longer reads the quoted price (the merged client
					 *  surfaces eligibility, not the amount), and inventing a number is
					 *  the one thing the guide forbids on this step. The placeholder and
					 *  the command are values, never copy: a translator must not
					 *  translate what the reader types (the backticks the English used
					 *  to wear are gone for the same reason — the catalogue carries
					 *  prose, the values carry the code). */}
					<Text className="text-body-sm text-ink-dim">
						{t("mobile.computers.setup.amount_note", {
							amount: "<amount>",
							command: "lop tunnel create",
						})}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.setup.tui_help")}
					</Text>
					<CommandBlock
						id="tui"
						label={t("mobile.computers.setup.tui_label")}
						command={tuiCommands()}
					/>
					<Button
						testID={CONTROL.setupCreateTunnel}
						label={
							waiting
								? t("mobile.computers.setup.watching")
								: t("mobile.computers.setup.ran_it")
						}
						onPress={onWaitForConnector}
						loading={waiting}
					/>
				</View>
			</Card>

			{/* (b) Attach — only right when the tunnel already exists. */}
			<Card>
				<View className="gap-3">
					<Text className="text-heading text-ink">
						{t("mobile.computers.setup.attach_title")}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.setup.attach_help")}
					</Text>
					<Input
						testID={CONTROL.setupTunnelId}
						label={t("mobile.computers.setup.tunnel_id_label")}
						value={tunnelId}
						onChangeText={setTunnelId}
						/* An identifier's SHAPE, not copy: tunnel ids are Latin in
						 *  every locale, so the example stays as the console prints it. */
						placeholder="0123…-lop"
						autoCapitalize="none"
					/>
					<CommandBlock
						id="attach"
						label={t("mobile.computers.setup.attach_label")}
						command={`lop tunnel connect ${tunnelId.trim() || "<tunnel-id>"}`}
					/>
				</View>
			</Card>

			{/* (c) Neither — a machine Radient does not know about. */}
			<Card>
				<View className="gap-3">
					<Text className="text-heading text-ink">
						{t("mobile.computers.setup.address_title")}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.setup.address_help")}
					</Text>
				</View>
			</Card>
		</View>
	);
};

export { useConnectorWait };
