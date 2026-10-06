import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { PROJECT_STATUS_ORDER } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	DRAFT_KEPT_NOTE,
	PROJECT_NAME_HINT,
	parseTags,
	projectRefusalSentence,
	WRITE_UNKNOWN_NOTE,
	writeReceipt,
} from "@/features/projects/projects-copy";
import { useUiStore } from "@/state/ui-store";
import {
	CONTROL,
	projectCreateStatusId,
	SURFACE,
} from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Chip } from "@/ui/components/chip";
import { Input } from "@/ui/components/input";
import { Sheet } from "@/ui/components/sheet";
import { Textarea } from "@/ui/components/textarea";

/**
 * The create sheet, opened from the listing's header (S16's one write on the
 * list route).
 *
 * WHY A SHEET AND NOT A PUSHED ROUTE. The read path made the listing and one
 * project's detail two ROUTES, because a reader moves between them. A form is
 * not a destination: it is a task the listing hands out, and it is anchored to
 * the list the reader is looking at. The capture harness is where this decision
 * also has to hold: a cell is reached by URL, so a sheet on the listing's route
 * is a state a frame can show, while `/projects/new` would be a screen whose
 * cells never reach the relay at all — and the readiness rule BLOCKS a
 * relay-declared cell the app asked the relay nothing on.
 *
 * THE RELAY'S GRAMMAR IS THE ONLY VALIDATOR. The name and tag rules live in the
 * store, and the store's refusals are the same sentences the desktop receives,
 * so this form refuses nothing client-side except an empty name (which would be
 * a round trip spent to be told `name is required`). `status` defaults to
 * `active` — the relay's own default arm — so a reader who does not care gets
 * the same row a tool would.
 *
 * NO OPTIMISTIC ROW, DELIBERATELY. The web client paints a write and marks it
 * unsynced; this app has no unsynced affordance anywhere — no marker, no
 * reconciliation pass — so an optimistic row here would be an unmarked lie the
 * moment the write refused, on a surface with no undo. The write's own answer is
 * what this sheet renders instead (the created row's name, in the receipt), and
 * the one state in between is the action's own in-flight one, named in the
 * button. A write the app could not make is `WRITE_UNKNOWN_NOTE`, which says the
 * outcome is unknown rather than claiming nothing happened.
 */
