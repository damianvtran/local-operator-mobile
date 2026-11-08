import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Audit U-06 on S15/loading (iphone-se, 200 %): the recovery title beside the
 * spinner had no shrink rule, so "Connecting to <long host>…" laid out on one
 * line 353 px wide in a 320 px viewport. The guard is the row's flex contract:
 * the title is the item that shrinks, and it wraps rather than truncating the
 * host name it exists to state. Node renders no box, so the contract is read
 * from the component, anchored on the title Text inside `HomeRecovery`. */
const SPLASH = readFileSync(
	new URL("./home-splash.tsx", import.meta.url),
	"utf8",
);
const recovery = SPLASH.slice(SPLASH.indexOf("export const HomeRecovery"));
const titleRow = recovery.slice(
	recovery.indexOf('<View className="flex-row items-center gap-2">'),
	recovery.indexOf("{title}"),
);
const titleTag = titleRow.slice(titleRow.lastIndexOf("<Text"));

describe("the home recovery title with a long host name (U-06)", () => {
	it("shares its row with the spinner as the item that shrinks", () => {
		expect(titleRow).toContain("<ActivityIndicator />");
		expect(titleTag).toContain("min-w-0");
		expect(titleTag).toContain("flex-1");
	});

	it("wraps the host rather than clipping or eliding it", () => {
		expect(titleTag).not.toContain("numberOfLines");
		expect(titleTag).toContain("text-title");
	});
});
