import { useLocalSearchParams, useRouter } from "expo-router";
import { Pencil } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { LinkedSession, ProjectMilestone, ProjectView } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	deleteProjectBody,
	isVanishRefusal,
	linkedSessionLabel,
	linkedSessionState,
	MILESTONE_SLASH_NOTE,
	milestoneNameUsable,
	milestoneUnremovable,
	projectDisplayName,
	projectRefusalSentence,
	projectStatusTone,
	removeMilestoneBody,
	STALE_BADGE_LABEL,
	showsStaleMark,
	WRITE_UNKNOWN_NOTE,
	writeReceipt,
} from "@/features/projects/projects-copy";
import { ProjectDetailStateMarkers } from "@/features/projects/projects-markers";
import { useUiStore } from "@/state/ui-store";
import {
	CONTROL,
	projectMilestoneEditId,
	projectMilestoneToggleId,
	ROLE,
	SCREEN,
	STATE_MARKER,
	SURFACE,
} from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { IconButton } from "@/ui/components/icon-button";
import { Input } from "@/ui/components/input";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import type { SemanticTone } from "@/ui/variants";

/**
 * One project, pushed from the list (S16 detail) — and the surface the
 * lifecycle's writes live on.
 *
 * Everything a milestone shows is the relay's: its `status` is derived once
 * server-side (`local_operator/projects.py:milestone_status`) and a renderer
 * that recomputed it from the dates would be a second derivation that can
 * disagree with a tool result about which milestone is late. The progress line,
 * `progress_stale` and the linked-session rows are the same — read, never
 * derived. Every write below is answered with the relay's OWN view of the row
 * (`{ok, project}`), so the list re-renders from the server's answer rather than
 * from a patch this screen assembled — and nothing here is painted before that
 * answer arrives (see the class comment on the create sheet for why this app
 * carries no optimistic write: it has no unsynced affordance to mark one with).
 *
 * The two IRREVERSIBLE actions are behind confirms that send nothing on the
 * first tap — deleting the project and removing a milestone — while a
 * completion toggle is not (it is one tap away from being undone, and U-23 asks
 * for confirmation proportionate to the loss). The remove control sits BELOW
 * Save's own row inside the sheet, never beside it: a mis-tap in that row
 * destroyed a milestone in the web client before its design round moved it.
 *
 * Linked sessions arrive composed by `build_project_view`, and the `role` split
 * matters: a `work` row carries liveness facts, a `coordination` row ("filed by")
 * carries none, and the two are labelled so a filing can never be read as a
 * worker.
 */
