import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROL, REGION } from "@/ui/a11y";
import {
	ACCOUNT_ROUTING_COPY,
	ACCOUNT_ROUTING_SOURCE_LOCALE,
	accountRoutingCopy,
} from "./account-routing-copy";

const componentSource = readFileSync(
	new URL("./account-routing-section.tsx", import.meta.url),
	"utf8",
);
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const RAW_TEXT = /<Text\b[^>]*>\s*\p{L}[^<{]*<\/Text>/u;
const LITERAL_LABEL =
	/\b(?:label|accessibilityLabel|accessibilityHint|placeholder|title)\s*=\s*(?:"[^"]+"|'[^']+'|\{\s*["'][^"']+["']\s*\})/;
const SOURCE_KEY = /["'](mobile\.account_routing\.[a-z_]+)["']/g;
const SEGMENT = /<Segmented\b([\s\S]*?)\/>/g;
const BUTTON = /<Button\b([\s\S]*?)\/>/g;
const BACKEND_LABEL = /\blabel\s*=\s*\{row\.label\}/;
const SOURCE_LABEL = /\blabel\s*=\s*\{\s*copy\s*\(/;
const CONTROL_ID = /\btestID\s*=\s*\{CONTROL\.([a-zA-Z0-9_]+)\}/;

/** Deliberately feature-scoped lexical guard, NOT a general TSX parser or
 * native accessibility audit. Strip comments, bind the finite known keys and
 * actual primitive call sites, then prove each guard with source mutations.
 * TypeScript7 exposes no JS compiler AST; do not add another parser/runtime
 * dependency merely to scan this one small component. */
function assertFeatureCopy(input: string) {
	const source = input.replace(COMMENTS, "");
	if (RAW_TEXT.test(source)) throw new Error("raw JSX copy");
	if (LITERAL_LABEL.test(source)) throw new Error("literal accessible copy");
	const seen = new Set(
		[...source.matchAll(SOURCE_KEY)].map((match) => {
			const key = match[1];
			if (key === undefined) throw new Error("missing key capture");
			return key;
		}),
	);
	for (const key of seen)
		if (!Object.hasOwn(ACCOUNT_ROUTING_COPY, key))
			throw new Error("missing source key");
	if (seen.size !== Object.keys(ACCOUNT_ROUTING_COPY).length)
		throw new Error("source key inventory changed");
	const groups = [...source.matchAll(SEGMENT)];
	if (groups.length !== 1 || !BACKEND_LABEL.test(groups[0]?.[1] ?? ""))
		throw new Error("backend accessible label missing");
	const buttons = [...source.matchAll(BUTTON)];
	if (buttons.length !== 3) throw new Error("control inventory changed");
	for (const button of buttons) {
		const attributes = button[1] ?? "";
		if (!SOURCE_LABEL.test(attributes))
			throw new Error("button source label missing");
		const name = attributes.match(CONTROL_ID)?.[1];
		if (!name || !Object.hasOwn(CONTROL, name))
			throw new Error("control identity missing");
	}
}

describe("finite account-routing English SOURCE seam", () => {
	it("owns explicit keys/context without claiming core descriptors or translated eligibility", () => {
		expect(ACCOUNT_ROUTING_SOURCE_LOCALE).toBe("en");
		expect(Object.keys(ACCOUNT_ROUTING_COPY)).toHaveLength(13);
		for (const [key, message] of Object.entries(ACCOUNT_ROUTING_COPY)) {
			expect(key.startsWith("mobile.account_routing.")).toBe(true);
			expect(message.source.trim().length).toBeGreaterThan(0);
			expect(message.context.trim().length).toBeGreaterThan(20);
			expect(["heading", "help", "status", "button"]).toContain(message.role);
		}
		expect(accountRoutingCopy("mobile.account_routing.save")).toBe(
			"Save policy",
		);
	});
	it("rejects missing/prototype keys instead of leaking an ID or a fallback literal", () => {
		expect(() =>
			Reflect.apply(accountRoutingCopy, undefined, [
				"mobile.account_routing.missing",
			]),
		).toThrow(RangeError);
		expect(() =>
			Reflect.apply(accountRoutingCopy, undefined, ["toString"]),
		).toThrow(RangeError);
	});
	it("binds the actual component to source keys, backend label and stable controls", () => {
		expect(() => assertFeatureCopy(componentSource)).not.toThrow();
		expect(REGION.settingsAccountRouting).toBe(
			"settings-section-account-routing",
		);
	});
	it.each([
		[
			"missing key",
			(source: string) =>
				source.replace(
					'copy("mobile.account_routing.title")',
					'copy("mobile.account_routing.typo")',
				),
		],
		[
			"raw JSX",
			(source: string) =>
				source.replace(
					'{copy("mobile.account_routing.loading")}',
					"Untracked English loading",
				),
		],
		[
			"literal accessible label",
			(source: string) => source.replace("label={row.label}", 'label="Policy"'),
		],
		[
			"missing accessible label",
			(source: string) => source.replace("label={row.label}", ""),
		],
		[
			"missing selector",
			(source: string) =>
				source.replace("testID={CONTROL.settingsAccountRoutingSave}", ""),
		],
	] as const)("rejects a discriminating %s counterfactual", (_name, mutate) => {
		const changed = mutate(componentSource);
		expect(changed).not.toBe(componentSource);
		expect(() => assertFeatureCopy(changed)).toThrow();
	});
});
