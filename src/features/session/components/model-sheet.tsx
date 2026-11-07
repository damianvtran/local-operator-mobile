import { Pressable, ScrollView, Text, View } from "react-native";

import type { ModelEntry } from "@/contracts";
import { t } from "@/i18n";
import { effortRungId, modelOptionId, ROLE, SURFACE, state } from "@/ui/a11y";
import { Sheet } from "@/ui/components";
import { Badge } from "@/ui/components/badge";
import { CONTROL_DISABLED_INK, cx } from "@/ui/variants";

/**
 * The model and effort sheets (`docs/ux/flows.md` F-6.7).
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
export type ModelSheetProps = {
	visible: boolean;
	onClose: () => void;
	models: ModelEntry[];
	/** The projection's `model_selector` (`provider/model_id`). */
	selected: string;
	loading?: boolean;
	onPick: (model: ModelEntry) => void;
};

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

export const ModelSheet = ({
	visible,
	onClose,
	models,
	selected,
	loading = false,
	onPick,
}: ModelSheetProps) => {
	const groups = groupByProvider(models);
	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title="model"
			testID={SURFACE.modelSheet}
		>
			<ScrollView className="max-h-96">
				{groups.map((group) => (
					<View key={group.provider}>
						<Text className="px-3 pt-2 pb-1 text-meta text-ink-dim">
							{group.provider}
						</Text>
						{group.models.map((model) => (
							<ModelOptionRow
								key={selectorOf(model)}
								model={model}
								selected={selectorOf(model) === selected}
								onPress={() => {
									onPick(model);
									onClose();
								}}
							/>
						))}
					</View>
				))}
				{loading ? (
					<Text className="px-3 py-2 text-body-sm text-ink-dim">loading…</Text>
				) : models.length === 0 ? (
					<Text className="px-3 py-2 text-body-sm text-ink-dim">
						no models available
					</Text>
				) : null}
			</ScrollView>
		</Sheet>
	);
};

/**
 * The effort rungs.
 *
 * Discrete rungs from the projection's own ladder, not a slider: the ladder is the
 * daemon's vocabulary and a slider would invent values between two rungs that no
 * provider accepts. An empty ladder means the selected model has no effort control,
 * which the caller must handle rather than opening an empty sheet.
 */
export type EffortSheetProps = {
	visible: boolean;
	onClose: () => void;
	ladder: string[];
	selected: string;
	onPick: (effort: string) => void;
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
		/* `checked` as well as `selected`: a radio's state on web and Android is
		 *  `aria-checked`, and react-native-web emits nothing for `selected` on a
		 *  radio, so the rung the reader is on went unannounced there (UX U9). */
		accessibilityState={{ ...state({ selected, disabled }), checked: selected }}
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

export const EffortSheet = ({
	visible,
	onClose,
	ladder,
	selected,
	onPick,
}: EffortSheetProps) => (
	<Sheet
		visible={visible}
		onClose={onClose}
		title="effort"
		testID={SURFACE.effortSheet}
	>
		<View className="py-1">
			{ladder.map((rung) => (
				<EffortRungRow
					key={rung}
					rung={rung}
					label={rung}
					selected={rung === selected}
					onPress={() => {
						onPick(rung);
						onClose();
					}}
				/>
			))}
		</View>
	</Sheet>
);
