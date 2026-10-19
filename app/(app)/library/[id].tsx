import LibraryDetail from "@/features/library/library-detail";

/** One Library asset, pushed from the grid. The id in the route is the asset's
 *  opaque `la_…` id — never a path, because the phone projection has none. */
export default function LibraryAssetRoute() {
	return <LibraryDetail />;
}
