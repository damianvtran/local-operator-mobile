import { it } from "vitest";
import { androidOriginChecks } from "./android-origin-check.ts";

// Keep the same real-socket checks available on dependency-free Node hosts;
// CI's normal Vitest run must exercise the explicit CLI opt-in as well.
for (const [name, run] of androidOriginChecks) it(name, run, 15000);
