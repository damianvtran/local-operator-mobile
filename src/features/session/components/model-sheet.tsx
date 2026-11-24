import { type ReactNode, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { ModelEntry } from "@/contracts";
import { effortLabel } from "@/features/home/picker-model";
import {
	modelSearchReached,
	type RunSettingLock,
	type RunSettingSection,
} from "@/features/session/composer-controls";
import { t } from "@/i18n";
import {
	CONTROL,
	effortRungId,
	modelOptionId,
	ROLE,
	SURFACE,
	state,
} from "@/ui/a11y";
import { Sheet } from "@/ui/components";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { SectionHeader } from "@/ui/components/section-header";
import { useComposedDir } from "@/ui/direction";
import { CONTROL_DISABLED_INK, cx } from "@/ui/variants";

/**
 * The run-settings sheet: the model list and the effort rungs, together
 * (`docs/ux/flows.md` F-6.7; issue #325).
 *
 * **The array's order IS the ranking** (`contract.md` §3.9): the daemon ranks the
 * catalogue, so this renders it as given and never re-sorts. Grouping by provider
 * is the one transformation applied, and it is stable — providers appear in the
 * order their first model did, and models keep their relative order inside a group.
 *
 * A disconnected model is shown, not hidden, and is not selectable: a model the
 * catalogue knows about but the provider is not signed in for is the answer to
 * "why is my model missing", and hiding it turns a diagnosable state into an
 * absence.
 */
interface ProviderGroup {
	provider: string;
	models: ModelEntry[];
}

/** Stable grouping: first-seen provider order, wire order within a group. */
export const groupByProvider = (models: ModelEntry[]): ProviderGroup[] => {
	const groups: ProviderGroup[] = [];
	const seen = new Map<string, ProviderGroup>();
	for (const model of models) {
		const existing = seen.get(model.provider);
		if (existing) {
			existing.models.push(model);
			continue;
		}
		const group: ProviderGroup = { provider: model.provider, models: [model] };
		seen.set(model.provider, group);
		groups.push(group);
	}
	return groups;
};

/** A model's identity as the projection spells it. */
export const selectorOf = (model: ModelEntry): string =>
	`${model.provider}/${model.model_id}`;

/**
 * One model row, shared by the session's model sheet and the home's model picker
 * so a model reads the same wherever it is chosen: friendly label, the words
 * "not connected" on a row that cannot be picked, ✓ on the effective model, and
 * — home only — a trailing badge naming where the value comes from ("Default" /
 * "This chat", design spec §6).
 */
export const ModelOptionRow = ({
	model,
	selected: isSelected,
	onPress,
	badge = null,
	disabled: lockedOut = false,
}: {
	model: ModelEntry;
	selected: boolean;
	onPress: () => void;
	badge?: string | null;
	/** The whole picker is read-only (a started conversation's options are
	 *  fixed). Separate from `disconnected`: that one changes the label's ink and
	 *  words, this one only the press. */
	disabled?: boolean;
}) => {
	const disconnected = model.connected === false;
	/* ONE predicate for the press gate and the label's ink (the guard in
	 *  `model-sheet.test.ts`): a row that cannot be pressed — not connected, or the
	 *  whole picker read-only — wears the kit's disabled-label ink, and only then. */
	const inert = disconnected || lockedOut;
	const notConnected = t("mobile.home.picker.not_connected");
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={`${model.label ?? model.name}${disconnected ? `, ${notConnected}` : ""}${badge !== null ? `, ${badge}` : ""}`}
			accessibilityState={state({
				selected: isSelected,
				disabled: inert,
			})}
			disabled={inert}
			onPress={onPress}
			testID={modelOptionId(model.model_id)}
		>
			<View className="min-h-11 flex-row items-center gap-2 px-3">
				<Text
					/* A disconnected row is genuinely inactive: `disconnected` is the same
					 *  predicate as the `disabled` on the Pressable above, so SC 1.4.3
					 *  exempts this text and `ink-disabled` would conform. It is still the
					 *  wrong ink: the label NAMES the model, and the kit's disabled-label
					 *  ink is `CONTROL_DISABLED_INK` (`ink-dim`) — the rule Button, Chip and
					 *  the disabled field already follow. `ink-disabled` measured 2.96:1
					 *  light / 1.99:1 dark on the sheet's own `elevated` surface, and
					 *  `ink-dim` measures 6.14 / 5.25 there.
					 *
					 *  The unavailability does not rest on the ink: the row also renders the
					 *  words "not connected" beside it, so nothing is lost by lifting the
					 *  label to a readable role. */
					className={cx(
						"min-w-0 flex-1 text-body-sm",
						inert ? CONTROL_DISABLED_INK : "text-ink",
					)}
					numberOfLines={1}
				>
					{model.label ?? model.name}
				</Text>
				{disconnected ? (
					<Text className="shrink-0 text-meta text-ink-dim">
						{notConnected}
					</Text>
				) : null}
				{/* `center`: the row is `items-center`, and the badge's default
				 *  `self-start` would pin it to the row's top edge (design D1). */}
				{badge !== null ? <Badge label={badge} align="center" /> : null}
				{isSelected ? (
					<Text className="shrink-0 text-accent" aria-hidden>
						✓
					</Text>
				) : null}
			</View>
		</Pressable>
	);
};

