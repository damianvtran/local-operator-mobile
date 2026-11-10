import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mount the real block/inline component tree; only native adapters/providers are
// replaced. This proves dispatch/actions, not native layout (browser/device QA).
const host = vi.hoisted(() => ({
	links: [] as {
		label: string;
		press: (event: {
			stopPropagation: () => void;
			preventDefault: () => void;
		}) => void;
	}[],
	open: vi.fn(async (_url: string) => undefined),
	copies: [] as (() => void)[],
	os: "web" as "web" | "ios" | "android",
}));
vi.mock("react-native", async () => {
	const { createElement } = await import("react");
	/* The host's styling props are serialised onto the markup (`data-class`,
	 *  `data-style`, `data-testid`) so a test can read the layout CONTRACT the
	 *  component hands the native host — the shared column widths and the code
	 *  face — without a layout engine. */
	const hostProps = (props: {
		className?: string;
		style?: unknown;
		testID?: string;
	}) => ({
		"data-class": props.className,
		"data-style": props.style ? JSON.stringify(props.style) : undefined,
		"data-testid": props.testID,
	});
	const text = ({
		children,
		accessibilityRole,
		onPress,
		...rest
	}: {
		children: ReactNode;
		accessibilityRole?: string;
		className?: string;
		style?: unknown;
		testID?: string;
		onPress?: (event: {
			stopPropagation: () => void;
			preventDefault: () => void;
		}) => void;
	}) => {
		if (accessibilityRole === "link" && onPress)
			host.links.push({ label: String(children), press: onPress });
		return createElement(
			accessibilityRole === "link" ? "a" : "span",
			{ role: accessibilityRole, ...hostProps(rest) },
			children,
		);
	};
	const view = ({
		children,
		...rest
	}: {
		children: ReactNode;
		className?: string;
		style?: unknown;
		testID?: string;
	}) => createElement("div", hostProps(rest), children);
	return {
		Text: text,
		View: view,
		ScrollView: view,
		Pressable: ({
			children,
			onLongPress,
		}: {
			children: ReactNode;
			onLongPress?: () => void;
		}) => {
			if (onLongPress) host.copies.push(onLongPress);
			return view({ children });
		},
		Platform: {
			get OS() {
				return host.os;
			},
			select: (options: Record<string, unknown>) =>
				host.os in options ? options[host.os] : options.default,
		},
		Linking: { openURL: host.open },
	};
});
vi.mock("react-native-svg", async () => {
	const { createElement } = await import("react");
	const node = ({ children }: { children: ReactNode }) =>
		createElement("svg", null, children);
	return {
		default: node,
		Defs: node,
		LinearGradient: node,
		Rect: node,
		Stop: node,
	};
});
vi.mock("expo-clipboard", () => ({
	setStringAsync: vi.fn(async () => undefined),
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#ffffff" }));
vi.mock("@/ui/direction", () => ({
	useIsRTL: () => false,
	LTR_TEXT: { writingDirection: "ltr" },
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/features/session/table-scroll-hook", () => ({
	forcedTableScroll: () => null,
}));

import { Markdown } from "./markdown";

describe("rendered assistant markdown dispatch", () => {
	beforeEach(() => {
		host.links = [];
		host.copies = [];
		host.open.mockClear();
	});
	it.each([
		"[Reuters](https://www.reuters.com/world/)",
		"- **[Reuters](https://www.reuters.com/world/)**",
		"# [Reuters](https://www.reuters.com/world/)",
		"> [Reuters](https://www.reuters.com/world/)",
		"| Source |\n| --- |\n| [Reuters](https://www.reuters.com/world/) |",
	])("mounts an accessible actionable label in %s", async (source) => {
		const markup = renderToStaticMarkup(
			createElement(Markdown, { text: source }),
		);
		expect(markup).toContain('role="link"');
		expect(markup).not.toContain("[Reuters]");
		expect(host.links).toHaveLength(1);
		expect(host.links[0]?.label).toBe("Reuters");
		const stopPropagation = vi.fn();
		host.links[0]?.press({ stopPropagation, preventDefault: vi.fn() });
		await Promise.resolve();
		expect(stopPropagation).toHaveBeenCalledOnce();
		expect(host.open).toHaveBeenCalledExactlyOnceWith(
			"https://www.reuters.com/world/",
		);
	});
	it.each(["]", "["])(
		"dispatches a linked code-span label containing %s",
		async (bracket) => {
			const markup = renderToStaticMarkup(
				createElement(Markdown, {
					text: `[a \`${bracket}\` b](https://example.com)`,
				}),
			);
			expect(markup.match(/role="link"/g)).toHaveLength(3);
			expect(host.links.map((link) => link.label)).toEqual([
				"a ",
				bracket,
				" b",
			]);
			for (const link of host.links) {
				link.press({ stopPropagation: vi.fn(), preventDefault: vi.fn() });
				await Promise.resolve();
			}
			expect(host.open.mock.calls).toEqual(
				Array.from({ length: 3 }, () => ["https://example.com"]),
			);
		},
	);
	it.each([
		'https://example.com "literal `"',
		"https://example.com/`",
		'https://example.com "escaped \\" quote `"',
	])(
		"keeps both labels actionable after opaque destination %s",
		async (destination) => {
			const markup = renderToStaticMarkup(
				createElement(Markdown, {
					text: `[one](${destination}) [two](https://example.org) \`code\``,
				}),
			);
			expect(host.links.map((link) => link.label)).toEqual(["one", "two"]);
			expect(markup).not.toContain("[two]");
			expect(markup).toContain("code");
			for (const link of host.links) {
				link.press({ stopPropagation: vi.fn(), preventDefault: vi.fn() });
				await Promise.resolve();
			}
			expect(host.open.mock.calls).toEqual([
				[
					destination.startsWith("https://example.com/`")
						? "https://example.com/`"
						: "https://example.com",
				],
				["https://example.org"],
			]);
		},
	);
	it("never wires unsafe links or link-shaped inline/fenced code", () => {
		const markup = renderToStaticMarkup(
			createElement(Markdown, {
				text: "[unsafe](javascript:alert(1)) <script>alert(1)</script>\n\n`[code](https://example.com)`\n\n```ts\n[fenced](https://example.com)\n```",
			}),
		);
		expect(host.links).toHaveLength(0);
		expect(host.open).not.toHaveBeenCalled();
		expect(markup).toContain("&lt;script&gt;");
		expect(markup).toContain("[code](https://example.com)");
		expect(markup).toContain("[fenced](https://example.com)");
	});
});

/* The operator's report (iPhone build 773): the "wait & bash sleep — Actual
 *  Impact" answer, reconstructed from the screenshot's visible cells. Its
 *  label column carries inline code and is the longest column, which is what
 *  made each row's flex layout settle on different boundaries. */
const IMPACT_ANSWER = [
	"Your instinct on `wait` was spot-on — once I separated **true** `wait_ms` **timeouts** from event-driven early returns, the picture changed completely:",
	"",
	"### `wait` & `bash sleep` — Actual Impact",
	"",
	"| Pattern | Calls (%) | 24h Calls | Lifetime | 24h Cost |",
	"| --- | --- | --- | --- | --- |",
	"| `wait` early return (inbound message) | 4,121 (46.3%) | 550 | $66.64 | $8.12 |",
	"| `wait` child settled | 2,266 (25.5%) | 114 | $24.79 | $1.66 |",
	"| `hub`/peer wake-ups | 1,083 (12.2%) | 115 | $6.28 | $0.97 |",
	"| true `wait_ms` timeouts | 663 (7.4%) | 123 | $10.91 | $0.40 |",
	"| `bash sleep` (any), 484 CI polls | 13 | $1.28 | $0.40 | 54% (161/296) |",
	"",
	"```bash",
	"lop wait --job 4f2c --wait-ms 600000   # long line that must scroll, never wrap",
	"```",
].join("\n");

/* Rows are found by their test ids and each row's cells are the cell styles
 *  between it and the next row marker; the table is the only owner of either id. */
const ROW_MARK = /data-testid="md-table-(?:head|row)"/g;
const CELL_STYLE = /data-style="([^"]*)" data-testid="md-table-cell"/g;
const decodeQuotes = (value: string) => value.replace(/&quot;/g, '"');
const INLINE_CHIP =
	/<span data-class="([^"]*)"(?: data-style="([^"]*)")?>wait<\/span>/;
const FENCE_BODY =
	/<span data-class="[^"]*font-mono[^"]*" data-style="([^"]*)">lop wait/;

