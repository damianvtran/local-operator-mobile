import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { isPrivateHost } from "@/connection";
import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import {
	COMPUTER_COMMANDS,
	TUNNEL_COMMANDS,
	TUNNEL_RULE,
} from "@/features/auth/tunnel-commands";
import { runTunnelTest } from "@/features/auth/tunnel-test";
import type { TunnelTestVerdict } from "@/features/auth/tunnel-verdict";
import { verdictSentence } from "@/features/auth/tunnel-verdict";
import { CONTROL, SCREEN } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import { CommandBlock } from "@/ui/components/command-block";
import { Divider } from "@/ui/components/divider";
import { Input } from "@/ui/components/input";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";

/**
 * Set up your own tunnel — the self-hosted path, with no Radient account anywhere
 * in it.
 *
 * **Why it is a real screen and not a fallback.** A technical reader who already
 * runs their own tunnel can be using this app in two minutes; the only thing that
 * stood in their way was that the app's copy assumed an account. Nothing on this
 * screen needs one, and nothing here mints, bills or discovers: the address and the
 * password are the whole contract (ADR 0002 §4 — the relay's only credential is
 * its cookie).
 *
 * **The four steps are the four things that can be wrong**, which is why they are
 * in this order:
 *
 *  1. the daemon on the computer (nothing answers without it),
 *  2. the tunnel that publishes it (`cloudflared`, `ngrok`, or anything else),
 *  3. the address and password in the app,
 *  4. a REAL request that proves 1–3 end to end before anything is saved.
 *
 * Step 4 is the point of the screen: a saved-but-wrong tunnel is a dead app with a
 * spinner, and the verdict names which of the four steps is the broken one.
 */