/**
 * One effort rung: a radio dot and the rung's name. Shared by the session's effort
 * sheet (which shows the daemon's word, `label === rung`) and the home's effort
 * picker (which shows the translated name and a "Default"/"This chat" badge), so
 * the two read as one control.
 */
export const EffortRungRow = ({
	rung,
	label,
	selected,
	onPress,
	badge = null,
	disabled = false,
	compact = false,
	testID,
}: {
	rung: string;
	label: string;
	selected: boolean;
	onPress: () => void;
	/** Defaults to the rung's own id; the home's "this computer's level" row is
	 *  not a rung and names itself. */
	testID?: string;
	badge?: string | null;
	disabled?: boolean;
	/** Hug the label instead of filling the row, so the rungs wrap side by side
	 *  in `EffortRungGroup` (design round 1, D1). The 44 pt touch floor stays. */
	compact?: boolean;
}) => (
	<Pressable
		accessibilityRole={ROLE.radio}
		accessibilityLabel={badge !== null ? `${label}, ${badge}` : label}
		/* `checked` as well as `selected`: a radio's native state is `checked`.
		 *  react-native-web does not read `accessibilityState` at all, so neither
		 *  reaches the web build — there the rung the reader is on went unannounced
		 *  (UX U9, QA Q3). `aria-checked` is the ARIA state for role=radio; native
		 *  ignores it in favour of the state above, so the two are written together,
		 *  as `segmented.tsx` does. */
		accessibilityState={{ ...state({ selected, disabled }), checked: selected }}
		aria-checked={selected}
		disabled={disabled}
		onPress={onPress}
		testID={testID ?? effortRungId(rung)}
		/* A compact rung is capped at the line and may shrink: RN's default
		 *  `flexShrink: 0` let `Среднее · По умолчанию` run to x=358 in a 303 pt
		 *  group at 320 pt / 200 % and clip its badge, the #325 failure again
		 *  (round 2 F1/Q5). Its label and badge then wrap inside the rung. */
		className={compact ? "max-w-full shrink" : undefined}
	>
		<View
			className={cx(
				"min-h-11 flex-row items-center gap-2 px-3",
				compact ? "flex-wrap" : null,
			)}
		>
			{/* Only the selected rung paints its dot; the others keep the 8 pt slot
			 *  so labels do not shift. An unselected `bg-hairline` dot measured
			 *  1.23:1 dark / 1.44:1 light on `elevated` — under the 3:1 non-text
			 *  floor, and read as an indent rather than a state (design D5, the
			 *  relay's model sheet dropped it for the same reason). The selected
			 *  state does not rest on the dot alone: the row is announced checked. */}
			<View
				className={cx(
					"h-2 w-2 rounded-full",
					selected ? "bg-accent" : "bg-transparent",
				)}
			/>
			<Text
				className={cx(
					compact
						? "shrink font-mono text-mono"
						: "min-w-0 flex-1 font-mono text-mono",
					disabled ? CONTROL_DISABLED_INK : "text-ink",
				)}
			>
				{label}
			</Text>
			{badge !== null ? <Badge label={badge} align="center" /> : null}
		</View>
	</Pressable>
);

/**
 * The effort rungs as ONE compact radio group: each rung hugs its label and the
 * group wraps, so five rungs take two 44 pt lines at 390 pt instead of five
 * full rows, and the group sits near the top of the run-settings sheet (design
 * round 1, D1). Each rung keeps its row's dot, `aria-checked` and badge.
 */
export const EffortRungGroup = ({ children }: { children: ReactNode }) => (
	<View
		accessibilityRole={ROLE.radiogroup}
		className="flex-row flex-wrap py-1"
		testID={SURFACE.effortRungs}
	>
		{children}
	</View>
);

