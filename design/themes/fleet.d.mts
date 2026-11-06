/**
 * Types for `fleet.mjs` — `scripts/build-theme.ts` imports `shippedPalettes`
 * under `tsconfig.tools.json`, which does not type-check JavaScript, so the
 * shape is declared here (the same arrangement as
 * `design/preview/capture-stale.probe.d.mts`).
 */
export type FleetEntry = {
	id: string;
	name: string;
	mode: "light" | "dark";
	/** The phone's kebab-case roles -> `#rrggbb` (the scrim `#rrggbbaa`). */
	colors: Record<string, string>;
	unsolved: { role: string; why: string }[];
	checks: number;
	failures: string[];
};
export declare const EXPECTED_WITHHELD: Record<string, string>;
export declare const desktopPalettes: () => unknown[];
export declare const fleetReport: () => FleetEntry[];
export declare const shippedPalettes: () => FleetEntry[];
export declare const judge: (derived: {
	mode: "light" | "dark";
	colors: Record<string, string>;
	unsolved: { role: string; why: string }[];
}) => { checks: number; failures: string[] };
