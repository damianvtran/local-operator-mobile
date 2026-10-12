import { it } from "vitest";
import { maestroChecks } from "./maestro-flow-contract.ts";

// The same assertions run under CI's Vitest and directly under Node when a
// checkout has no dependencies; neither path boots or alters a native app.
for (const [name, run] of maestroChecks) it(name, run);