/**
 * The ONE sheet behind the composer's model-and-effort control (issue #325),
 * shared by the home and the session so the two read as one surface.
 *
 * WHY ONE SHEET. The relay accepts exactly two run parameters besides the
 * folder — the model and the effort (`provider`/`model_id`/`effort` at start,
 * `set_model`/`set_effort` in a session) — and the effort's ladder is the
 * MODEL's, so they are one question answered in two parts. The two chips that
 * opened two sheets were cut to `Claude` on iOS.
 *
 * WHAT IS ABOVE THE FOLD (design round 1, D1). The current values ("Opus 5 ·
 * High") lead, then the effort rungs as one compact wrapping group, then the
 * model list, which is a screen or more tall on a real catalogue. Effort first
 * because it is short and frequent; a model picked below visibly changes the
 * rungs above. A refused change shows here, above both sections, while the
 * sheet stays open (round 1 R2/D2).
 *
 * A pick COMMITS and the sheet stays open, so a model and its effort can be
 * set in one visit; the sheet's Close (or the scrim) dismisses it. Each section
 * keeps the old sheet's id (`modelTestID`, `effortTestID`), so a flow that asked
 * for the model sheet finds the list.
 */
export const RunSettingsSheet = ({
	visible,
	onClose,
	headings,
	summary = null,
	error = null,
	preface = null,
	model,
	effort,
	modelSearch = null,
	modelTestID,
	effortTestID,
}: {
	visible: boolean;
	onClose: () => void;
	/** The two section headings, in the host's own catalogue words. */
	headings: { model: string; effort: string };
	/** The current model and effort, as the chips named them (`runSettingsSummary`). */
	summary?: string | null;
	/** A refused change, in the kit's own words. */
	error?: string | null;
	/** A line that applies to both sections (the home's "options are fixed"). */
	preface?: ReactNode;
	model: ReactNode;
	/** `null` draws no effort section at all (`{ kind: "hidden" }`). */
	effort: ReactNode;
	/** A search over the model list (the home's long catalogue). Pinned under
	 *  the title, but only once the reader reaches the models: see below. */
	modelSearch?: ReactNode;
	modelTestID: string;
	effortTestID: string;
}) => {
	/* EFFORT LEADS, AND THE SEARCH STILL SURVIVES THE KEYBOARD (#335, the
	 *  maintainer's ruling of 2026-11-24). A search in the body scrolls away
	 *  under the keyboard (TestFlight 1295, fixed by #343's pinned slot); one
	 *  pinned from the start sits above the rungs. So it is pinned, and appears
	 *  once the body has scrolled to the models (`modelSearchReached`). It then
	 *  stays for the visit — pulling it away on a scroll back up would hide the
	 *  field that holds the reader's query — and the next visit starts clean. */
	const [modelTop, setModelTop] = useState<number | null>(null);
	const [searchShown, setSearchShown] = useState(false);
	useEffect(() => {
		if (!visible) setSearchShown(false);
	}, [visible]);
	const searchable = modelSearch !== null;
	/* The summary leads with the model's Latin name, so on an RTL page its base
	 *  would follow that letter and sit on the left under right-aligned
	 *  headings (design round 4, D2). */
	const composedDir = useComposedDir();
	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={t("mobile.chrome.composer.run_settings_title")}
			/* Two lines, not an ellipsis, at 320 pt and 200 % text (the sidebar
			 *  view sheet's rule, QA round 1 Q2). */
			titleLines={2}
			testID={SURFACE.runSettingsSheet}
			pinned={searchable && searchShown ? modelSearch : undefined}
			onBodyScroll={
				searchable && !searchShown
					? (facts) => {
							if (modelSearchReached({ ...facts, modelTop }))
								setSearchShown(true);
						}
					: undefined
			}
		>
			{summary !== null ? (
				<View className="px-3 pb-2" testID={SURFACE.runSettingsSummary}>
					<Text
						/* No caller style prop may join this element: the spread IS the
						 *  native style (`@/ui/direction`). */
						{...composedDir}
						className="font-mono text-mono text-ink"
					>
						{summary}
					</Text>
				</View>
			) : null}
			{error !== null ? (
				<View className="px-3 pb-2">
					<Alert severity="error">{error}</Alert>
				</View>
			) : null}
			{preface}
			{effort === null ? null : (
				<View testID={effortTestID}>
					{/* On the rows' own 12 pt inset, so a heading and its rows share one
					 *  leading edge. */}
					<View className="px-3">
						<SectionHeader label={headings.effort} />
					</View>
					{effort}
				</View>
			)}
			<View
				testID={modelTestID}
				onLayout={(event) => setModelTop(event.nativeEvent.layout.y)}
			>
				<View className="px-3">
					<SectionHeader label={headings.model} />
				</View>
				{model}
			</View>
		</Sheet>
	);
};