describe("operator report: table columns and code faces (build 773)", () => {
	beforeEach(() => {
		host.os = "web";
	});

	it("gives the header and every body row the SAME explicit column widths", () => {
		const markup = renderToStaticMarkup(
			createElement(Markdown, { text: IMPACT_ANSWER }),
		);
		const marks = [...markup.matchAll(ROW_MARK)].map((mark) => mark.index ?? 0);
		const rows = marks.map((start, index) =>
			[...markup.slice(start, marks[index + 1]).matchAll(CELL_STYLE)].map(
				(cell) =>
					JSON.parse(decodeQuotes(cell[1] ?? "{}")) as Record<string, number>,
			),
		);
		// One header + five body rows, five cells each.
		expect(rows).toHaveLength(6);
		for (const row of rows) expect(row).toHaveLength(5);
		const header = rows[0] ?? [];
		for (const cell of header) {
			// A fixed width, not a flex share: a row-local flex pass is what let
			// each iOS row settle on its own boundaries.
			expect(cell.width).toBeGreaterThan(0);
			expect(cell.flexGrow ?? 0).toBe(0);
			expect(cell.flexShrink).toBe(0);
		}
		for (const row of rows.slice(1))
			expect(row.map((cell) => cell.width)).toEqual(
				header.map((cell) => cell.width),
			);
	});

	it("renders inline code as a mono chip, natively naming a bundled face", () => {
		for (const os of ["web", "ios", "android"] as const) {
			host.os = os;
			const markup = renderToStaticMarkup(
				createElement(Markdown, { text: "Use `wait` not `bash sleep`." }),
			);
			const chip = markup.match(INLINE_CHIP);
			expect(chip).not.toBeNull();
			expect(chip?.[1]).toContain("font-mono");
			expect(chip?.[1]).toContain("bg-sunken");
			const style = chip?.[2] ? JSON.parse(decodeQuotes(chip[2])) : {};
			// React Native cannot resolve a CSS fallback LIST: the theme's
			// `--font-mono` stack silently became the system face on iPhone.
			expect(style.fontFamily).toBe(
				os === "web" ? undefined : "JetBrainsMono-Regular",
			);
		}
	});

	it("gives a fenced block's body the bundled mono face natively", () => {
		host.os = "ios";
		const markup = renderToStaticMarkup(
			createElement(Markdown, { text: IMPACT_ANSWER }),
		);
		const body = markup.match(FENCE_BODY);
		expect(body).not.toBeNull();
		expect(JSON.parse(decodeQuotes(body?.[1] ?? "{}")).fontFamily).toBe(
			"JetBrainsMono-Regular",
		);
	});
});
