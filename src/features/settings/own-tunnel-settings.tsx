import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { runTunnelTest } from "@/features/auth/tunnel-test";
import type { TunnelTestVerdict } from "@/features/auth/tunnel-verdict";
import { verdictSentence } from "@/features/auth/tunnel-verdict";
import { CONTROL } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { SectionHeader } from "@/ui/components/section-header";

/**
 * The saved own-tunnel, under Settings: edit it, test it again, remove it.
 *
 * **Why the test is not optional when the address or the password changed.** The
 * address is the only thing that tells this app which computer it is talking to,
 * and a saved-but-wrong one is not an error state — it is a phone that shows an
 * empty list and no reason. So the editor does what the setup screen does: the
 * change is written only after a real request answered, and the verdict is shown
 * on the spot. Testing an UNCHANGED tunnel is still one tap, because a reader who
 * changed something on the computer needs to know whether the phone can still
 * reach it.
 *
 * Nothing here logs, echoes or transmits the password anywhere but to the relay
 * under test; the field is the only place the value is ever rendered.
 */
export const OwnTunnelSettings = () => {
	const { savedTunnel: saved } = useConnection();
	const {
		saveCustomRoute,
		removeCustomRoute,
		connectCustom,
		tunnelStoragePersistent,
	} = useConnection();

	const [editing, setEditing] = useState(false);
	const [url, setUrl] = useState("");
	const [password, setPassword] = useState("");
	const [allowInsecure, setAllowInsecure] = useState(false);
	const [verdict, setVerdict] = useState<TunnelTestVerdict | null>(null);
	const [busy, setBusy] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [persistent, setPersistent] = useState<boolean | null>(null);

	const beginEdit = useCallback(async () => {
		setUrl(saved?.baseUrl ?? "");
		setPassword(saved?.password ?? "");
		setAllowInsecure(saved?.allowInsecure ?? false);
		setVerdict(null);
		setEditing(true);
		setPersistent(await tunnelStoragePersistent());
	}, [saved, tunnelStoragePersistent]);

	const test = useCallback(async () => {
		setBusy(true);
		setVerdict(null);
		const result = await runTunnelTest({ url, password, allowInsecure });
		setVerdict(result.verdict);
		setBusy(false);
	}, [allowInsecure, password, url]);

	/** One tap, on what is stored rather than on what is typed: the reader's
	 *  question is "can this phone still reach my computer", and that question does
	 *  not require opening a form. */
	const testSaved = useCallback(async () => {
		if (!saved) return;
		setBusy(true);
		setVerdict(null);
		const result = await runTunnelTest({
			url: saved.baseUrl,
			password: saved.password ?? "",
			allowInsecure: saved.allowInsecure,
		});
		setVerdict(result.verdict);
		setBusy(false);
	}, [saved]);

	const save = useCallback(async () => {
		setBusy(true);
		try {
			await saveCustomRoute({ url, password, allowInsecure });
			await connectCustom({ url, password, allowInsecure });
			setEditing(false);
		} finally {
			setBusy(false);
		}
	}, [allowInsecure, connectCustom, password, saveCustomRoute, url]);

	const remove = useCallback(async () => {
		setBusy(true);
		try {
			await removeCustomRoute();
			setEditing(false);
			setVerdict(null);
		} finally {
			setBusy(false);
		}
	}, [removeCustomRoute]);

	return (
		<View className="gap-2 pt-1">
			<SectionHeader label="Your own tunnel" />
			{saved && !editing ? (
				<View className="gap-2">
					<Text className="text-body-sm text-ink" numberOfLines={1}>
						{saved.baseUrl}
					</Text>
					<Text className="text-body-sm text-ink-dim">
						{saved.password === null
							? "The password is not saved, so the app asks for it on each launch."
							: "The address and the password are kept in this phone's secure store."}
					</Text>
					{/* `flex-wrap`: three controls in a row overflow a 320 pt phone at
					 *  200 % text (the `U-06` finding), so this row wraps instead. */}
					{verdict ? (
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
					) : null}
					<View className="flex-row flex-wrap gap-2">
						<Button
							label="Edit"
							onPress={() => void beginEdit()}
							variant="outline"
							size="sm"
							testID={CONTROL.settingsTunnelEdit}
						/>
						<Button
							label={busy ? "Testing…" : "Test again"}
							onPress={() => void testSaved()}
							loading={busy}
							disabled={busy}
							variant="quiet"
							size="sm"
							testID={CONTROL.settingsTunnelTest}
						/>
						<Button
							label="Remove"
							onPress={() => setRemoving(true)}
							variant="quiet"
							size="sm"
							testID={CONTROL.settingsTunnelRemove}
						/>
					</View>
				</View>
			) : null}

			{editing ? (
				<View className="gap-3">
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
						placeholder="The password the relay was started with"
						secureTextEntry
						autoCapitalize="none"
						testID={CONTROL.customPasswordField}
					/>
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
					/>
					{persistent === false ? (
						<Alert severity="info" title="This runtime cannot store it">
							This build has no secure keystore, so the tunnel lasts for this
							run only. On a phone the value is kept in the platform's secure
							store.
						</Alert>
					) : null}
					<Button
						label={busy ? "Testing…" : "Test the connection"}
						onPress={() => void test()}
						loading={busy}
						disabled={busy || url.trim().length === 0}
						testID={CONTROL.ownTunnelTest}
					/>
					{verdict ? (
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
					) : null}
					<View className="flex-row flex-wrap gap-2">
						<Button
							label="Save"
							onPress={() => void save()}
							disabled={verdict?.kind !== "ok" || busy}
							testID={CONTROL.customConnect}
						/>
						<Button
							label="Cancel"
							onPress={() => setEditing(false)}
							variant="quiet"
						/>
					</View>
					{verdict?.kind !== "ok" ? (
						<Text className="text-body-sm text-ink-dim">
							Test the address before saving it: a saved tunnel that has never
							answered leaves the list empty with nothing to explain why.
						</Text>
					) : null}
				</View>
			) : null}

			{!saved && !editing ? (
				<Button
					label="Set up your own tunnel"
					onPress={() => void beginEdit()}
					variant="quiet"
					size="sm"
					testID={CONTROL.ownTunnelPathAction}
				/>
			) : null}

			<Dialog
				visible={removing}
				title="Remove this tunnel?"
				body="This forgets the address and the password on this phone. It does not touch your computer, the tunnel you run, or any account."
				confirmLabel="Remove"
				onConfirm={() => void remove()}
				onCancel={() => setRemoving(false)}
				destructive
			/>
		</View>
	);
};
