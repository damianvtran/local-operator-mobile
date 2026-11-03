/** One checked-in wire policy shared by Node, Python and generated Swift.
 * Token lengths are exact, not a historical-length compatibility fallback. */
import { readFileSync } from "node:fs";

const value = JSON.parse(
	readFileSync(
		new URL("./retirement-replay-policy.json", import.meta.url),
		"utf8",
	),
) as { sessionBytes: number; bearerBytes: number; failureCauses: string[] };
if (
	Object.keys(value).sort().join(",") !==
		"bearerBytes,failureCauses,sessionBytes" ||
	![value.sessionBytes, value.bearerBytes].every(
		(n) => Number.isInteger(n) && n >= 16 && n <= 64,
	) ||
	!Array.isArray(value.failureCauses) ||
	value.failureCauses.some((n) => typeof n !== "string")
)
	throw new Error("Replay policy invalid");
export const REPLAY_POLICY = Object.freeze(value);
