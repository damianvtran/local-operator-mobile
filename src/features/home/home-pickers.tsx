import { Folder } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { ModelEntry } from "@/contracts";
import type { HomeFolders, HomeModelRow } from "@/features/home/home-defaults";
import {
	type EffortOffer,
	effortLabel,
	type FolderRow,
	filterModels,
	folderName,
	folderRows,
	MODEL_SEARCH_THRESHOLD,
	typedFolder,
} from "@/features/home/picker-model";
import {
	EffortRungGroup,
	EffortRungRow,
	groupByProvider,
	ModelOptionRow,
	RunSettingsSheet,
} from "@/features/session/components/model-sheet";
import { t } from "@/i18n";
import { CONTROL, homeFolderRowId, ROLE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Sheet } from "@/ui/components/sheet";

/**
 * The home's three pickers — Folder, Model, Effort — each its own sheet with its
 * own title and Close, each reached from its own chip in the composer strip.
 *
 * They replace one "Conversation options" sheet that held a free-text path field,
 * a flat list of every model as full-width buttons (the selected one a solid accent
 * block) and an Apply button. The operator: "The conversation options and model
 * picker visual looks terrible … the mobile relay handles that much better", and
 * "There should probably be a separate dialog to handle directory vs model vs
 * effort selection instead of having one overloaded popup". So each picker answers
 * ONE question and commits on the tap that answers it — there is no Apply step to
 * forget — and every row borrows the session sheets' row language
 * (`ModelOptionRow`, `EffortRungRow`) so a model reads the same wherever it is
 * picked. What each picker offers is decided in `picker-model.ts`, where it is
 * tested; this file only lays it out.
 */

/** The line under a picker's title that says where its value comes from, in the
 *  same words as the chip's spoken label (design spec §6), so the strip and the
 *  picker cannot disagree. */
const SourceLine = ({ chosen }: { chosen: boolean }) => (
	<Text className="px-3 pb-2 text-body-sm text-ink-muted">
		{chosen
			? t("mobile.home.picker.source_chosen")
			: t("mobile.home.picker.source_default")}
	</Text>
);

/** Why every row is inert once the conversation has started. */
const FixedLine = () => (
	<Text className="px-3 pb-2 text-body-sm text-ink-muted">
		{t("mobile.home.options.fixed")}
	</Text>
);

/**
 * The folder sheet's header: the FULL path, whole and selectable (issue #325).
 *
 * The composer's folder control is an icon whose spoken name is the folder's own
 * name, so this is the one place the reader sees where a conversation runs — the
 * old chip cut it to `loc`. The path wraps rather than ellipsizes: the end of a
 * path is what tells two folders apart, and a head-ellipsis is ignored on web
 * (the rows' D6). One accessible element, so a screen reader hears the label
 * and the path together.
 */
const CurrentFolder = ({ path }: { path: string }) => (
	<View
		accessible
		accessibilityLabel={t("mobile.home.picker.folder_current_label", { path })}
		className="gap-1 px-3 pb-3"
		testID={CONTROL.homeFolderCurrent}
	>
		<Text className="text-meta text-ink-dim">
			{t("mobile.home.picker.folder_current")}
		</Text>
		<Text selectable className="font-mono text-mono text-ink">
			{path}
		</Text>
	</View>
);

/** The kit's text line for a list still on its way (spec §5 "loading"). */
const LoadingLine = () => (
	<Text className="px-3 py-2 text-body-sm text-ink-dim">
		{t("mobile.home.picker.loading")}
	</Text>
);

export type FolderPickerProps = {
	visible: boolean;
	onClose: () => void;
	/** The computer's folder answer, `null` while the read is pending or failed. */
	folders: HomeFolders | null;
	/** The folder the next start names. */
	current: string | null;
	/** The folder read failed: its sentence, shown with Retry inside the sheet. */
	failure: string | null;
	onRetry: () => void;
	retrying: boolean;
	editable: boolean;
	onPick: (path: string) => void;
};

