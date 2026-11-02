/**
 * The Library: the cross-conversation catalogue, as a phone-sized grid.
 *
 * The screen is deliberately a thin surface over two server facts — the listing
 * (one cursor page at a time) and the catalogue's tag vocabulary. Every filter,
 * every sort and the search itself is a REQUEST: `use-library-list.ts` is the
 * only place a page is merged, because a local filter would silently truncate a
 * server-paged list and the "Load more" control would then be lying about how
 * much remains.
 *
 * Three answer states are kept distinct, because collapsing them is the defect
 * this screen exists to avoid:
 *
 *   - **building** — the scan is incremental and resumable; the rows already
 *     known are real, so the banner sits ABOVE them rather than replacing them;
 *   - **empty** — the catalogue holds nothing (a quiet, designed state);
 *   - **no matches** — a filter matched nothing, which has a different remedy
 *     (clear the filters), and its own empty-state id.
 *
 * The footer entry is gated on `capabilities.features.library`; a deep link to a
 * relay without it lands on the honest "not on this computer" state instead of a
 * 404 loop.
 */

import { useFocusEffect, useRouter } from "expo-router";
import {
	Code,
	File,
	FileText,
	Image as ImageIcon,
	Music,
	Presentation,
	RefreshCw,
	Table,
	Video,
} from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
	FlatList,
	Image,
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from "react-native";

import type { LibraryAsset, LibraryTag } from "@/contracts";
import {
	useConnection,
	useListState,
} from "@/features/auth/connection-provider";
import { useLibraryThumbnail } from "@/features/library/library-media";
import {
	categoryForBrowse,
	DEFAULT_BROWSE,
	effectiveName,
	formatBytes,
	hasActiveFilters,
	kindLabel,
	LIBRARY_ORIGINS,
	LIBRARY_SEGMENTS,
	LIBRARY_SORTS,
	LIBRARY_STATUSES,
	type LibraryBrowse,
	type LibraryOriginTab,
	type LibrarySegment,
	type LibrarySortValue,
	type LibraryStatus,
	libraryEnabled,
	MORE_CATEGORIES,
} from "@/features/library/library-model";
import {
	type LibraryUpdate,
	libraryUpdateState,
} from "@/features/library/library-updates";
import { useLibraryList } from "@/features/library/use-library-list";
import { t } from "@/i18n";
import type { RelayEndpoints } from "@/relay";
import {
	CONTROL,
	EMPTY,
	libraryKindOptionId,
	libraryMoreOptionId,
	libraryOriginOptionId,
	librarySortOptionId,
	libraryStatusOptionId,
	libraryTagId,
	libraryTileId,
	REGION,
	ROLE,
	SCREEN,
	SURFACE,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Chip } from "@/ui/components/chip";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Input } from "@/ui/components/input";
import { Screen } from "@/ui/components/screen";
import { Segmented } from "@/ui/components/segmented";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { TOUCH_FLOOR } from "@/ui/layout";

const KIND_ICON: Record<
	string,
	(props: { color: string; size: number }) => React.ReactNode
> = {
	image: (props) => <ImageIcon {...props} />,
	audio: (props) => <Music {...props} />,
	video: (props) => <Video {...props} />,
	presentation: (props) => <Presentation {...props} />,
	spreadsheet: (props) => <Table {...props} />,
	code: (props) => <Code {...props} />,
	document: (props) => <FileText {...props} />,
	other: (props) => <File {...props} />,
};

function KindIcon({ kind, color }: { kind: string; color: string }) {
	const draw = KIND_ICON[kind] ?? KIND_ICON.other;
	return <>{draw?.({ color, size: 28 })}</>;
}

