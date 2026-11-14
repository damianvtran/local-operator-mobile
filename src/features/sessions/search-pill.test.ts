import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Operator report, TestFlight 906: "The typing in the search is not in the part
 * of the UI that is already the search bar, it creates a second uglier looking
 * bar, make it so that the typing happens in that bar that is already there."
 *
 * Source-level, as `composer-layout.test.ts` pins the same header: mounting the
 * whole conversations pane needs the connection, drawer and computer providers,
 * and what these assert is structural — WHERE the field lives and what names
 * it — which the source states exactly. The native/web interaction (tap, type,
 * clear) is the Maestro flow `03-session-list.yaml`'s and S15's.
 */
const PANE = readFileSync(
	resolve(import.meta.dirname, "conversations-pane.tsx"),
	"utf8",
);
const header = (() => {
	const start = PANE.indexOf("---- the header row (record §2.5)");
	const end = PANE.indexOf("{notice ? (", start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return PANE.slice(start, end);
})();
const pill = (() => {
	const start = header.indexOf("<Pressable");
	const end = header.indexOf("</Pressable>", start);
	return header.slice(start, end);
})();

describe("the search pill is the search field", () => {
	it("puts the text input INSIDE the pill, and no second search bar exists", () => {
		expect(pill).toContain("testID={CONTROL.sidebarSearch}");
		expect(pill).toContain("<TextInput");
		expect(pill).toContain("testID={CONTROL.sidebarSearchField}");
		// The old shape: a toggle that mounted a labelled Input below the header.
		expect(PANE).not.toMatch(/<Input\b/);
		expect(PANE).not.toContain("setSearching");
		expect(PANE.match(/testID=\{CONTROL\.sidebarSearchField\}/g)).toHaveLength(
			1,
		);
	});

	it("a tap anywhere on the capsule focuses the field (type in place)", () => {
		expect(pill).toContain("onPress={() => searchField.current?.focus()}");
		expect(pill).toContain("ref={searchField}");
	});

	it("keeps the pill's geometry: same capsule, same touch-floor height", () => {
		expect(pill).toContain("rounded-full bg-sunken");
		expect(pill).toContain("style={{ minHeight: TOUCH_FLOOR }}");
		expect(PANE).toContain("paddingVertical: 0");
	});

	it("names the field through the catalogue: label, placeholder, clear", () => {
		expect(pill).toContain(
			'accessibilityLabel={t("relay.chrome.list.search_label")}',
		);
		expect(pill).toContain('placeholder={t("relay.chrome.list.search_open")}');
		expect(pill).toContain(
			'accessibilityLabel={t("mobile.chrome.clear_search")}',
		);
		expect(PANE).not.toContain('"Search conversations"');
		expect(PANE).not.toContain('"Name, id or folder"');
	});

	it("shows × only with text; × and Escape clear, a second Escape blurs", () => {
		expect(pill).toMatch(
			/\{query === "" \?[\s\S]*?testID=\{CONTROL\.sidebarSearchClear\}/,
		);
		// The behaviour itself — clear, blur, then the drawer's — is driven
		// against the real Modal keyup listener in `search-escape.test.tsx`;
		// here, that the pill routes through it and the web guard is installed.
		expect(pill).toContain("searchEscape.keyDown(event.nativeEvent.key);");
		expect(PANE).toContain('clear: () => setQuery("")');
		expect(PANE).toContain("blur: () => searchField.current?.blur()");
		expect(PANE).toMatch(
			/Platform\.OS !== "web"[\s\S]{0,80}searchEscape\.guard\(window/,
		);
	});

	it("suppresses the browser's square focus ring inside the capsule (D3)", () => {
		expect(pill).toContain("web:outline-none");
		expect(pill).toMatch(/className="[^"]*\bpx-1\b[^"]*web:outline-none"/);
	});

	it("keeps the RTL placeholder direction and the empty-search Clear path", () => {
		expect(pill).toContain('{...(query === "" ? composedDir : {})}');
		expect(PANE).toContain('onClearSearch={() => setQuery("")}');
	});

	it("keeps the drawer's handled taps for an open keyboard", () => {
		expect(PANE).toContain('keyboardShouldPersistTaps="handled"');
		expect(PANE).toContain("A focused search field (the header pill)");
	});
});