/**
 * The folder picker.
 *
 * The computer's own folders are the primary surface — its default first (marked
 * "Default"), then the recent folders it has worked in, then home and its temp
 * folder — every one a folder the start route admits, so no row is a dead tap.
 *
 * THE RELAY HAS NO DIRECTORY LISTING ROUTE (its one folder read is
 * `GET /api/directories`), so there is no browsing into subfolders yet: the app
 * shows only what the computer vouches for rather than guessing at a tree. A path
 * no row names goes through "Other path…", a secondary row that reveals a field
 * checked against the start route's own gate before it can be used — free typing
 * is the escape hatch, never the first thing the reader sees ("just free type … is
 * a big no-no in UX").
 */
export const FolderPicker = ({
	visible,
	onClose,
	folders,
	current,
	failure,
	onRetry,
	retrying,
	editable,
	onPick,
}: FolderPickerProps) => {
	const [typing, setTyping] = useState(false);
	const [typed, setTyped] = useState("");
	const close = () => {
		setTyping(false);
		setTyped("");
		onClose();
	};
	return (
		<Sheet
			visible={visible}
			onClose={close}
			title={t("mobile.home.picker.folder_title")}
			detent="half"
			testID={CONTROL.homeFolderPicker}
		>
			{current !== null ? <CurrentFolder path={current} /> : null}
			{/* READ-ONLY once the conversation has started: the relay takes a folder
			 *  only at start (`StartSessionRequest.cwd`) and has no in-session op to
			 *  change it, so the sheet is the path and why — not a list of rows that
			 *  are all disabled (issue #325). */}
			{!editable ? (
				<Text className="px-3 pb-2 text-body-sm text-ink-muted">
					{t("mobile.home.picker.folder_fixed")}
				</Text>
			) : (
				<FolderChoices
					folders={folders}
					current={current}
					failure={failure}
					onRetry={onRetry}
					retrying={retrying}
					onPick={(path) => {
						onPick(path);
						close();
					}}
					typing={typing}
					onType={() => setTyping(true)}
					typed={typed}
					onTyped={setTyped}
				/>
			)}
		</Sheet>
	);
};

/** The folder sheet's choices, while the folder can still change: the read's
 *  failure or loading line, the computer's folders, and the typed path. */