export default function Library() {
	const router = useRouter();
	const { relay } = useConnection();
	const client = relay();
	const capabilities = useListState((state) => state.capabilities);
	const frameCount = useListState((state) => state.frameCount);
	/* A DIRECT LINK arrives before the sessions stream has answered, so the
	 *  capability bag is still empty. "Unknown" must not render as "absent": the
	 *  screen attempts the read and the relay's own 404 is the refusal. Once a
	 *  frame has landed, the flag is the relay's word and the gate applies. */
	const enabled = frameCount === 0 || libraryEnabled(capabilities);

	const [browse, setBrowse] = useState<LibraryBrowse>(DEFAULT_BROWSE);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const [sortOpen, setSortOpen] = useState(false);
	const [moreOpen, setMoreOpen] = useState(false);
	/* The segmented options carry their own identifiers, built from the value so
	 *  the option table stays a plain list and the selector cannot drift. */
	const segments = useMemo(
		() =>
			LIBRARY_SEGMENTS.map((option) => ({
				...option,
				testID: libraryKindOptionId(option.value),
			})),
		[],
	);

	const list = useLibraryList(client, browse, enabled);
	const page = list.page;
	/* A save made on the detail route. The canonical rows live in the hook, so
	 *  the saved rows are reconciled there — a page-2 append keeps A's rename
	 *  instead of layering one update over one page object. Only the global tag
	 *  vocabulary stays page-tied: a later page carries a newer snapshot. */
	const [savedTags, setSavedTags] = useState<{
		tags: LibraryTag[] | null;
		page: typeof page;
	} | null>(null);
	const seenRevision = useRef(libraryUpdateState().revision);
	const pageRef = useRef(page);
	pageRef.current = page;
	const { applySaved } = list;
	useFocusEffect(
		useCallback(() => {
			const state = libraryUpdateState();
			if (state.revision === seenRevision.current) return;
			seenRevision.current = state.revision;
			/* Every saved row, not just the latest: two edits before Back must both
			 *  survive, and an append must not drop either. */
			applySaved(Object.values(state.updates));
			setSavedTags({
				tags: state.vocabulary,
				page: pageRef.current,
			});
		}, [applySaved]),
	);
	const activeTags =
		savedTags !== null && savedTags.page === page ? savedTags.tags : null;
	const rows = list.rows;
	/* The save's fresh vocabulary wins over the page's snapshot until the next
	 *  page lands; `null` means the save did not change tags. */
	const vocabulary = activeTags ?? page?.tags ?? [];
	/* The footer and the end-of-list fetch belong to the rows on screen. While a
	 *  debounced browse is pending, the old page is still painted but its cursor
	 *  is not loadable: pressing it would append the previous query under the new
	 *  field. */
	const pageIsCurrent = list.loadedWith === browse;

	const filterCount = useMemo(
		() =>
			// A segment that is not `all` counts too: it is a filter the reader set,
			// even though it has its own visible control.
			(browse.segment === "all" ? 0 : 1) +
			(browse.origin === "all" ? 0 : 1) +
			(browse.tag === null ? 0 : 1) +
			(browse.status === "any" ? 0 : 1),
		[browse],
	);

	const changeSegment = useCallback((segment: LibrarySegment) => {
		setBrowse((current) => ({
			...current,
			segment,
			// `More` is a door, not a category: the sheet picks the concrete one.
			moreCategory: segment === "more" ? current.moreCategory : null,
		}));
		if (segment === "more") setMoreOpen(true);
	}, []);

	const clear = useCallback(() => setBrowse(DEFAULT_BROWSE), []);

	return (
		<Screen
			title={t("mobile.library.title")}
			testID={SCREEN.library}
			headerLeading={
				<Button
					testID={CONTROL.libraryBack}
					label={t("mobile.common.back")}
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
			headerAction={
				<IconButton
					accessibilityLabel={t("mobile.library.browse.refresh")}
					testID={CONTROL.libraryRetry}
					onPress={() => list.refresh()}
					icon={({ color, size }) => <RefreshCw color={color} size={size} />}
				/>
			}
		>
			{!enabled ? (
				<EmptyState
					testID={EMPTY.library}
					headline="The Library is not on this computer yet."
					next="Update Local Operator on the computer you are connected to, then reopen this screen."
				/>
			) : (
				<View className="flex-1">
					<View className="gap-2 pb-2">
						<Input
							testID={CONTROL.librarySearchField}
							label={t("mobile.library.browse.search_label")}
							value={browse.query}
							onChangeText={(query) =>
								setBrowse((current) => ({ ...current, query }))
							}
							placeholder={t("mobile.library.browse.search_placeholder")}
							returnKeyType="search"
						/>
						<Segmented
							label={t("mobile.library.browse.filter_by_kind")}
							options={segments}
							value={browse.segment}
							onChange={changeSegment}
							testID={CONTROL.libraryMore}
						/>
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={{ gap: 8 }}
							testID={REGION.libraryOrigins}
						>
							{LIBRARY_ORIGINS.map((origin) => (
								<Chip
									key={origin.value}
									label={origin.label}
									selected={browse.origin === origin.value}
									onPress={() =>
										setBrowse((current) => ({
											...current,
											origin: origin.value as LibraryOriginTab,
										}))
									}
									testID={libraryOriginOptionId(origin.value)}
								/>
							))}
						</ScrollView>
						<View className="flex-row flex-wrap items-center gap-2">
							<Chip
								label={
									filterCount > 0
										? t("mobile.library.browse.filters_count", {
												count: filterCount,
											})
										: t("mobile.library.browse.filters")
								}
								onPress={() => setFiltersOpen(true)}
								selected={filterCount > 0}
								testID={CONTROL.libraryFilters}
							/>
							<Chip
								label={`Sort: ${
									LIBRARY_SORTS.find((sort) => sort.value === browse.sort)
										?.label ?? "Recently seen"
								}`}
								onPress={() => setSortOpen(true)}
								testID={CONTROL.librarySort}
							/>
							{vocabulary.length > 0 ? (
								<ScrollView
									horizontal
									showsHorizontalScrollIndicator={false}
									contentContainerStyle={{ gap: 8 }}
								>
									{vocabulary.slice(0, 12).map((tag) => (
										<Chip
											key={tag.id}
											label={`${tag.name} ${tag.count}`}
											selected={browse.tag === tag.id}
											onPress={() =>
												setBrowse((current) => ({
													...current,
													tag: current.tag === tag.id ? null : tag.id,
												}))
											}
											testID={libraryTagId(tag.id)}
										/>
									))}
								</ScrollView>
							) : null}
						</View>
					</View>

					{page?.state === "building" ? (
						<Alert severity="warning" testID={SURFACE.libraryBuilding}>
							{`Building your library — ${page.scan.sessions_scanned} of ${page.scan.sessions_total} conversations scanned. New assets will appear as they are found.`}
						</Alert>
					) : null}

					{list.error !== null ? (
						<View className="gap-3">
							<Alert severity="error" testID={SURFACE.libraryError}>
								{list.error}
							</Alert>
							<Button
								label={t("mobile.common.try_again")}
								onPress={() => list.retry()}
								variant="outline"
								testID={CONTROL.libraryRetry}
							/>
						</View>
					) : list.loading && rows.length === 0 ? (
						<Skeleton lines={8} testID={SURFACE.libraryLoading} />
					) : rows.length === 0 ? (
						hasActiveFilters(browse) ? (
							<EmptyState
								testID={EMPTY.librarySearch}
								headline="No assets match these filters."
								next="Clear them to see the whole catalogue."
								action={{
									label: "Clear filters",
									onPress: clear,
									testID: CONTROL.libraryClearFilters,
								}}
							/>
						) : (
							<EmptyState
								testID={EMPTY.library}
								headline="Your library is empty."
								next="Images, documents and highlighted files appear here as you work in conversations."
							/>
						)
					) : (
						<FlatList
							data={rows}
							keyExtractor={(asset) => asset.id}
							numColumns={2}
							columnWrapperStyle={{ gap: 12 }}
							contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
							keyboardShouldPersistTaps="handled"
							testID={REGION.libraryGrid}
							refreshControl={
								<RefreshControl
									refreshing={list.refreshing}
									onRefresh={() => list.refresh()}
								/>
							}
							onEndReached={() => {
								if (pageIsCurrent) list.loadMore();
							}}
							onEndReachedThreshold={0.4}
							renderItem={({ item }) => (
								<LibraryTile
									asset={item}
									client={client}
									onPress={() => router.push(`/library/${item.id}`)}
								/>
							)}
							ListFooterComponent={
								pageIsCurrent &&
								page?.next_cursor !== null &&
								page?.next_cursor !== undefined ? (
									<View className="items-center pt-2">
										<Button
											label={list.loadingMore ? "Loading…" : "Load more"}
											onPress={() => list.loadMore()}
											loading={list.loadingMore}
											variant="outline"
											testID={CONTROL.libraryLoadMore}
										/>
									</View>
								) : null
							}
						/>
					)}
				</View>
			)}

			<FilterSheet
				visible={filtersOpen}
				onClose={() => setFiltersOpen(false)}
				status={browse.status}
				onStatus={(status) => setBrowse((current) => ({ ...current, status }))}
				tags={vocabulary}
				tag={browse.tag}
				onTag={(tag) => setBrowse((current) => ({ ...current, tag }))}
			/>
			<SortSheet
				visible={sortOpen}
				onClose={() => setSortOpen(false)}
				value={browse.sort}
				onChange={(sort) => setBrowse((current) => ({ ...current, sort }))}
			/>
			<Sheet
				visible={moreOpen}
				onClose={() => setMoreOpen(false)}
				title={t("mobile.library.browse.more_kinds")}
				testID={SURFACE.libraryMoreSheet}
				footer={
					<Button
						label={t("mobile.common.done")}
						onPress={() => setMoreOpen(false)}
						testID={CONTROL.libraryMoreDone}
					/>
				}
			>
				<View className="flex-row flex-wrap gap-2">
					{MORE_CATEGORIES.map((category) => (
						<Chip
							key={category.value}
							label={category.label}
							selected={
								browse.segment === "more" &&
								categoryForBrowse(browse) === category.value
							}
							onPress={() => {
								setBrowse((current) => ({
									...current,
									segment: "more",
									moreCategory: category.value,
								}));
								setMoreOpen(false);
							}}
							testID={libraryMoreOptionId(category.value)}
						/>
					))}
				</View>
			</Sheet>
		</Screen>
	);
}

/** One catalogue tile. The thumbnail is image-only on the wire, so the kind
 *  icon is the designed state for everything else — never a broken-image box. */
function LibraryTile({
	asset,
	client,
	onPress,
}: {
	asset: LibraryAsset;
	client: RelayEndpoints | null;
	onPress: () => void;
}) {
	const ink = useTokenColor("ink-dim");
	const thumb = useLibraryThumbnail(client, asset);
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={`${effectiveName(asset)}, ${kindLabel(asset.kind)}`}
			onPress={onPress}
			testID={libraryTileId(asset.id)}
			style={{ minHeight: TOUCH_FLOOR }}
			className="flex-1"
		>
			<View className="overflow-hidden rounded-md border border-hairline bg-surface">
				<View className="aspect-[4/3] items-center justify-center bg-elevated">
					{thumb !== null ? (
						<Image
							source={{ uri: thumb }}
							style={{ width: "100%", height: "100%" }}
							resizeMode="cover"
						/>
					) : (
						<KindIcon kind={asset.category} color={ink} />
					)}
				</View>
				<View className="gap-0.5 p-2">
					<Text className="text-body-sm text-ink" numberOfLines={2}>
						{effectiveName(asset)}
					</Text>
					<Text className="text-meta text-ink-dim" numberOfLines={1}>
						{(asset.size_bytes ?? 0) > 0
							? `${kindLabel(asset.kind)} · ${formatBytes(asset.size_bytes)}`
							: kindLabel(asset.kind)}
					</Text>
					{asset.tags.length > 0 ? (
						<Text className="text-meta text-ink-muted" numberOfLines={1}>
							{asset.tags.map((tag) => tag.name).join(" · ")}
						</Text>
					) : null}
				</View>
			</View>
		</Pressable>
	);
}

