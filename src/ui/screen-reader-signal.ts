/**
 * Whether the platform's screen-reader answer means anything. On the web build it
 * does not (review W1): react-native-web's `isScreenReaderEnabled()` is a constant
 * `true`, so reading it switched the composer's compaction off for every web
 * visitor, and the `initialShrunk` test seam with it. The web has no reliable
 * signal for an assistive technology and no reader drag that could shrink the dock,
 * so the gate is treated as off there and the hook rests at `false`.
 */
export const screenReaderSignalUsable = (platform: string): boolean =>
	platform !== "web";
