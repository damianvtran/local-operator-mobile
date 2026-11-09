/** Build389 deliberately retires the display-radius table. Clearance is
 * OUTSIDE one uniformly rounded shell; native display/private APIs are neither
 * necessary nor used. Screen pays lateral cutouts, this helper the bottom once.
 */
export const composerOuterGap = (
	bottomInset: number,
	keyboardVisible: boolean,
): number => (keyboardVisible ? 8 : Math.max(0, bottomInset) + 8);
