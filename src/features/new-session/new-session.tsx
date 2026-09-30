import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import type { Directories, ModelEntry } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, SCREEN } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Chip } from "@/ui/components/chip";
import { Input } from "@/ui/components/input";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { Textarea } from "@/ui/components/textarea";

/**
 * New session (docs/ux/flows.md § 8, F-8).
 *
 * Working directory, model, an optional name and an optional first prompt. The
 * states the flow names are all here, and two of them are the reason this screen
 * is more than a form:
 *
 *  - **A refused start is recoverable and specific.** The relay refuses a `cwd`
 *    outside the owner's home or the resolved temp dir with a `400`, and the
 *    sentence names the folder: "That folder doesn't exist on `<computer>`." The
 *    form is never cleared — a reader who typed a prompt should not lose it to a
 *    wrong path.
 *  - **The model catalogue is rendered in the order the relay ranked it.** The
 *    array order IS the ranking (`endpoints.ts` § `models`), and re-sorting it
 *    client-side would throw away the server's answer.
 *
 * Effort deliberately has no control here. `docs/ux/flows.md` § 8 lists the
 * directory, the model picker, the name and the prompt, and the model/effort
 * sheet belongs to the session view, where there is a turn to apply it to. A
 * control on this screen would be a setting with nothing to affect.
 */