const FolderChoices = ({
	folders,
	current,
	failure,
	onRetry,
	retrying,
	onPick,
	typing,
	onType,
	typed,
	onTyped,
}: {
	folders: HomeFolders | null;
	current: string | null;
	failure: string | null;
	onRetry: () => void;
	retrying: boolean;
	/** Commits the folder and closes the sheet. */
	onPick: (path: string) => void;
	typing: boolean;
	onType: () => void;
	typed: string;
	onTyped: (text: string) => void;
}) => {
	const glyph = useTokenColor("ink-dim");
	const rows = useMemo(
		() => (folders === null ? [] : folderRows(folders)),
		[folders],
	);
	const check = folders === null ? null : typedFolder(typed, folders);
	/* The reason is shown only once there is something to judge: an empty field
	 *  disables the button for the self-evident reason and says nothing. */
	const reason =
		check === null || check.ok || check.reason === "empty"
			? null
			: check.reason === "outside"
				? t("mobile.home.picker.folder_outside")
				: t("mobile.home.picker.folder_too_long");
	const kindLabel = (row: FolderRow): string | null =>
		row.kind === "default"
			? t("mobile.home.picker.badge_default")
			: row.kind === "home"
				? t("mobile.home.picker.folder_home")
				: row.kind === "tmp"
					? t("mobile.home.picker.folder_tmp")
					: null;
	return (
		<>
			{failure !== null ? (
				<View className="px-3 pb-2">
					<Alert
						severity="warning"
						action={{
							label: t("mobile.computers.retry"),
							onPress: onRetry,
							loading: retrying,
							testID: CONTROL.homeFolderPickerRetry,
						}}
					>
						{failure}
					</Alert>
				</View>
			) : folders === null ? (
				<LoadingLine />
			) : null}
			{rows.map((row, index) => {
				const selected = row.path === current;
				const kind = kindLabel(row);
				const { name, parent, short } = folderName(
					row.path,
					folders?.home ?? null,
				);
				return (
					<Pressable
						key={row.path}
						accessibilityRole={ROLE.button}
						accessibilityLabel={kind !== null ? `${short}, ${kind}` : short}
						accessibilityState={state({ selected })}
						onPress={() => onPick(row.path)}
						testID={homeFolderRowId(index)}
					>
						{/* 48 pt rows: glyph · name · parent · kind badge · ✓ (spec §5).
						 *  The folder's own name leads and stays whole; only the dim
						 *  parent yields (`flex-1` with no basis, so it gives way
						 *  first). A head-ellipsized whole path lost the distinguishing
						 *  end on web, which ignores `ellipsizeMode="head"` (D6). */}
						<View className="min-h-12 flex-row items-center gap-3 px-3">
							<Folder color={glyph} size={20} aria-hidden />
							<View className="min-w-0 flex-1 flex-row items-baseline gap-2">
								<Text
									className="min-w-0 shrink text-body text-ink"
									numberOfLines={1}
								>
									{name}
								</Text>
								{parent !== null ? (
									<Text
										className="min-w-0 flex-1 text-body-sm text-ink-dim"
										numberOfLines={1}
									>
										{parent}
									</Text>
								) : null}
							</View>
							{kind !== null ? <Badge label={kind} align="center" /> : null}
							{selected ? (
								<Text className="shrink-0 text-accent" aria-hidden>
									✓
								</Text>
							) : null}
						</View>
					</Pressable>
				);
			})}
			{folders !== null ? (
				typing ? (
					<View className="gap-2 px-3 pt-2">
						<Input
							label={t("mobile.home.options.folder")}
							value={typed}
							onChangeText={onTyped}
							autoCapitalize="none"
							autoFocus
							invalid={reason !== null}
							maxLength={4096}
							/* Return answers the field the way "Use this path" does, and
							 *  only when that button would: a phone keyboard's Done key
							 *  otherwise left a valid path sitting in an open sheet (U3). */
							returnKeyType="done"
							onSubmitEditing={() => {
								if (check === null || !check.ok) return;
								onPick(check.path);
							}}
							testID={CONTROL.newSessionCwd}
						/>
						{reason !== null ? (
							<Text className="text-body-sm text-ink-muted">{reason}</Text>
						) : null}
						<Button
							label={t("mobile.home.picker.folder_use_path")}
							disabled={check === null || !check.ok}
							onPress={() => {
								if (check === null || !check.ok) return;
								onPick(check.path);
							}}
							testID={CONTROL.homeFolderUsePath}
						/>
					</View>
				) : (
					<View className="px-3 pt-2">
						<Button
							label={t("mobile.home.picker.folder_other")}
							variant="quiet"
							onPress={onType}
							testID={CONTROL.homeFolderOther}
						/>
					</View>
				)
			) : null}
		</>
	);
};

export type ModelChoicesProps = {
	models: readonly ModelEntry[];
	/** From `homeModelRows`: the row set and the one selected row. */
	rows: readonly HomeModelRow[];
	/** The reader picked a model in this conversation (vs the computer's default). */
	chosen: boolean;
	loading: boolean;
	failure: string | null;
	onRetry: () => void;
	retrying: boolean;
	/** `null` is "use the computer's default": the start then names no model. */
	onPick: (model: ModelEntry | null) => void;
};

/**
 * The run-settings sheet's model section: the relay's list, on the phone.
 *
 * Provider groups in first-seen order and the daemon's ranking inside each (never
 * re-sorted); the friendly label; "not connected" rows kept visible and inert,
 * because they answer "why is my model missing"; ✓ on the model that will run; a
 * "Default" badge on the computer's default and "This chat" on a model chosen here
 * — both visible at once when they differ, so the reader can see they overrode a
 * default. A search field appears once the list is long enough to need one
 * (`MODEL_SEARCH_THRESHOLD`), with the relay SPA's token filter.
 */
