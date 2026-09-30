import { Pressable, ScrollView, Text, View } from "react-native";

import type { ModelEntry } from "@/contracts";
import { effortRungID, modelOptionID, ROLE, SURFACE, state } from "@/ui/a11y";
import { Sheet } from "@/ui/components";
import { cx } from "@/ui/variants";

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
						{group.models.map((model) => {
							const disconnected = model.connected === false;
							const isSelected = selectorOf(model) === selected;
							return (
								<Pressable
									key={selectorOf(model)}
									accessibilityRole={ROLE.button}
									accessibilityLabel={`${model.name}${disconnected ? ", not connected" : ""}`}
									accessibilityState={state({
										selected: isSelected,
										disabled: disconnected,
									})}
									disabled={disconnected}
									onPress={() => {
										onPick(model);
										onClose();
									}}
									testID={modelOptionID(model.model_id)}
								>
									<View className="min-h-11 flex-row items-center gap-2 px-3">
										<Text
											className={cx(
												"min-w-0 flex-1 text-body-sm",
												disconnected ? "text-ink-disabled" : "text-ink",
											)}
											numberOfLines={1}
										>
											{model.label ?? model.name}
										</Text>
										{disconnected ? (
											<Text className="shrink-0 text-meta text-ink-dim">
												not connected
											</Text>
										) : null}
										{isSelected ? (
											<Text className="shrink-0 text-accent" aria-hidden>
												✓
											</Text>
										) : null}
									</View>
								</Pressable>
							);
						})}
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
				<Pressable
					key={rung}
					accessibilityRole={ROLE.radio}
					accessibilityLabel={rung}
					accessibilityState={state({ selected: rung === selected })}
					onPress={() => {
						onPick(rung);
						onClose();
					}}
					testID={effortRungID(rung)}
				>
					<View className="min-h-11 flex-row items-center gap-2 px-3">
						<View
							className={cx(
								"h-2 w-2 rounded-full",
								rung === selected ? "bg-accent" : "bg-hairline",
							)}
						/>
						<Text className="font-mono text-mono text-ink">{rung}</Text>
					</View>
				</Pressable>
			))}
		</View>
	</Sheet>
);