function FilterSheet({
	visible,
	onClose,
	status,
	onStatus,
	tags,
	tag,
	onTag,
}: {
	visible: boolean;
	onClose: () => void;
	status: LibraryStatus;
	onStatus: (status: LibraryStatus) => void;
	tags: NonNullable<ReturnType<typeof useLibraryList>["page"]>["tags"];
	tag: string | null;
	onTag: (tag: string | null) => void;
}) {
	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={t("mobile.library.browse.filters")}
			testID={SURFACE.libraryFilterSheet}
			footer={
				<Button
					label={t("mobile.common.done")}
					onPress={onClose}
					testID={CONTROL.libraryFiltersDone}
				/>
			}
		>
			<View className="gap-4">
				<View className="gap-2">
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.library.browse.status")}
					</Text>
					<View className="flex-row flex-wrap gap-2">
						{LIBRARY_STATUSES.map((option) => (
							<Chip
								key={option.value}
								label={option.label}
								selected={status === option.value}
								onPress={() => onStatus(option.value)}
								testID={libraryStatusOptionId(option.value)}
							/>
						))}
					</View>
				</View>
				<View className="gap-2">
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.library.browse.tag")}
					</Text>
					{tags.length === 0 ? (
						<Text className="text-body-sm text-ink-dim">
							{t("mobile.library.browse.no_tags")}
						</Text>
					) : (
						<View className="flex-row flex-wrap gap-2">
							<Chip
								label={t("mobile.library.browse.any_tag")}
								selected={tag === null}
								onPress={() => onTag(null)}
								testID={CONTROL.libraryFilterTagAny}
							/>
							{tags.map((option) => (
								<Chip
									key={option.id}
									label={`${option.name} ${option.count}`}
									selected={tag === option.id}
									onPress={() => onTag(tag === option.id ? null : option.id)}
									testID={libraryTagId(option.id)}
								/>
							))}
						</View>
					)}
				</View>
			</View>
		</Sheet>
	);
}

function SortSheet({
	visible,
	onClose,
	value,
	onChange,
}: {
	visible: boolean;
	onClose: () => void;
	value: LibrarySortValue;
	onChange: (value: LibrarySortValue) => void;
}) {
	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={t("mobile.library.browse.sort")}
			testID={SURFACE.librarySortSheet}
			footer={
				<Button
					label={t("mobile.common.done")}
					onPress={onClose}
					testID={CONTROL.librarySortDone}
				/>
			}
		>
			<View className="flex-row flex-wrap gap-2">
				{LIBRARY_SORTS.map((option) => (
					<Chip
						key={option.value}
						label={option.label}
						selected={value === option.value}
						onPress={() => onChange(option.value)}
						testID={librarySortOptionId(option.value)}
					/>
				))}
			</View>
		</Sheet>
	);
}
