// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { Pressable, ScrollView, Text, View } from "react-native";

import type { TodoProjection } from "@/features/session/projection";
import { CONTROL, ROLE, SURFACE, state, todosRowID } from "@/ui/a11y";
import { cx } from "@/ui/variants";

/**
 * Todos (`docs/design/components.md` § 16).
 *
 * **Closed by default**, because an auto-expanded list pushed the conversation off
 * a phone screen — the panel's job is to be countable at a glance and readable on
 * request, not to compete with the transcript. The caller owns `open` for that
 * reason: the space has to be budgeted at the column level, where it can see the
 * composer, and a component that decided for itself could not be held shut.
 *
 * **Held-shut dimming is applied per part, never to the header.** `opacity`
 * composites the whole subtree, so a blanket dim also dims a failure count that
 * must stay legible in exactly the state that dims it (measured 3.30:1 dimmed
 * against 7.08:1 undimmed). The dim here is therefore on the decorative label and
 * the chevron only; the counts keep full ink.
 */
export type TodosPanelProps = {
	todos: TodoProjection;
	/** Closed by default; the caller owns the open state so it can hold it shut. */
	open: boolean;
	onToggle: () => void;
	/** Held shut while a decision is pending: the body does not render. */
	heldShut: boolean;
	testID: string;
};

export const TodosPanel = ({
	todos,
	open,
	onToggle,
	heldShut,
	testID,
}: TodosPanelProps) => {
	// Nothing to say. An empty header would claim a list the session does not have.
	if (todos.empty) return null;
	const expanded = open && !heldShut;

	return (
		<View className="border-t border-hairline" testID={testID}>
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={`Tasks, ${todos.done} of ${todos.total} done`}
				accessibilityState={state({ expanded, disabled: heldShut })}
				onPress={onToggle}
				testID={CONTROL.todosDisclosure}
			>
				<View className="min-h-11 flex-row items-center gap-2 px-4">
					<Text
						className={cx(
							"text-mono-sm text-ink-dim",
							heldShut && "opacity-60",
						)}
					>
						tasks
					</Text>
					{/* The counts are the header's information, so they are NOT dimmed. */}
					<Text className="text-mono-sm text-ink-muted">
						{todos.done}/{todos.total}
					</Text>
					<View className="flex-1" />
					<Text
						className={cx("text-ink-dim", heldShut && "opacity-60")}
						aria-hidden
					>
						{expanded ? "▾" : "▸"}
					</Text>
				</View>
			</Pressable>
			{expanded ? (
				// Capped and internally scrollable: the panel must never be able to push
				// the composer off screen (the v1 rule in F-6.3).
				<ScrollView className="max-h-64" testID={SURFACE.todosBody}>
					{todos.phases.map((phase) => (
						<View key={phase.name} className="pb-1">
							{/* A phase named exactly `Todos` is the TUI's implicit carrier and
							 * renders headerless, so the two surfaces agree about the same
							 * list. Any other name is a real phase and gets its header. */}
							{phase.headerless ? null : (
								<Text className="px-4 pt-1 pb-0.5 text-meta text-ink-dim">
									{phase.name}
								</Text>
							)}
							{phase.rows.map((row, index) => (
								<View
									key={`${phase.name}-${index}`}
									className="min-h-8 flex-row items-start gap-2 px-4 py-1"
									testID={todosRowID(index)}
								>
									<Text
										className={cx("w-4 text-mono-sm", row.inkClass)}
										aria-hidden
									>
										{row.glyph}
									</Text>
									<View className="min-w-0 flex-1">
										<Text
											className={cx(
												"text-body-sm",
												row.status === "done" || row.status === "dropped"
													? "text-ink-dim"
													: row.status === "blocked"
														? "text-ink-muted"
														: "text-ink",
												row.struck && "line-through",
											)}
										>
											{row.text}
										</Text>
										{/* A blocked item carries the reason it is blocked: without it the
										    `~` glyph is a state with no explanation. */}
										{row.status === "blocked" && row.reason ? (
											<Text className="text-meta text-warning">
												{row.reason}
											</Text>
										) : null}
									</View>
								</View>
							))}
						</View>
					))}
				</ScrollView>
			) : null}
		</View>
	);
};