export default function OwnTunnel() {
	const router = useRouter();
	const { saveCustomRoute, connectCustom } = useConnection();
	const { savedTunnel: saved } = useConnection();

	const [url, setUrl] = useState(saved?.baseUrl ?? "");
	const [password, setPassword] = useState(saved?.password ?? "");
	const [allowInsecure, setAllowInsecure] = useState(
		saved?.allowInsecure ?? false,
	);
	const [testing, setTesting] = useState(false);
	const [saving, setSaving] = useState(false);
	const [verdict, setVerdict] = useState<TunnelTestVerdict | null>(null);

	const test = useCallback(async () => {
		setTesting(true);
		setVerdict(null);
		const result = await runTunnelTest({ url, password, allowInsecure });
		setVerdict(result.verdict);
		setTesting(false);
	}, [allowInsecure, password, url]);

	const saveAndConnect = useCallback(async () => {
		setSaving(true);
		try {
			await saveCustomRoute({ url, password, allowInsecure });
			await connectCustom({ url, password, allowInsecure });
			router.replace("/");
		} finally {
			setSaving(false);
		}
	}, [allowInsecure, connectCustom, password, router, saveCustomRoute, url]);

	/* The password is optional only where the relay genuinely does not ask for one:
	 * a route that requires it cannot be saved with an empty field, and the disabled
	 * state says which field is missing rather than going grey silently. */
	const canSave = url.trim().length > 0 && verdict?.kind === "ok";

	return (
		<Screen
			title="Your own tunnel"
			testID={SCREEN.ownTunnel}
			headerLeading={
				<Button
					testID={CONTROL.ownTunnelBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<View className="gap-4 pt-2">
				<Text className="text-body text-ink">
					No Radient account is needed for any of this. You publish the relay on
					your own computer through a tunnel you control, and the app talks to
					it through the address you paste below.
				</Text>

				{/* ------------------------------------------------ 1. the computer */}
				<View className="gap-2">
					<SectionHeader label="1. On the computer" />
					<Text className="text-body-sm text-ink-muted">
						The relay binds loopback only, so this is the machine that has to
						run it. Leave it awake while you use the app.
					</Text>
					{COMPUTER_COMMANDS.map((item) => (
						<CommandBlock
							key={item.command}
							label={item.label}
							note={item.note}
							command={item.command}
						/>
					))}
				</View>

				<Divider />

				{/* -------------------------------------------------- 2. the tunnel */}
				<View className="gap-2">
					<SectionHeader label="2. Publish it" />
					<Text className="text-body-sm text-ink-muted">{TUNNEL_RULE}</Text>
					{TUNNEL_COMMANDS.map((item) => (
						<CommandBlock
							key={item.command}
							label={item.label}
							note={item.note}
							command={item.command}
						/>
					))}
				</View>

				<Divider />

				{/* ------------------------------------------------- 3. the address */}
				<View className="gap-3">
					<SectionHeader label="3. In the app" />
					<Input
						label="Public URL"
						value={url}
						onChangeText={setUrl}
						placeholder="https://your-tunnel.example.com"
						autoCapitalize="none"
						testID={CONTROL.customUrlField}
					/>
					<Input
						label="Relay password"
						value={password}
						onChangeText={setPassword}
						placeholder="The password `lop mobile` asked for"
						secureTextEntry
						autoCapitalize="none"
						testID={CONTROL.customPasswordField}
					/>
					<View className="gap-2">
						<Button
							label={
								allowInsecure
									? "Plain http:// is allowed"
									: "Allow a plain http:// address"
							}
							onPress={() => setAllowInsecure((value) => !value)}
							variant={allowInsecure ? "outline" : "quiet"}
							size="sm"
							testID={CONTROL.customInsecureOptIn}
							accessibilityHint="Needed only for an address over http, which sends the password in the clear"
						/>
						<Text className="text-body-sm text-ink-dim">
							{allowInsecure
								? "On: the relay password and everything you send cross this network unencrypted. Only do this on a network you trust."
								: "Over http:// your relay password crosses the network in the clear, so it is off unless you turn it on. Use https:// whenever the address supports it."}
						</Text>
						<View>
							{!allowInsecure && url.trim().startsWith("http://") ? (
								<Alert severity="warning" title="This address is unencrypted">
									Turn the opt-in on to use it, or give an https:// address — a
									tunnel normally prints one.
								</Alert>
							) : null}
							{allowInsecure && url.trim().startsWith("http://") ? (
								<Text className="pt-1 text-body-sm text-warning">
									{isPrivateHost(hostOf(url))
										? "This address is on your own network, so the exposure is limited to it."
										: "This address is not a private one — anything between this phone and it can read the password."}
								</Text>
							) : null}
						</View>
					</View>
				</View>

				{/* ---------------------------------------------------- 4. the test */}
				<View className="gap-3">
					<SectionHeader label="4. Test it" />
					<Text className="text-body-sm text-ink-muted">
						This makes a real request through your tunnel before anything is
						saved.
					</Text>
					<Button
						label={testing ? "Testing…" : "Test the connection"}
						onPress={() => void test()}
						loading={testing}
						disabled={testing || url.trim().length === 0}
						testID={CONTROL.ownTunnelTest}
					/>
					{verdict ? <VerdictBlock verdict={verdict} /> : null}
					<Button
						label={saving ? "Saving…" : "Save and connect"}
						onPress={() => void saveAndConnect()}
						disabled={!canSave || saving}
						/* `custom-connect` rather than a new name: this IS the act the
						 *  wave-1 flow `01-first-run-sign-in.yaml` performs on this screen,
						 *  and a second identifier for one action is a second way to do it. */
						testID={CONTROL.customConnect}
					/>
					{!canSave ? (
						<Text className="text-body-sm text-ink-dim">
							{url.trim().length === 0
								? "Paste your tunnel's address to continue."
								: "Test the connection first — a tunnel that has not answered once is not one to save."}
						</Text>
					) : null}
				</View>

				<Divider />

				{/* ------------------------------------------------------- security */}
				<View className="gap-2">
					<SectionHeader label="Before you expose it" />
					<Text className="text-body-sm text-ink-dim">
						You are putting your own computer on the internet, and the relay
						password is the only thing standing in front of it. Prefer HTTPS,
						use a tunnel that offers its own authentication where yours does,
						and rotate the password with `lop mobile password` if it has been
						shared. Anyone with that password and your URL can drive the
						sessions on that machine.
					</Text>
				</View>
			</View>
		</Screen>
	);
}

/** The host part of a typed address, for the private-host note. Never throws:
 *  the field is being typed into, so a half-written address is normal. */
function hostOf(value: string): string {
	try {
		return new URL(value.includes("://") ? value : `https://${value}`).hostname;
	} catch {
		return "";
	}
}

/** What the test found, in the taxonomy's own sentence. */
const VerdictBlock = ({ verdict }: { verdict: TunnelTestVerdict }) => {
	const remedy = verdict.kind === "offline" ? verdict.remedy : null;
	return (
		<>
			<Alert
				severity={
					verdict.kind === "ok"
						? "success"
						: verdict.kind === "invalid"
							? "warning"
							: "error"
				}
				title={verdict.kind === "ok" ? "Connected" : "Not yet"}
			>
				{verdictSentence(verdict)}
			</Alert>
			{/* The remedy is a separate line because it is a command to run, not part
			 *  of the diagnosis — the same split `refusal-surface.tsx` makes. */}
			{remedy ? (
				<Text className="text-body-sm text-ink-dim">{remedy}</Text>
			) : null}
		</>
	);
};