export default function ProjectDetail() {
	const router = useRouter();
	const { key } = useLocalSearchParams<{ key: string }>();
	const { relay, refusal } = useConnection();
	const showToast = useUiStore((state) => state.showToast);

	const [project, setProject] = useState<ProjectView | null>(null);
	const [links, setLinks] = useState<LinkedSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [refused, setRefused] = useState<string | null>(null);
	const [unreachable, setUnreachable] = useState(false);

	/** A failed WRITE's line: the relay's own sentence, or the unknown-outcome
	 *  note when the request never got an answer. */
	const [problem, setProblem] = useState<string | null>(null);
	/** A write in flight. Every control on this screen is inert while one is, so
	 *  two writes cannot race for the same row. */
	const [busy, setBusy] = useState(false);
	/** The milestone editor, or null when it is closed. `editingName` is null on
	 *  the ADD path and the milestone's name on the edit path. */
	const [editor, setEditor] = useState<{ editingName: string | null } | null>(
		null,
	);
	const [draftName, setDraftName] = useState("");
	const [draftDate, setDraftDate] = useState("");
	/** The two irreversible actions, each its own confirm. */
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);

	const load = useCallback(async () => {
		const client = relay();
		if (!client || key === undefined) return;
		setLoading(true);
		setRefused(null);
		setUnreachable(false);
		try {
			const answer = await client.project(key);
			setProject(answer.project);
			setLinks(answer.links);
		} catch (error) {
			const sentence = projectRefusalSentence(error);
			if (sentence !== null) setRefused(sentence);
			else setUnreachable(true);
		} finally {
			setLoading(false);
		}
	}, [relay, key]);

	useEffect(() => {
		void load();
	}, [load]);

	/**
	 * What every failed write on this screen does.
	 *
	 * A `404 project_not_found` is the row VANISHING under the screen — another
	 * surface (the tool, the desktop app, a second phone) deleted it between the
	 * read and the write — and a refusal sentence standing under a detail view
	 * for a row that no longer exists is a dead end, so the screen says what
	 * happened and returns to the listing, which re-reads on focus. Every other
	 * failure stays in place with the reader's input intact.
	 */
	const writeFailed = useCallback(
		(error: unknown) => {
			if (isVanishRefusal(error)) {
				showToast(
					projectRefusalSentence(error) ?? "That project is no longer there.",
				);
				router.back();
				return;
			}
			setProblem(projectRefusalSentence(error) ?? WRITE_UNKNOWN_NOTE);
		},
		[router, showToast],
	);

	/** One milestone's completion, one tap, with the relay's answer replacing the
	 *  row. The state asked for is the NEGATION of what is on screen, and the
	 *  store's own `completed_at` decides which way that is. */
	const toggleMilestone = async (milestone: ProjectMilestone) => {
		const client = relay();
		if (!client || busy || project === null) return;
		const completing = milestone.completed_at === null;
		setBusy(true);
		setProblem(null);
		try {
			const answer = await client.setProjectMilestone(project.id, {
				name: milestone.name,
				completed: completing,
			});
			setProject(answer.project);
			showToast(
				writeReceipt(completing ? "Completed" : "Reopened", milestone.name),
			);
		} catch (error) {
			writeFailed(error);
		} finally {
			setBusy(false);
		}
	};

	/** Open the editor: on a milestone, or on an empty name to add one. The
	 *  previous failure is cleared, because the sheet is a new attempt. */
	const openEditor = (milestone: ProjectMilestone | null) => {
		setProblem(null);
		setDraftName(milestone?.name ?? "");
		setDraftDate(milestone?.target_date ?? "");
		setEditor({ editingName: milestone?.name ?? null });
	};

	const closeEditor = () => {
		setEditor(null);
		setProblem(null);
	};

	const submitMilestone = async () => {
		const client = relay();
		if (!client || busy || project === null || editor === null) return;
		// The name is the store's key and is fixed on the edit path (milestones
		// are not renamed here): the sheet's field is disabled there, and this
		// reads the same rule so a stray edit cannot send a rename.
		const name = (editor.editingName ?? draftName).trim();
		if (!milestoneNameUsable(name)) return;
		setBusy(true);
		setProblem(null);
		try {
			const answer = await client.setProjectMilestone(project.id, {
				name,
				/* Sent even when empty: on an existing milestone `""` CLEARS the
				 *  date, which is the other half of "set a milestone's target date".
				 *  On a new one an empty date is simply not a date. */
				target_date: draftDate.trim(),
			});
			setProject(answer.project);
			showToast(
				writeReceipt(
					editor.editingName === null ? "Added" : "Updated",
					`milestone ${name}`,
				),
			);
			setEditor(null);
		} catch (error) {
			writeFailed(error);
		} finally {
			setBusy(false);
		}
	};

	const removeMilestone = async () => {
		const client = relay();
		const name = editor?.editingName ?? null;
		if (!client || busy || project === null || name === null) return;
		setBusy(true);
		setProblem(null);
		try {
			const answer = await client.removeProjectMilestone(project.id, name);
			setProject(answer.project);
			showToast(writeReceipt("Removed", `milestone ${name}`));
			setConfirmRemove(false);
			setEditor(null);
		} catch (error) {
			setConfirmRemove(false);
			writeFailed(error);
		} finally {
			setBusy(false);
		}
	};

	const deleteProject = async () => {
		const client = relay();
		if (!client || busy || project === null) return;
		setBusy(true);
		setProblem(null);
		try {
			/* The confirmation the relay reads back is the row's NAME, never its
			 *  title: the route compares `confirm` to `name`, case-insensitively,
			 *  and answers `422 project_confirm_mismatch` for anything else — an id
			 *  included, which its own sentence says. The display name a reader sees
			 *  is the title when there is one, so the two must not be conflated
			 *  here. */
			await client.deleteProject(project.id, project.name);
			showToast(writeReceipt("Deleted", project.name));
			setConfirmDelete(false);
			router.back();
		} catch (error) {
			setConfirmDelete(false);
			writeFailed(error);
		} finally {
			setBusy(false);
		}
	};

	const failed = refused !== null || unreachable;
	const editingName = editor?.editingName ?? null;
	const typedName = (editingName ?? draftName).trim();
	/** The refusal is shown WHILE the name is typed: the submit is inert until
	 *  the slash goes, and a reader should not have to wonder why. */
	const slashWhileAdding = editingName === null && typedName.includes("/");
	/** The other half: a milestone another surface made with a slash in its name
	 *  cannot be addressed by the relay's delete route at all, so the honest
	 *  control is an explanation rather than a button that cannot work. */
	const slashOnExisting =
		editingName !== null && milestoneUnremovable(editingName);

	return (
		<Screen
			title={project === null ? "Project" : projectDisplayName(project)}
			testID={SCREEN.projectDetail}
			headerLeading={
				<Button
					testID={CONTROL.projectDetailBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<ProjectDetailStateMarkers refused={failed} />

			{refusal !== null ? (
				<RefusalSurface
					kind={refusal.kind}
					subject={refusal.subject}
					detail={refusal.detail}
					remedy={refusal.remedy}
					retryAfterMs={refusal.retryAfterMs}
					onRetry={() => void load()}
					onUseAnotherAddress={() => router.push("/custom")}
				/>
			) : loading ? (
				<Skeleton lines={5} testID={SURFACE.projectDetailLoading} />
			) : project === null ? (
				<View className="gap-3">
					<Alert severity="error" testID={SURFACE.projectDetailRefusal}>
						{refused ?? "We couldn't read that project just now."}
					</Alert>
					<Button
						testID={CONTROL.projectDetailRetry}
						label="Try again"
						onPress={() => void load()}
						variant="outline"
						size="sm"
					/>
				</View>
			) : (
				<View className="gap-4">
					{/* A write in flight, as a MARKER rather than an inference: the control
					 *  that is waiting shows its own in-flight state, and "a milestone write
					 *  is running" is a claim a frame has to be able to make on its own
					 *  (audit rubric U-15). ONE site for it — a copy inside the sheet as
					 *  well would be two elements carrying one identifier, which is what a
					 *  selector must never have. */}
					{busy ? <View testID={STATE_MARKER["project-detail"].busy} /> : null}

					<View className="flex-row flex-wrap items-center gap-2">
						<Badge
							label={project.status}
							tone={projectStatusTone(project.status)}
						/>
						{/* The same rule the row uses: a stale verdict is only shown where a
						 *  progress line exists to be stale (`showsStaleMark`). */}
						{showsStaleMark(project) ? (
							<Badge label={STALE_BADGE_LABEL} tone="warning" />
						) : null}
					</View>

					{project.description.trim() !== "" ? (
						<Text className="text-body-sm text-ink-muted">
							{project.description}
						</Text>
					) : null}

					{project.progress.trim() !== "" ? (
						<View className="gap-1">
							<SectionHeader label="progress" />
							<Text className="text-body-sm text-ink">{project.progress}</Text>
						</View>
					) : null}

					{/* A write's failure, when the surface that failed is this screen
					 *  rather than the sheet: the delete's. A failure INSIDE the sheet is
					 *  rendered in the sheet (a Modal covers this one), and the two
					 *  never share an identifier — a frame has to be able to say which
					 *  surface refused. */}
					{problem !== null && editor === null ? (
						<Alert severity="error" testID={SURFACE.projectWriteRefusal}>
							{problem}
						</Alert>
					) : null}

					<View>
						<SectionHeader label="milestones" />
						{project.milestones.length === 0 ? (
							<Text className="py-1 text-body-sm text-ink-dim">
								No milestones.
							</Text>
						) : (
							project.milestones.map((milestone) => (
								<MilestoneRow
									/* The store keys a milestone by its NAME within one project
									 *  (`MilestoneEdit(name=…)` addresses it that way), so the
									 *  name is the row's identity — an index would be a key that
									 *  moves when the list is reordered. */
									key={milestone.name}
									milestone={milestone}
									busy={busy}
									onToggle={() => void toggleMilestone(milestone)}
									onEdit={() => openEditor(milestone)}
								/>
							))
						)}
						<View className="pt-3">
							<Button
								testID={CONTROL.projectAddMilestone}
								label="Add milestone"
								onPress={() => openEditor(null)}
								variant="outline"
								size="sm"
								disabled={busy}
							/>
						</View>
					</View>

					<View testID={SURFACE.projectLinks}>
						<SectionHeader label="linked sessions" />
						{links.length === 0 ? (
							<Text className="py-1 text-body-sm text-ink-dim">
								No sessions linked.
							</Text>
						) : (
							links.map((link) => (
								<View
									key={link.session_id}
									className="gap-1 border-b border-hairline py-3"
								>
									<Text
										className="text-body-sm text-ink"
										numberOfLines={1}
										ellipsizeMode="tail"
									>
										{linkedSessionLabel(link)}
									</Text>
									{linkedSessionState(link) !== null ? (
										<Text className="text-meta text-ink-dim">
											{linkedSessionState(link)}
										</Text>
									) : null}
								</View>
							))
						)}
					</View>

					{/* The irreversible one, at the FOOT of the screen and never in
					 *  Save's own row: the first tap opens the confirm and sends
					 *  nothing at all. */}
					<View className="pt-2">
						<Button
							testID={CONTROL.projectDelete}
							label="Delete project"
							onPress={() => {
								setProblem(null);
								setConfirmDelete(true);
							}}
							variant="danger"
							size="sm"
							disabled={busy}
						/>
					</View>
				</View>
			)}

			<Sheet
				visible={editor !== null}
				onClose={closeEditor}
				title={editingName === null ? "Add milestone" : "Edit milestone"}
				testID={SURFACE.projectMilestoneSheet}
			>
				<View className="gap-3">
					<Input
						testID={CONTROL.projectMilestoneName}
						label="Name"
						value={editor?.editingName ?? draftName}
						onChangeText={setDraftName}
						placeholder="release cut"
						/* The name is the milestone's KEY: it is what the store
						 *  add-or-updates by and what the remove route addresses, so
						 *  this form never renames one (adding a differently-named
						 *  milestone is how a reader gets a second one). */
						disabled={editingName !== null || busy}
						autoCapitalize="none"
					/>

					{slashWhileAdding || slashOnExisting ? (
						/* An EXPLANATION, not a control: the control that cannot work
						 *  is not offered at all. */
						<Text
							testID={SURFACE.projectMilestoneSlashNote}
							className="text-body-sm text-danger"
						>
							{MILESTONE_SLASH_NOTE}
						</Text>
					) : null}

					<Input
						testID={CONTROL.projectMilestoneDate}
						label="Target date"
						value={draftDate}
						onChangeText={setDraftDate}
						placeholder="YYYY-MM-DD"
						disabled={busy}
					/>
					<Text className="text-meta text-ink-dim">
						Empty the box to clear the date.
					</Text>

					{problem !== null && editor !== null ? (
						<Alert severity="error" testID={SURFACE.projectMilestoneRefusal}>
							{problem}
						</Alert>
					) : null}

					<Button
						testID={CONTROL.projectMilestoneSubmit}
						label={editingName === null ? "Add" : "Save"}
						onPress={() => void submitMilestone()}
						/* Inert while the name cannot be sent: an empty one is a round
						 *  trip spent to be told `name is required`, and a slashed one
						 *  could never be removed from here. */
						disabled={busy || !milestoneNameUsable(typedName)}
						loading={busy}
					/>

					{editingName !== null && !slashOnExisting ? (
						<View className="pt-1">
							<Button
								testID={CONTROL.projectMilestoneRemove}
								label="Remove milestone"
								onPress={() => setConfirmRemove(true)}
								variant="danger"
								size="sm"
								disabled={busy}
							/>
						</View>
					) : null}
				</View>
			</Sheet>

			<Dialog
				visible={confirmRemove}
				testID={CONTROL.projectMilestoneRemoveDialog}
				title="Remove milestone"
				body={removeMilestoneBody(editingName ?? "")}
				confirmLabel="Remove"
				destructive
				busy={busy}
				onConfirm={() => void removeMilestone()}
				onCancel={() => setConfirmRemove(false)}
			/>

			<Dialog
				visible={confirmDelete}
				testID={CONTROL.projectDeleteDialog}
				title="Delete project"
				body={deleteProjectBody(
					project === null ? "" : projectDisplayName(project),
				)}
				confirmLabel="Delete"
				destructive
				busy={busy}
				onConfirm={() => void deleteProject()}
				onCancel={() => setConfirmDelete(false)}
			/>
		</Screen>
	);
}

/**
 * One milestone: the completion toggle, the relay's derived status, the date
 * behind it, and the editor's opener.
 *
 * TWO controls, siblings — never one inside the other: a pressable control
 * nested in another resolves its taps ambiguously (the drawing order decides),
 * and the two verbs here are a one-tap toggle and an editor. The badge carries
 * the derived status as a WORD, so the checkbox's own `checked` is never the
 * only channel (`docs/ux/audit-rubric.md` U-03).
 */
const MilestoneRow = ({
	milestone,
	busy,
	onToggle,
	onEdit,
}: {
	milestone: ProjectMilestone;
	busy: boolean;
	onToggle: () => void;
	onEdit: () => void;
}) => {
	const completed = milestone.completed_at !== null;
	return (
		<View className="flex-row items-center gap-1 border-b border-hairline">
			<Pressable
				accessibilityRole={ROLE.checkbox}
				/* `checked` is not in `state()`'s vocabulary (disabled, busy,
				 *  selected, expanded) — the same raw object `pending-card.tsx`
				 *  passes for its own checkbox. */
				accessibilityState={{ checked: completed, disabled: busy }}
				accessibilityLabel={`${milestone.name}, ${milestone.status}`}
				accessibilityHint={
					completed ? "Reopens the milestone" : "Marks the milestone complete"
				}
				disabled={busy}
				onPress={onToggle}
				testID={projectMilestoneToggleId(milestone.name)}
				className="min-w-0 flex-1 flex-row items-center gap-2 py-3"
			>
				<View className="min-w-0 flex-1">
					<Text
						className={
							completed ? "text-body-sm text-ink-dim" : "text-body-sm text-ink"
						}
						numberOfLines={1}
					>
						{milestone.name}
					</Text>
					{milestone.target_date !== null ? (
						<Text className="text-meta text-ink-dim">
							due {milestone.target_date}
						</Text>
					) : null}
				</View>
				<Badge
					label={milestone.status}
					tone={MILESTONE_TONE[milestone.status]}
				/>
			</Pressable>
			<IconButton
				testID={projectMilestoneEditId(milestone.name)}
				accessibilityLabel={`Edit ${milestone.name}`}
				/* A RENDER FUNCTION, not the component: `IconButton` calls its `icon`
				 *  with the colour and size the kit resolved, and a lucide icon is a
				 *  `forwardRef` OBJECT rather than a function — passing the component
				 *  itself crashed the whole screen at render time. */
				icon={({ color, size }) => <Pencil color={color} size={size} />}
				size={16}
				onPress={onEdit}
				disabled={busy}
			/>
		</View>
	);
};

/** The tone per DERIVED milestone status. The relay's three values, closed. */
const MILESTONE_TONE: Record<ProjectMilestone["status"], SemanticTone> = {
	completed: "success",
	overdue: "danger",
	upcoming: "neutral",
};
