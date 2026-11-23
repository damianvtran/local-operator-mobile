/*
 * The row count above which a picker grows a search field.
 *
 * Its own module because `picker-model` -> `home-defaults` -> `start-targets` ->
 * `picker-model` was a require cycle whose only link back was this number
 * (start-targets reads it for the start-target picker).
 */

/** Above this many rows the model picker grows a search field (design spec §5).
 *  Below it a field is one more control between the reader and a list they can
 *  already see whole. */
export const MODEL_SEARCH_THRESHOLD = 12;
