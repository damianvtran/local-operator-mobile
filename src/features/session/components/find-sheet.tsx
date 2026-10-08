import { useEffect, useRef } from "react";
import { Pressable, Text, type TextInput, View } from "react-native";

import {
	FIND_EMPTY_COPY,
	FIND_FIELD_LABEL,
	FIND_FIELD_PLACEHOLDER,
	FIND_HINT_COPY,
	FIND_QUERY_MAX,
	FIND_TIER_HINT,
	FIND_TITLE,
	type FindHit,
	findCountLabel,
	findRoleLabel,
	findScopeLines,
	findTruncatedLabel,
	splitRanges,
} from "@/features/session/find";
import { CONTROL, findResultId, ROLE, SURFACE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Input, Sheet } from "@/ui/components";
import { cx } from "@/ui/variants";

/**
 * The find sheet: the browse mode of the in-conversation find (`find.ts`), and
 * the two states a reader lands in it with.
 *
 * The keyboard is up and the field owns it the moment the sheet opens, so the
 * sheet is a full detent with the field first and the results under it — the
 * part of the desktop's overlay that survives a 320 pt column. Every settled
 * answer says exactly what it is: the count line carries the tier split (the
 * soft tier is WHY a near-miss is here at all), the empty state is its own
 * sentence, and the pinned footer states the search's scope — the messages on
 * this device, plus the caveat when the conversation holds older ones the
 * frames do not carry. That footer is the honest half of a windowed search: a
 * miss above it is a miss IN THE LOADED FRAMES, not about the conversation.
 *
 * A row PRESSES to a landing (`onActivate`): the sheet closes, the transcript
 * lands on the message with the wash, and the navigate bar takes over.
 */
export type FindSheetProps = {
	visible: boolean;
	onClose: () => void;
	query: string;
	onQueryChange: (query: string) => void;
	hits: FindHit[];
	/** The answer was cut at `find.ts`'s limit. */
	truncated: boolean;
	/** The landed hit's index, or `-1`: the row wears the selection ground. */
	active: number;
	onActivate: (index: number) => void;
	/** How many messages the search covered. */
	messages: number;
	/** Older messages exist beyond the loaded frames (the history read's proof). */
	older: boolean;
};

export const FindSheet = ({
	visible,
	onClose,
	query,
	onQueryChange,
	hits,
	truncated,
	active,
	onActivate,
	messages,
	older,
}: FindSheetProps) => {
	const fieldRef = useRef<TextInput | null>(null);
	const accent = useTokenColor("accent");

	/* The caret, on a beat. The platform moves focus into a modal itself while
	 * the sheet rises, and a focus set in the same frame as the open is
	 * swallowed by that move — the same class the home's New-chat row fixed by
	 * focusing after its drawer closes. 60 ms is a beat, not a delay: the modal
	 * mounts in one frame, so the caret and the keyboard land before a reader
	 * could have reached the box. */
	useEffect(() => {
		if (!visible) return;
		const timer = setTimeout(() => fieldRef.current?.focus(), 60);
		return () => clearTimeout(timer);
	}, [visible]);

	const trimmed = query.trim();
	const settled = trimmed.length > 0;
	const countLine = settled
		? `${findCountLabel(hits)}${truncated ? ` ${findTruncatedLabel(hits.length)}` : ""}`
		: FIND_HINT_COPY;

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={FIND_TITLE}
			detent="full"
			testID={SURFACE.findSheet}
			footer={
				<Text className="text-meta text-ink-dim" testID={SURFACE.findScope}>
					{findScopeLines({ messages, older }).join(" ")}
				</Text>
			}
		>
			<Input
				label={FIND_FIELD_LABEL}
				value={query}
				onChangeText={onQueryChange}
				placeholder={FIND_FIELD_PLACEHOLDER}
				fieldRef={fieldRef}
				/* The desktop route's own bound (`q` 1..256), enforced where the query
				 *  is typed so both surfaces refuse the same input for the same reason —
				 *  every character is compared against every doc. */
				maxLength={FIND_QUERY_MAX}
				testID={CONTROL.findField}
			/>
			<Text
				className="pb-1 pt-2 text-body-sm text-ink-muted"
				testID={SURFACE.findCount}
			>
				{countLine}
			</Text>
			{settled && hits.length === 0 ? (
				<Text
					className="py-3 text-body text-ink-muted"
					testID={SURFACE.findEmpty}
				>
					{FIND_EMPTY_COPY}
				</Text>
			) : null}
			{hits.map((hit, index) => {
				const selected = index === active;
				return (
					/* The target is `min-h-12` (48 pt) — the stricter platform of the two,
					 * the turn bar's own rule. The reachable width is the whole sheet and
					 * the whole row is the press, so height is the only dimension that
					 * could fail a thumb. */
					<Pressable
						key={hit.id}
						testID={findResultId(hit.id)}
						accessibilityRole={ROLE.button}
						accessibilityLabel={`${findRoleLabel(hit.role)}${
							hit.tier === "soft" ? `, ${FIND_TIER_HINT}` : ""
						}: ${hit.snippet}`}
						accessibilityState={state({ selected })}
						onPress={() => onActivate(index)}
						className={cx(
							"my-1 min-h-12 w-full rounded-sm px-2 py-2",
							selected ? "bg-row-selected" : undefined,
						)}
					>
						<View className="flex-row items-center gap-2 pb-1">
							{/* Selection is never colour alone: the role label moves to the
							 * accent ink on the selected row (the list-row rule), and the
							 * segment says WHY the row is here when soft. */}
							<Text
								className={cx(
									"text-meta",
									selected ? "text-accent" : "text-ink-dim",
								)}
							>
								{findRoleLabel(hit.role)}
							</Text>
							{hit.tier === "soft" ? (
								/* A separator, not just the row's gap (design D63-4): at 100 % the
								 *  two runs read as one phrase ("Agent related match"), so the
								 *  reason the row is here vanishes into the provenance. */
								<Text className="text-meta text-ink-dim">{`· ${FIND_TIER_HINT}`}</Text>
							) : null}
						</View>
						<Text className="text-body-sm text-ink-muted" numberOfLines={1}>
							{/* ONE LINE, the truncation idiom every list row in this app uses, and
							 * the only one the audit's clip rule allows on its own terms: a
							 * multi-line clamp (`-webkit-line-clamp`) clips content without the
							 * `nowrap` half of that idiom, measured as `content 162px in a 122px
							 * box` on this slice's own capture (U-04/U-07 at iphone-se / 200 %,
							 * every row whose snippet wrapped past the clamp). The full snippet
							 * stays reachable: it is the row's accessibility label verbatim, and
							 * the tap lands on the message itself. The matched run is the only
							 * NESTED span (a nested run's box excludes U-08's pair-by-ancestry
							 * where siblings do not), while the plain runs are raw strings that
							 * inherit the muted ground. */}
							{splitRanges(hit.snippet, hit.ranges).map((segment, at) =>
								segment.matched ? (
									<Text
										// biome-ignore lint/suspicious/noArrayIndexKey: fixed, non-reordering segment list
										key={at}
										className="text-ink"
										style={{
											textDecorationLine: "underline",
											textDecorationColor: accent,
										}}
									>
										{segment.text}
									</Text>
								) : (
									segment.text
								),
							)}
						</Text>
					</Pressable>
				);
			})}
		</Sheet>
	);
};