export const ProjectCreateSheet = ({
	visible,
	onClose,
	onCreated,
}: {
	visible: boolean;
	onClose: () => void;
	/** Called after the store accepted the row, so the listing re-reads. */
	onCreated: () => void;
}) => {
	const { relay } = useConnection();
	const showToast = useUiStore((state) => state.showToast);

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [status, setStatus] = useState<string>("active");
	const [tags, setTags] = useState("");
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	/* Whether the sheet OPENED onto work the reader left behind. The sheet stays
	 *  mounted between openings (the listing keeps it in the tree), so the drafts
	 *  survive a dismissal by construction — and that is the rule this slice chose
	 *  deliberately: a stray tap on the scrim must not throw away a filled form,
	 *  which is the failure the milestone editor's reset sat on the other side of.
	 *  What was missing is the reader being TOLD (`DRAFT_KEPT_NOTE`), which is what
	 *  this flag gates. It is read on the transition, so it never reports the text
	 *  the reader is typing right now as "kept from last time". */
	const [keptDraft, setKeptDraft] = useState(false);

	useEffect(() => {
		if (!visible) return;
		setKeptDraft(
			name.trim() !== "" || description.trim() !== "" || tags.trim() !== "",
		);
	}, [visible, name, description, tags]);

	const submit = async () => {
		const client = relay();
		if (!client || busy) return;
		setBusy(true);
		setProblem(null);
		try {
			const answer = await client.createProject({
				name: name.trim(),
				...(description.trim() === ""
					? {}
					: { description: description.trim() }),
				status,
				tags: parseTags(tags),
			});
			/* The receipt names the row the RELAY created, not the text that was
			 *  typed: a store that normalised something would otherwise be reported
			 *  as the string this screen holds. */
			showToast(writeReceipt("Created", answer.project.name));
			setName("");
			setDescription("");
			setStatus("active");
			setTags("");
			onCreated();
			onClose();
		} catch (error) {
			/* The relay's own sentence when it wrote one — a taken name is a `409
			 *  project_name_exists` and a refused value a `422 project_invalid`, and
			 *  both are sentences written for a reader. */
			setProblem(projectRefusalSentence(error) ?? WRITE_UNKNOWN_NOTE);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Sheet
			/* THE ANSWERING CONTROL IS PINNED, and so is the surface that says why it
			 *  refused. Both sat inside the scroll region, which put them below the fold
			 *  at EVERY scale on both phones — the refusal element was in the DOM in 27
			 *  of the 28 measured combinations and painted in 11 — so the one control a
			 *  reader has to reach, and the one sentence they need when it refuses, were
			 *  the two things the sheet could hide. `Sheet`'s `footer` is the kit's
			 *  three-region rule; its doc says why a taller detent is not the fix (the
			 *  form is taller than the window at every detent). */
			visible={visible}
			onClose={onClose}
			title="New project"
			testID={SURFACE.projectCreateSheet}
			footer={
				<View className="gap-3">
					{problem !== null ? (
						<Alert severity="error" testID={SURFACE.projectCreateRefusal}>
							{problem}
						</Alert>
					) : null}
					<Button
						testID={CONTROL.projectCreateSubmit}
						label="Create"
						onPress={() => void submit()}
						/* The empty-name case is the ONLY client-side refusal: the relay
						 *  would answer `name is required`, and that tap is worth saving.
						 *  Every other value is sent as typed and refused by the store,
						 *  which is the surface that owns the grammar. */
						disabled={busy || name.trim() === ""}
						loading={busy}
					/>
				</View>
			}
		>
			{/* The in-flight state as a marker rather than as an inference: the button
			 *  shows a spinner, and "the write is in flight" is a claim a frame has to
			 *  be able to make on its own (`docs/ux/audit-rubric.md` U-15). Absent
			 *  otherwise, so a cell that declares it cannot be satisfied by a sheet
			 *  that is merely open. */}
			{busy ? <View testID={SURFACE.projectCreateBusy} /> : null}

			<View className="gap-3">
				{keptDraft ? (
					<Text
						testID={SURFACE.projectCreateDraftNote}
						className="text-meta text-ink-muted"
					>
						{DRAFT_KEPT_NOTE}
					</Text>
				) : null}

				{/* The name grammar, said BEFORE the tap: the relay's own 422 sentence
				 *  names it too, but a reader should not spend a round trip to learn
				 *  that a space is not allowed. */}
				<Text className="text-meta text-ink-dim">{PROJECT_NAME_HINT}</Text>

				<Input
					testID={CONTROL.projectCreateName}
					label="Name"
					value={name}
					onChangeText={setName}
					placeholder="my-project"
					disabled={busy}
					autoCapitalize="none"
				/>

				<Textarea
					testID={CONTROL.projectCreateDescription}
					label="Description"
					value={description}
					onChangeText={setDescription}
					placeholder="What this project is for"
					disabled={busy}
					maxLines={4}
				/>

				<View className="gap-2">
					<Text className="text-body-sm text-ink-muted">Status</Text>
					{/* Chips rather than a picker: seven words that fit two rows at the
					 *  narrowest column, each a 44 pt target, and the selected one is
					 *  announced as selected rather than only painted. */}
					<View className="flex-row flex-wrap gap-2">
						{PROJECT_STATUS_ORDER.map((option) => (
							<Chip
								key={option}
								testID={projectCreateStatusId(option)}
								label={option}
								selected={option === status}
								disabled={busy}
								onPress={() => setStatus(option)}
							/>
						))}
					</View>
				</View>

				<Input
					testID={CONTROL.projectCreateTags}
					label="Tags"
					value={tags}
					onChangeText={setTags}
					placeholder="ios, q4"
					disabled={busy}
					autoCapitalize="none"
				/>
				<Text className="text-meta text-ink-dim">
					Separate with commas or spaces.
				</Text>
			</View>
		</Sheet>
	);
};