export default function NewSession() {
	const router = useRouter();
	const { relay, busy } = useConnection();
	const showToast = useUiStore((state) => state.showToast);

	const [directories, setDirectories] = useState<Directories | null>(null);
	const [models, setModels] = useState<ModelEntry[]>([]);
	const [loading, setLoading] = useState(true);

	const [cwd, setCwd] = useState("");
	const [model, setModel] = useState<string | null>(null);
	const [prompt, setPrompt] = useState("");
	const [modelPicker, setModelPicker] = useState(false);
	const [starting, setStarting] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		const client = relay();
		if (!client) {
			setLoading(false);
			return;
		}
		let live = true;
		void Promise.all([client.directories(), client.models()])
			.then(([dirs, catalogue]) => {
				if (!live) return;
				setDirectories(dirs);
				setCwd((current) => (current.length > 0 ? current : dirs.home));
				setModels(catalogue.models);
				setModel((current) => current ?? catalogue.models[0]?.selector ?? null);
			})
			.catch(() => {
				if (live)
					setProblem("We couldn't read this computer's folders just now.");
			})
			.finally(() => {
				if (live) setLoading(false);
			});
		return () => {
			live = false;
		};
	}, [relay]);

	const chosen = models.find((entry) => entry.selector === model) ?? null;

	const start = async () => {
		const client = relay();
		if (!client) return;
		if (cwd.trim().length === 0) {
			setProblem("Choose the folder the session should work in.");
			return;
		}
		setProblem(null);
		setStarting(true);
		try {
			/* The start route takes a directory, a provider and a model id — there is
			 * no name and no prompt on the wire (`StartSessionRequest`), and a screen
			 * that offered a name the relay ignores would be promising something it
			 * cannot do. The session is named from what is said in it. */
			const started = await client.startSession({
				cwd: cwd.trim(),
				...(chosen
					? { provider: chosen.provider, model_id: chosen.model_id }
					: {}),
			});
			/* A first message is a SECOND call, and it is deliberately allowed to fail
			 * on its own: the session exists either way, so the reader is taken to it
			 * and told what did not arrive rather than being left on a form they have
			 * already submitted. */
			const first = prompt.trim();
			if (first.length > 0) {
				try {
					await client.command(started.session_id, {
						op: "prompt",
						command_id: randomUUID(),
						text: first,
					});
				} catch {
					showToast(
						"The session started, but your first message was not sent.",
					);
				}
			}
			router.replace(`/session/${started.session_id}`);
		} catch (error) {
			/* The relay's own sentence when it has one (it names the folder or the
			 * reason), and never a status code. The form keeps every field. */
			const detail =
				error instanceof Error && error.message.length > 0
					? error.message
					: `That folder doesn't exist on this computer.`;
			setProblem(detail);
		} finally {
			setStarting(false);
		}
	};

	const lock = starting || busy;

	return (
		<Screen
			title="New session"
			testID={SCREEN.newSession}
			headerLeading={
				<Button
					testID={CONTROL.newSessionBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<View className="gap-4 pt-2">
				{loading ? (
					<View className="gap-3">
						<Skeleton lines={1} />
						<Skeleton lines={1} />
					</View>
				) : null}

				{problem ? (
					<Alert severity="warning" title="Could not start">
						{problem}
					</Alert>
				) : null}

				{!loading ? (
					<>
						<View className="gap-2">
							<Text className="text-body-sm text-ink-muted">Folder</Text>
							<View className="flex-row flex-wrap gap-2">
								{directories ? (
									<Chip
										testID={CONTROL.newSessionHomeChip}
										label="Home"
										selected={cwd === directories.home}
										onPress={() => setCwd(directories.home)}
										disabled={lock}
									/>
								) : null}
								{directories?.recent.map((recent) => (
									<Chip
										testID={CONTROL.newSessionPathChip}
										key={recent}
										label={shortFolder(recent)}
										selected={cwd === recent}
										onPress={() => setCwd(recent)}
										disabled={lock}
									/>
								))}
							</View>
							<Input
								label="Path on the computer"
								value={cwd}
								onChangeText={setCwd}
								autoCapitalize="none"
								placeholder="/Users/you/projects"
								disabled={lock}
								testID={CONTROL.newSessionCwd}
							/>
							<Text className="text-body-sm text-ink-dim">
								The folder must be inside your home directory on that computer.
							</Text>
						</View>

						<View className="gap-2">
							<Text className="text-body-sm text-ink-muted">Model</Text>
							{models.length > 0 ? (
								<Button
									label={
										chosen?.label ??
										chosen?.name ??
										chosen?.selector ??
										"Choose a model"
									}
									onPress={() => setModelPicker(true)}
									variant="outline"
									disabled={lock}
									testID={CONTROL.newSessionModel}
								/>
							) : (
								/* No control at all, rather than a disabled one. A relay that lists no
								 * models is a real state (a fresh install, a provider not yet
								 * configured), and a greyed-out button there failed contrast at
								 * 2.16:1 in dark and 2.76:1 in light — but the contrast was the
								 * symptom. The rubric's U-24 is the cause: a disabled control must
								 * say WHY, and a button that cannot be pressed and does not say so
								 * is a dead end. The sentence states the fact and what happens
								 * instead. */
								<Text
									className="text-body-sm text-ink-muted"
									testID={CONTROL.newSessionModelDefault}
								>
									This computer did not list any models, so the session starts
									with its own default.
								</Text>
							)}
						</View>

						<Text className="text-body-sm text-ink-dim">
							The session takes its name from what you say in it.
						</Text>

						<View className="gap-1">
							<Textarea
								label="First message (optional)"
								value={prompt}
								onChangeText={setPrompt}
								placeholder="What should it do?"
								disabled={lock}
								testID={CONTROL.newSessionPrompt}
							/>
						</View>

						<Button
							label={starting ? "Starting…" : "Start session"}
							onPress={() => void start()}
							loading={starting}
							disabled={lock}
							testID={CONTROL.newSessionStart}
						/>
					</>
				) : null}
			</View>

			<Sheet
				visible={modelPicker}
				onClose={() => setModelPicker(false)}
				title="Model"
				detent="full"
			>
				<View className="gap-2 pb-6">
					{/* Ordered as the relay ranked them, never re-sorted. */}
					{models.map((entry) => (
						<Button
							testID={CONTROL.newSessionCreate}
							key={entry.selector}
							label={entry.label ?? entry.name}
							onPress={() => {
								setModel(entry.selector);
								setModelPicker(false);
							}}
							variant={entry.selector === model ? "outline" : "quiet"}
							size="sm"
						/>
					))}
				</View>
			</Sheet>
		</Screen>
	);
}

/** A chip label for a recent folder: the last segment, which is what identifies
 *  it. The full path is in the field above. */
function shortFolder(path: string): string {
	const parts = path.split("/").filter((part) => part.length > 0);
	return parts[parts.length - 1] ?? path;
}
