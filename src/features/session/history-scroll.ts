/** Load on a reader reaching the real top AFTER initial tail placement. Mount,
 * layout and remaining at the top are not new requests. Unlike drag callbacks,
 * scroll offsets also cover keyboard, web and accessibility navigation. */
export const historyTopReached = (
	previousOffset: number,
	offset: number,
	initialPositioned: boolean,
	hasError: boolean,
): boolean =>
	initialPositioned && !hasError && previousOffset > 0 && offset <= 0;