const ModelChoices = ({
	editable,
	query,
	onQuery,
	models,
	rows,
	chosen,
	loading,
	failure,
	onRetry,
	retrying,
	onPick,
}: ModelChoicesProps & {
	editable: boolean;
	/** The search field's text, owned by the sheet so closing it clears it. */
	query: string;
	onQuery: (query: string) => void;
}) => {
	const searchable = models.length > MODEL_SEARCH_THRESHOLD;
	const matches = useMemo(() => {
		const kept = new Set(filterModels(models, query).map((m) => m.selector));
		return rows.filter(
			(row) => row.kind === "default" || kept.has(row.model.selector),
		);
	}, [models, rows, query]);
	const modelRows = matches.filter(
		(row): row is Extract<HomeModelRow, { kind: "model" }> =>
			row.kind === "model",
	);
	const byModel = new Map(modelRows.map((row) => [row.model.selector, row]));
	const groups = groupByProvider(modelRows.map((row) => row.model));
	const fallbackRow = matches.find((row) => row.kind === "default");
	/* A pick commits and the sheet stays open (`RunSettingsSheet`): the ✓ moves
	 *  and the effort section below follows the new model's ladder. */
	const pick = (model: ModelEntry | null) => onPick(model);
	return (
		<>
			{editable ? <SourceLine chosen={chosen} /> : null}
			{failure !== null ? (
				<View className="px-3 pb-2">
					<Alert
						severity="warning"
						action={{
							label: t("mobile.computers.retry"),
							onPress: onRetry,
							loading: retrying,
							testID: CONTROL.homeModelPickerRetry,
						}}
					>
						{failure}
					</Alert>
				</View>
			) : null}
			{searchable ? (
				<View className="px-3 pb-2">
					<Input
						label={t("mobile.home.picker.model_search")}
						value={query}
						onChangeText={onQuery}
						autoCapitalize="none"
						testID={CONTROL.homeModelSearch}
					/>
				</View>
			) : null}
			{/* No default named (an older daemon, or none resolved): the explicit
			 *  "use this computer's default" row is the way back to sending no model
			 *  (#174, D1). With a named default its own row carries that meaning. */}
			{fallbackRow !== undefined ? (
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={t("mobile.home.options.default_model")}
					accessibilityState={state({
						selected: fallbackRow.selected,
						disabled: !editable,
					})}
					disabled={!editable}
					onPress={() => pick(null)}
					testID={CONTROL.homeDefaultModel}
				>
					<View className="min-h-11 flex-row items-center gap-2 px-3">
						<Text className="min-w-0 flex-1 text-body-sm text-ink">
							{t("mobile.home.options.default_model")}
						</Text>
						{fallbackRow.selected ? (
							<Text className="shrink-0 text-accent" aria-hidden>
								✓
							</Text>
						) : null}
					</View>
				</Pressable>
			) : null}
			{groups.map((group) => (
				<View key={group.provider}>
					<Text className="px-3 pt-2 pb-1 text-meta text-ink-dim">
						{group.provider}
					</Text>
					{group.models.map((model) => {
						const row = byModel.get(model.selector);
						if (row === undefined) return null;
						const badge = row.isDefault
							? t("mobile.home.picker.badge_default")
							: chosen && row.selected
								? t("mobile.home.picker.badge_this_chat")
								: null;
						return (
							<ModelOptionRow
								key={model.selector}
								model={model}
								selected={row.selected}
								badge={badge}
								disabled={!editable}
								/* The default's own row means "use the default", so the start
								 *  keeps naming no model (see `homeModelRows`). */
								onPress={() => pick(row.isDefault ? null : model)}
							/>
						);
					})}
				</View>
			))}
			{loading ? (
				<LoadingLine />
			) : failure === null && models.length === 0 ? (
				<Text className="px-3 py-2 text-body-sm text-ink-dim">
					{t("mobile.home.picker.model_empty")}
				</Text>
			) : searchable && modelRows.length === 0 ? (
				<Text className="px-3 py-2 text-body-sm text-ink-dim">
					{t("mobile.home.picker.model_no_match")}
				</Text>
			) : null}
		</>
	);
};

export type EffortChoicesProps = {
	offer: EffortOffer;
	/** The reader's level, `null` when they chose none. */
	chosen: string | null;
	/** The level the computer applies with nothing chosen, when known. */
	defaultEffort: string | null;
	/** `null` is "use the computer's level": the start then names no effort. */
	onPick: (effort: string | null) => void;
};

/**
 * The run-settings sheet's effort section: the model's own ladder as radio rows — never a slider, which
 * would invent levels between two rungs that no provider accepts.
 *
 * Every state says why it is what it is: a relay too old to accept an effort
 * explains and offers nothing (sending one would be refused or silently dropped);
 * a model without an effort setting says so; a model whose ladder the computer does
 * not know offers the whole vocabulary and says the computer will use the nearest
 * level it supports. The rung the computer applies by default is marked
 * "Default", and tapping it means "use the default" — like the model picker's
 * default row, so the start names no effort and the configured level, not a
 * pinned copy of it, is what runs.
 */
