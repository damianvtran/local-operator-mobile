import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import type { ModelEntry } from "@/contracts";
import type { RunSettingLock } from "@/features/session/composer-controls";
import { t } from "@/i18n";
import { effortRungId, modelOptionId, ROLE, SURFACE, state } from "@/ui/a11y";
import { Sheet } from "@/ui/components";
import { Badge } from "@/ui/components/badge";
import { SectionHeader } from "@/ui/components/section-header";
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
	>
		<View className="min-h-11 flex-row items-center gap-2 px-3">
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
					"min-w-0 flex-1 font-mono text-mono",
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
 * The ONE sheet behind the composer's model-and-effort control (issue #325),
 * shared by the home and the session so the two read as one surface.
 *
 * WHY ONE SHEET. The relay accepts exactly two run parameters besides the
 * folder — the model and the effort (`provider`/`model_id`/`effort` at start,
 * `set_model`/`set_effort` in a session) — and the effort's ladder is the
 * MODEL's, so they are one question answered in two parts. The two chips that
 * opened two sheets were cut to `Claude` on iOS.
 *
 * MODEL FIRST, as in the control's spoken name and the dependency: picking a
 * model changes which rungs the effort section offers. A pick COMMITS and the
 * sheet stays open — the ✓ moves under the thumb that pressed it — so a model
 * and its effort can be set in one visit; the sheet's Close (or the scrim)
 * dismisses it. Each section keeps the old sheet's id (`modelTestID`,
 * `effortTestID`), so a flow that asked for the model sheet finds the list.
 */
export const RunSettingsSheet = ({
	visible,
	onClose,
	headings,
	preface = null,
	model,
	effort,
	modelTestID,
	effortTestID,
}: {
	visible: boolean;
	onClose: () => void;
	/** The two section headings, in the host's own catalogue words. */
	headings: { model: string; effort: string };
	/** A line that applies to both sections (the home's "options are fixed"). */
	preface?: ReactNode;
	model: ReactNode;
	effort: ReactNode;
	modelTestID: string;
	effortTestID: string;
}) => (
	<Sheet
		visible={visible}
		onClose={onClose}
		title={t("mobile.chrome.composer.run_settings_title")}
		/* Two lines, not an ellipsis, at 320 pt and 200 % text (the sidebar
		 *  view sheet's rule, QA round 1 Q2). */
		titleLines={2}
		testID={SURFACE.runSettingsSheet}
	>
		{preface}
		<View testID={modelTestID}>
			{/* On the rows' own 12 pt inset, so a heading and its rows share one
			 *  leading edge. */}
			<View className="px-3">
				<SectionHeader label={headings.model} />
			</View>
			{model}
		</View>
		<View testID={effortTestID}>
			<View className="px-3">
				<SectionHeader label={headings.effort} />
			</View>
			{effort}
		</View>
	</Sheet>
);

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
 * with `set_model` / `set_effort` as the old two sheets did.
 *
 * **The array's order IS the ranking** (`contract.md` §3.9): models render as
 * given, grouped by provider in first-seen order. Discrete rungs from the
 * projection's own ladder, not a slider: a slider would invent values between
 * two rungs no provider accepts.
 */
export const SessionRunSettingsSheet = ({
	visible,
	onClose,
	models,
	selectedModel,
	loading = false,
	modelLock,
	ladder,
	selectedEffort,
	effortLock,
	effortOffered,
	onPickModel,
	onPickEffort,
}: {
	visible: boolean;
	onClose: () => void;
	models: ModelEntry[];
	/** The projection's `model_selector` (`provider/model_id`). */
	selectedModel: string;
	loading?: boolean;
	/** Set when the model cannot change here; the section is then read-only. */
	modelLock: RunSettingLock | null;
	ladder: string[];
	selectedEffort: string;
	effortLock: RunSettingLock | null;
	/** `false` when the model has no effort control at all (an empty ladder on a
	 *  live session): the section says so rather than drawing nothing. */
	effortOffered: boolean;
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
			modelTestID={SURFACE.modelSheet}
			effortTestID={SURFACE.effortSheet}
			model={
				modelLock !== null ? (
					<LockedSetting lock={modelLock} />
				) : (
					<>
						{groups.map((group) => (
							<View key={group.provider}>
								<Text className="px-3 pt-2 pb-1 text-meta text-ink-dim">
									{group.provider}
								</Text>
								{group.models.map((model) => (
									<ModelOptionRow
										key={selectorOf(model)}
										model={model}
										selected={selectorOf(model) === selectedModel}
										onPress={() => onPickModel(model)}
									/>
								))}
							</View>
						))}
						{loading ? (
							<Text className="px-3 py-2 text-body-sm text-ink-dim">
								{t("mobile.home.picker.loading")}
							</Text>
						) : models.length === 0 ? (
							<Text className="px-3 py-2 text-body-sm text-ink-dim">
								{t("mobile.home.picker.model_empty")}
							</Text>
						) : null}
					</>
				)
			}
			effort={
				!effortOffered ? (
					<Text className="px-3 pb-2 text-body-sm text-ink-muted">
						{t("mobile.home.picker.effort_none")}
					</Text>
				) : effortLock !== null ? (
					<LockedSetting lock={effortLock} />
				) : (
					<View accessibilityRole={ROLE.radiogroup} className="py-1">
						{ladder.map((rung) => (
							<EffortRungRow
								key={rung}
								rung={rung}
								label={rung}
								selected={rung === selectedEffort}
								onPress={() => onPickEffort(rung)}
							/>
						))}
					</View>
				)
			}
		/>
	);
};