/** The read-only form of a section: the reason, then the value, never a list of
 *  rows that are all disabled. */
const LockedSetting = ({ lock }: { lock: RunSettingLock }) => (
	<View className="gap-1 px-3 pb-2">
		<Text className="text-body-sm text-ink-muted">{lock.reason}</Text>
		{lock.value !== null ? (
			<Text className="text-body text-ink">{lock.value}</Text>
		) : null}
	</View>
);

/**
 * The SESSION's run-settings sheet: the projection's model and ladder, applied
 * with `set_model` / `set_effort`. What each section shows is decided once, in
 * `sessionRunSettings` (pure, tested); this only draws it.
 *
 * **The array's order IS the ranking** (`contract.md` §3.9): models render as
 * given, grouped by provider in first-seen order. Discrete rungs from the
 * projection's own ladder, not a slider: a slider would invent values between
 * two rungs no provider accepts. The ✓ and the dot follow the PROJECTION — the
 * value the relay applied — so a refused tap never moves them.
 */
export const SessionRunSettingsSheet = ({
	visible,
	onClose,
	models,
	selectedModel,
	selectedEffort,
	loading = false,
	failed = false,
	onRetry,
	model,
	effort,
	summary,
	error,
	onPickModel,
	onPickEffort,
}: {
	visible: boolean;
	onClose: () => void;
	models: ModelEntry[];
	/** The projection's `model_selector` (`provider/model_id`). */
	selectedModel: string;
	selectedEffort: string;
	loading?: boolean;
	/** The stored catalogue could not be read (an ended chat, PR #350). */
	failed?: boolean;
	onRetry?: () => void;
	model: RunSettingSection;
	effort: RunSettingSection;
	summary: string | null;
	error: string | null;
	onPickModel: (model: ModelEntry) => void;
	onPickEffort: (effort: string) => void;
}) => {
	const groups = groupByProvider(models);
	return (
		<RunSettingsSheet
			visible={visible}
			onClose={onClose}
			headings={{
				model: t("mobile.session.sheet_title.model"),
				effort: t("mobile.session.sheet_title.effort"),
			}}
			summary={summary}
			error={error}
			modelTestID={SURFACE.modelSheet}
			effortTestID={SURFACE.effortSheet}
			effort={
				effort.kind === "hidden" ? null : effort.kind === "locked" ? (
					<LockedSetting lock={effort.lock} />
				) : effort.kind === "ladder" ? (
					<EffortRungGroup>
						{effort.rungs.map((rung) => (
							<EffortRungRow
								key={rung}
								rung={rung}
								/* The summary's words (`effortLabel`), not the
								 *  daemon's `xhigh` (design round 2, D2). */
								label={effortLabel(rung)}
								compact
								selected={rung === selectedEffort}
								onPress={() => onPickEffort(rung)}
							/>
						))}
					</EffortRungGroup>
				) : (
					<Text className="px-3 pb-2 text-body-sm text-ink-muted">
						{t("mobile.home.picker.effort_none")}
					</Text>
				)
			}
			model={
				model.kind === "locked" ? (
					<LockedSetting lock={model.lock} />
				) : (
					<>
						{groups.map((group) => (
							<View key={group.provider}>
								<Text className="px-3 pt-2 pb-1 text-meta text-ink-dim">
									{group.provider}
								</Text>
								{group.models.map((entry) => (
									<ModelOptionRow
										key={selectorOf(entry)}
										model={entry}
										selected={selectorOf(entry) === selectedModel}
										onPress={() => onPickModel(entry)}
									/>
								))}
							</View>
						))}
						{loading ? (
							<Text className="px-3 py-2 text-body-sm text-ink-dim">
								{t("mobile.home.picker.loading")}
							</Text>
						) : failed ? (
							<View className="px-3 py-2 gap-2">
								<Text className="text-body-sm text-ink-dim">
									{t("mobile.home.models_read_failed")}
								</Text>
								{onRetry ? (
									<Button
										label={t("mobile.computers.retry")}
										variant="outline"
										onPress={onRetry}
										testID={CONTROL.sessionModelsRetry}
									/>
								) : null}
							</View>
						) : models.length === 0 ? (
							<Text className="px-3 py-2 text-body-sm text-ink-dim">
								{t("mobile.home.picker.model_empty")}
							</Text>
						) : null}
					</>
				)
			}
		/>
	);
};
