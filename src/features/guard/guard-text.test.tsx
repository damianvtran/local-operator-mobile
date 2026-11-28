import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderFor } from "@/i18n";
import { Heading } from "@/ui/components/heading";
import { DirectionProvider, useComposedDir } from "@/ui/direction";
import { GuardText } from "./guard-text";

/**
 * The rendered half of the Urdu consent-heading fix (PR #402, i18n auditor 1),
 * against the REAL react-native-web the web export ships — the layer where the
 * defect lived. react-native-web gives a `Text` with no `dir` the attribute
 * `dir="auto"`, and the browser resolves `auto` from the FIRST strong character:
 * the Urdu heading opens with the Latin word `Guard`, so it computed
 * `direction: ltr` inside the RTL sheet and swapped its Urdu and Latin runs.
 * The assertions below fail on that behaviour (`dir="auto"`) and pass once the
 * element states the page's direction.
 */
const urduHeading = renderFor(
	"mobile.guard.prompt_title",
	{ org: "Example Org" },
	"ur",
);

const page = (direction: "ltr" | "rtl", child: ReactNode) =>
	renderToStaticMarkup(
		<DirectionProvider direction={direction} locale="ur">
			{child}
		</DirectionProvider>,
	);

const SheetTitle = () => {
	const composedDir = useComposedDir();
	// Mirrors what `Sheet` does with its `titleDir` prop: Heading.composedDir.
	return (
		<Heading level={2} className="" composedDir={composedDir}>
			{urduHeading}
		</Heading>
	);
};

describe("Guard text states the page's base direction", () => {
	it("premise: the Urdu consent heading opens with Latin and contains Urdu", () => {
		expect(urduHeading).toMatch(/^[A-Za-z]/);
		expect(urduHeading).toMatch(/[\u0600-\u06FF]/);
	});

	it("rtl page: GuardText renders dir=rtl, not the inferred auto", () => {
		const html = page("rtl", <GuardText>{urduHeading}</GuardText>);
		expect(html).toContain('dir="rtl"');
		expect(html).not.toContain('dir="auto"');
	});

	it("rtl page: the sheet's heading (Heading.composedDir) renders dir=rtl", () => {
		const html = page("rtl", <SheetTitle />);
		expect(html).toContain("<h2");
		expect(html).toContain('dir="rtl"');
		expect(html).not.toContain('dir="auto"');
	});

	it("without the hint a heading keeps dir=auto — the defect this fixes", () => {
		const html = page(
			"rtl",
			<Heading level={2} className="">
				{urduHeading}
			</Heading>,
		);
		expect(html).toContain('dir="auto"');
	});

	it("ltr page: English and the other LTR catalogues are unchanged (dir stays auto)", () => {
		const html = page("ltr", <GuardText>Share Guard stats?</GuardText>);
		expect(html).toContain('dir="auto"');
		expect(html).not.toContain('dir="rtl"');
	});

	it("Sheet forwards its titleDir to the heading, and the consent sheet passes it", () => {
		const read = (rel: string) =>
			readFileSync(new URL(rel, import.meta.url), "utf8");
		expect(read("../../ui/components/sheet.tsx")).toContain(
			"composedDir={titleDir}",
		);
		expect(read("./guard-views.tsx")).toContain("titleDir={composedDir}");
	});
});