const EffortChoices = ({
	offer,
	chosen,
	defaultEffort,
	editable,
	onPick,
}: EffortChoicesProps & { editable: boolean }) => {
	const selected = chosen ?? defaultEffort;
	return (
		<>
			{offer.kind === "unsupported" ? (
				<Text className="px-3 pb-2 text-body-sm text-ink-muted">
					{t("mobile.home.picker.effort_unsupported")}
				</Text>
			) : offer.kind === "none" ? (
				<Text className="px-3 pb-2 text-body-sm text-ink-muted">
					{t("mobile.home.picker.effort_none")}
				</Text>
			) : (
				<>
					{editable ? <SourceLine chosen={chosen !== null} /> : null}
					{!offer.exact ? (
						<Text className="px-3 pb-2 text-body-sm text-ink-muted">
							{t("mobile.home.picker.effort_unknown")}
						</Text>
					) : null}
					<EffortRungGroup>
						{/* No rung is the computer's KNOWN default for this model
						 *  (`default.effort` describes the default model only), so no
						 *  rung maps a tap back to "send no effort". Without this row a
						 *  picked level could only move to another level — the way back
						 *  was a round trip through the default model (UX U2 / R1, the
						 *  effort twin of the model picker's default row). */}
						{defaultEffort === null ? (
							<EffortRungRow
								rung=""
								label={t("mobile.home.picker.effort_use_default")}
								compact
								selected={chosen === null}
								disabled={!editable}
								onPress={() => onPick(null)}
								testID={CONTROL.homeDefaultEffort}
							/>
						) : null}
						{offer.rungs.map((rung) => {
							const isDefault = rung === defaultEffort;
							return (
								<EffortRungRow
									key={rung}
									rung={rung}
									label={effortLabel(rung)}
									compact
									selected={rung === selected}
									disabled={!editable}
									/* Only the default's badge, which never moves. A
									 *  "This conversation" badge added on a pick made the
									 *  compact group wrap again under the thumb, so a second
									 *  tap at the same point hit another rung (design round
									 *  2 D1, QA Q4). The source line above already says
									 *  "Chosen for this conversation". */
									badge={
										isDefault ? t("mobile.home.picker.badge_default") : null
									}
									onPress={() => onPick(isDefault ? null : rung)}
								/>
							);
						})}
					</EffortRungGroup>
				</>
			)}
		</>
	);
};

/**
 * The home's run-settings sheet: the model and the effort the next start names,
 * in ONE sheet behind the composer's model-and-effort control (issue #325).
 *
 * It replaces the separate model and effort pickers, each behind its own chip,
 * that iOS cut to `Claude` with no ellipsis. Each section keeps its picker's
 * rules (`picker-model.ts`) and its source line; a pick commits on its own tap
 * as before, but the sheet stays open so a model and its effort can be set in
 * one visit. Once the conversation has started every row is inert, and the
 * reason is said ONCE, above both sections.
 */
export const RunSettingsPicker = ({
	visible,
	onClose,
	editable,
	summary,
	model,
	effort,
}: {
	visible: boolean;
	onClose: () => void;
	editable: boolean;
	/** The current model and effort, as the chips name them
	 *  (`runSettingsSummary`), so both are visible when the sheet opens. */
	summary: string | null;
	model: ModelChoicesProps;
	effort: EffortChoicesProps;
}) => {
	const [query, setQuery] = useState("");
	return (
		<RunSettingsSheet
			visible={visible}
			onClose={() => {
				setQuery("");
				onClose();
			}}
			headings={{
				model: t("mobile.home.picker.model_title"),
				effort: t("mobile.home.picker.effort_title"),
			}}
			summary={summary}
			preface={editable ? null : <FixedLine />}
			modelTestID={CONTROL.homeModelPicker}
			effortTestID={CONTROL.homeEffortPicker}
			model={
				<ModelChoices
					{...model}
					editable={editable}
					query={query}
					onQuery={setQuery}
				/>
			}
			effort={<EffortChoices {...effort} editable={editable} />}
		/>
	);
};
