import { beforeEach, describe, expect, it } from "vitest";

import {
	DIAGRAM_SOURCES,
	HOSTILE_SOURCES,
} from "@/features/session/diagram-fixtures";
import {
	clearDiagramCache,
	currentResult,
	type DiagramResult,
	peekDiagram,
	renderDiagram,
} from "@/features/session/diagram-render";
import {
	DiagramSvgError,
	type PrepareOptions,
	prepareDiagramSvg,
	type SvgNode,
	surveyTree,
} from "@/features/session/diagram-svg";
import { peleThemeVariables } from "@/features/session/diagram-theme";
import { THEMES } from "@/ui/tokens.gen";

const entryFor = (mode: "light" | "dark") => {
	const entry = THEMES.find((theme) => theme.mode === mode);
	if (!entry) throw new Error(`no ${mode} theme`);
	return entry;
};
const LIGHT = peleThemeVariables((role) => entryFor("light").colors[role]);
const DARK = peleThemeVariables((role) => entryFor("dark").colors[role]);
const FONTS = { sans: undefined, mono: "JetBrainsMono-Regular" };

const request = (
	source: string,
	theme: Record<string, string> = LIGHT,
	width = 340,
) => ({ source, width, theme, fonts: FONTS });

/** What a native view may ever be handed. */
const ALLOWED_TAGS = new Set([
	"svg",
	"g",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polygon",
	"polyline",
	"text",
	"tspan",
]);
const ALLOWED_PROPS = new Set([
	"fill",
	"stroke",
	"strokeWidth",
	"strokeLinecap",
	"strokeLinejoin",
	"strokeDasharray",
	"strokeOpacity",
	"fillOpacity",
	"fillRule",
	"opacity",
	"x",
	"y",
	"dx",
	"dy",
	"x1",
	"y1",
	"x2",
	"y2",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"width",
	"height",
	"d",
	"points",
	"transform",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"fontFamily",
	"textAnchor",
	"viewBox",
]);

const LINK_PROP = /href|src/i;
const BAD_VALUE = /var\(|url\(|javascript:|data:|vbscript:|<|>|\bon[a-z]+=/i;

const walk = (
	node: SvgNode,
	visit: (node: SvgNode) => void,
	text: (value: string) => void = () => undefined,
): void => {
	visit(node);
	for (const child of node.children) {
		if (typeof child === "string") text(child);
		else walk(child, visit, text);
	}
};

const expectInert = (root: SvgNode) => {
	const { tags, props } = surveyTree(root);
	for (const tag of tags)
		expect(ALLOWED_TAGS.has(tag), `tag ${tag}`).toBe(true);
	for (const prop of props) {
		expect(ALLOWED_PROPS.has(prop), `prop ${prop}`).toBe(true);
	}
	walk(root, (node) => {
		for (const [name, value] of Object.entries(node.props)) {
			const flat = Array.isArray(value) ? value.join(" ") : String(value);
			expect(flat, `${node.tag}.${name}`).not.toMatch(BAD_VALUE);
		}
	});
};

const okOrThrow = (result: DiagramResult) => {
	if (!result.ok) throw new Error(`not drawn: ${result.message}`);
	return result;
};

beforeEach(() => clearDiagramCache());

describe("Pele's output, prepared for react-native-svg", () => {
	it("draws every diagram type Pele ships, with nothing but allow-listed parts", async () => {
		const failures: string[] = [];
		for (const [name, source] of Object.entries(DIAGRAM_SOURCES)) {
			const result = await renderDiagram(request(source));
			if (!result.ok) {
				failures.push(`${name}: ${result.message}`);
				continue;
			}
			expectInert(result.prepared.root);
			expect(result.prepared.width, name).toBeGreaterThan(0);
			expect(result.prepared.height, name).toBeGreaterThan(0);
		}
		expect(failures).toEqual([]);
	});

	it("resolves every var() — none survives into a prop", async () => {
		for (const [name, source] of Object.entries(DIAGRAM_SOURCES)) {
			const result = okOrThrow(await renderDiagram(request(source)));
			walk(result.prepared.root, (node) => {
				for (const [prop, value] of Object.entries(node.props)) {
					expect(String(value), `${name} ${node.tag}.${prop}`).not.toContain(
						"var(",
					);
				}
			});
		}
	});

	it("paints a flowchart node with the theme's roles", async () => {
		const { prepared } = okOrThrow(
			await renderDiagram(request(DIAGRAM_SOURCES.flowchart ?? "")),
		);
		const rects: SvgNode[] = [];
		walk(prepared.root, (node) => {
			if (node.tag === "rect") rects.push(node);
		});
		const node = rects.find(
			(rect) => rect.props.fill === LIGHT["--pele-surface"],
		);
		expect(node).toBeDefined();
		expect(node?.props.stroke).toBe(LIGHT["--pele-border"]);
		// `style="rx:var(--_r)"` became a real attribute.
		expect(node?.props.rx).toBeGreaterThan(0);
	});

	it("repaints from a different theme, not from a cached one", async () => {
		const source = DIAGRAM_SOURCES.flowchart ?? "";
		const light = okOrThrow(await renderDiagram(request(source, LIGHT)));
		const dark = okOrThrow(await renderDiagram(request(source, DARK)));
		const fills = (root: SvgNode) => {
			const out = new Set<string>();
			walk(root, (node) => {
				if (typeof node.props.fill === "string") out.add(node.props.fill);
			});
			return out;
		};
		expect(fills(light.prepared.root).has(LIGHT["--pele-surface"] ?? "")).toBe(
			true,
		);
		expect(fills(dark.prepared.root).has(DARK["--pele-surface"] ?? "")).toBe(
			true,
		);
		expect(fills(dark.prepared.root).has(LIGHT["--pele-surface"] ?? "")).toBe(
			false,
		);
	});

	it("writes inherited text styling onto each text node", async () => {
		const { prepared } = okOrThrow(
			await renderDiagram(request(DIAGRAM_SOURCES.sequence ?? "")),
		);
		let texts = 0;
		let atBase = 0;
		walk(prepared.root, (node) => {
			if (node.tag !== "text") return;
			texts += 1;
			expect(node.props.fontSize).toBeGreaterThan(0);
			expect(node.props.textAnchor).toBeDefined();
			if (node.props.fontSize === 14) atBase += 1;
		});
		expect(texts).toBeGreaterThan(5);
		expect(atBase).toBeGreaterThan(0);
	});

	it("uses the mono face where Pele asks for monospace, and omits sans", async () => {
		const { prepared } = okOrThrow(
			await renderDiagram(request(DIAGRAM_SOURCES.class ?? "")),
		);
		const families = new Set<string>();
		walk(prepared.root, (node) => {
			if (typeof node.props.fontFamily === "string") {
				families.add(node.props.fontFamily);
			}
		});
		for (const family of families) expect(family).toBe("JetBrainsMono-Regular");
	});

	it("labels the diagram with its title, else its first node", async () => {
		const pie = okOrThrow(
			await renderDiagram(request(DIAGRAM_SOURCES.pie ?? "")),
		);
		expect(pie.type).toBe("pie");
		expect(pie.prepared.label).toBe("Pets");
		const flow = okOrThrow(
			await renderDiagram(request(DIAGRAM_SOURCES.flowchart ?? "")),
		);
		expect(flow.type).toBe("flowchart");
		expect(flow.prepared.label).toBe("Start");
	});

	it("decodes entities as text, not as markup", async () => {
		const { prepared } = okOrThrow(
			await renderDiagram(
				request('flowchart TD\n  A["Fish & chips <ok>"] --> B'),
			),
		);
		const texts: string[] = [];
		walk(
			prepared.root,
			() => undefined,
			(value) => texts.push(value),
		);
		expect(texts.join("|")).toContain("Fish & chips <ok>");
	});
});

describe("a diagram Pele cannot draw", () => {
	it("returns Pele's own message so the code block can show why", async () => {
		const result = await renderDiagram(
			request("flowchart TD\n  A[Start --> B"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("invalid");
			expect(result.message.length).toBeGreaterThan(0);
			expect(result.message.length).toBeLessThanOrEqual(280);
		}
	});

	it("refuses text that is not a diagram at all", async () => {
		const result = await renderDiagram(request("just some words"));
		expect(result.ok).toBe(false);
	});

	it("refuses a source over Pele's limit instead of freezing", async () => {
		const result = await renderDiagram(
			request(`flowchart TD\n${"  A --> B\n".repeat(6000)}`),
		);
		expect(result.ok).toBe(false);
	});

	it("caches a refusal, since it is a fact about the text", async () => {
		const req = request("flowchart TD\n  A[Start --> B");
		const first = await renderDiagram(req);
		expect(peekDiagram(req)).toBe(first);
	});
});

describe("the result cache", () => {
	it("answers a drawn diagram synchronously the second time", async () => {
		const req = request(DIAGRAM_SOURCES.state ?? "");
		expect(peekDiagram(req)).toBeUndefined();
		const drawn = await renderDiagram(req);
		expect(peekDiagram(req)).toBe(drawn);
	});

	it("keys on theme and width, so a change is a new drawing", async () => {
		const source = DIAGRAM_SOURCES.state ?? "";
		await renderDiagram(request(source, LIGHT, 340));
		expect(peekDiagram(request(source, DARK, 340))).toBeUndefined();
		expect(peekDiagram(request(source, LIGHT, 200))).toBeUndefined();
		// Layout jitter inside one bucket is the same drawing.
		expect(peekDiagram(request(source, LIGHT, 341))).toBeDefined();
	});
});

describe("what a block shows while a request is pending", () => {
	it("keeps the last drawing for the same source, and nothing for another", async () => {
		const source = DIAGRAM_SOURCES.flowchart ?? "";
		const first = request(source, LIGHT);
		const settled = { request: first, result: await renderDiagram(first) };
		const next = request(source, DARK);
		// A theme change: nothing cached for the new request yet.
		expect(peekDiagram(next)).toBeUndefined();
		expect(currentResult(undefined, settled, source)).toBe(settled.result);
		// Another diagram in a reused row must not borrow it.
		expect(
			currentResult(undefined, settled, "flowchart LR\n  X --> Y"),
		).toBeNull();
		expect(currentResult(undefined, null, source)).toBeNull();
	});

	it("prefers a cached drawing to a settled one", async () => {
		const source = DIAGRAM_SOURCES.state ?? "";
		const cached = await renderDiagram(request(source));
		const stale = { request: request(source, DARK), result: cached };
		expect(currentResult(cached, stale, source)).toBe(cached);
	});
});

describe("a diagram too big for a native surface", () => {
	it("is refused with its size, and the block falls back to code", async () => {
		const chain = `flowchart TD\n${Array.from({ length: 100 }, (_, i) => `  N${i} --> N${i + 1}`).join("\n")}`;
		const result = await renderDiagram(request(chain));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("invalid");
			expect(result.message).toContain("Too large to draw");
		}
	});

	it("still draws a 50-node chain", async () => {
		const chain = `flowchart TD\n${Array.from({ length: 50 }, (_, i) => `  N${i} --> N${i + 1}`).join("\n")}`;
		const result = await renderDiagram(request(chain));
		expect(result.ok).toBe(true);
	});
});

describe("hostile diagrams (transcripts are model-written)", () => {
	it("never lets a handler, script, link or URL reach the drawn tree", async () => {
		for (const [name, source] of Object.entries(HOSTILE_SOURCES)) {
			const result = await renderDiagram(request(source));
			if (!result.ok) continue; // refusing is a safe outcome
			expectInert(result.prepared.root);
			walk(
				result.prepared.root,
				(node) => {
					for (const key of Object.keys(node.props)) {
						expect(key.startsWith("on"), `${name} ${key}`).toBe(false);
						expect(key, name).not.toMatch(LINK_PROP);
					}
				},
				() => undefined,
			);
		}
	});

	it("never turns label markup into elements or leaves it in the text", async () => {
		const result = okOrThrow(
			await renderDiagram(request(HOSTILE_SOURCES.imgOnerror ?? "")),
		);
		const texts: string[] = [];
		walk(
			result.prepared.root,
			() => undefined,
			(value) => texts.push(value),
		);
		// Pele reads a label's markup as markup and draws only what is left of it;
		// either way nothing tag-shaped reaches the tree.
		expect(texts.join("|")).not.toContain("<");
		expectInert(result.prepared.root);
	});

	it("refuses a style that carries a URL, and the block falls back to code", async () => {
		for (const name of ["styleInjection", "styleBackgroundUrl"]) {
			const result = await renderDiagram(request(HOSTILE_SOURCES[name] ?? ""));
			expect(result.ok, name).toBe(false);
			if (!result.ok) {
				expect(result.reason).toBe("invalid");
				expect(result.message.length).toBeGreaterThan(0);
			}
		}
	});

	it("survives hostile SVG even if Pele ever emitted it", () => {
		const evil = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50" onload="alert(1)" style="fill:url(javascript:alert(1))">
  <script>alert(1)</script>
  <style>*{fill:red}</style>
  <foreignObject x="0" y="0" width="10" height="10"><body onload="alert(2)"/></foreignObject>
  <a href="javascript:alert(3)"><rect x="0" y="0" width="10" height="10" fill="red"/></a>
  <image href="https://evil.example/p.png" width="10" height="10"/>
  <use href="#x"/>
  <g onclick="alert(4)" fill="url(#p)" stroke="javascript:alert(5)">
    <rect onmouseover="alert(6)" x="1" y="1" width="5" height="5" fill="#ff0000" id="x" href="javascript:alert(7)"/>
    <path d="M0,0L10,10 alert(8)" stroke="red"/>
    <text x="5" y="5" font-family="Arial; background:url(x)" fill="#00ff00">hi <tspan x="6">there</tspan></text>
    <rect x="0" y="0" width="5" height="5" style="fill:#00f;background:url(https://evil.example)" transform="translate(1,2) alert(9)"/>
  </g>
</svg>`;
		const prepared = prepareDiagramSvg(evil, {
			theme: LIGHT,
			fontSize: 14,
		});
		const { tags } = surveyTree(prepared.root);
		expect([...tags].sort()).toEqual([
			"g",
			"path",
			"rect",
			"svg",
			"text",
			"tspan",
		]);
		expectInert(prepared.root);
		const rects: SvgNode[] = [];
		walk(prepared.root, (node) => {
			if (node.tag === "rect") rects.push(node);
		});
		// The red rect inside the dropped <a> is gone; the two in the group stay,
		// each with only its safe attributes.
		expect(rects).toHaveLength(2);
		expect(rects[0]?.props.fill).toBe("#ff0000");
		expect(rects[1]?.props.transform).toBeUndefined();
		expect(rects[1]?.props.fill).toBe("#00f");
		expect(prepared.root.props.fill).toBeUndefined();
		const paths: SvgNode[] = [];
		walk(prepared.root, (node) => {
			if (node.tag === "path") paths.push(node);
		});
		expect(paths[0]?.props.d).toBeUndefined();
	});

	const bad: [string, string][] = [
		[
			"a DOCTYPE with entities",
			'<!DOCTYPE svg [<!ENTITY x "y">]><svg width="1" height="1"/>',
		],
		["an unclosed element", '<svg width="1" height="1"><g></svg>'],
		["an unquoted attribute", "<svg width=1 height=1></svg>"],
		["CDATA", '<svg width="1" height="1"><![CDATA[x]]></svg>'],
		["no size", "<svg></svg>"],
		["a non-svg root", '<html width="1" height="1"/>'],
		["two roots", '<svg width="1" height="1"/><svg width="1" height="1"/>'],
	];
	for (const [name, svg] of bad) {
		it(`refuses ${name}`, () => {
			const options: PrepareOptions = { theme: LIGHT, fontSize: 14 };
			expect(() => prepareDiagramSvg(svg, options)).toThrow(DiagramSvgError);
		});
	}

	describe("adversarial values stay linear", () => {
		const prepare = (svg: string) => {
			const started = performance.now();
			let outcome: "drawn" | "refused" = "drawn";
			try {
				prepareDiagramSvg(svg, { theme: LIGHT, fontSize: 14 });
			} catch {
				outcome = "refused";
			}
			return { outcome, ms: performance.now() - started };
		};

		it("a 49,000-digit length", () => {
			const digits = `${"1".repeat(49_000)}z`;
			const run = prepare(
				`<svg width="10" height="10"><rect x="${digits}" style="stroke-width:${digits}" width="1" height="1"/></svg>`,
			);
			expect(run.outcome).toBe("drawn");
			// Was 1.7 s (quadratic) before the digit patterns stopped overlapping.
			expect(run.ms).toBeLessThan(250);
		});

		it("a transform of repeated terms and spaces", () => {
			const terms = `${"translate(1)  ".repeat(60)}x`;
			const run = prepare(
				`<svg width="10" height="10"><g transform="${terms}"/></svg>`,
			);
			expect(run.ms).toBeLessThan(250);
		});

		it("a chain of variables that each name the next many times", () => {
			// Each level repeats the one below twelve times: 12^8 expansions if walked
			// naively, 8 once the settled value is remembered.
			const levels = ["--_v0:#112233"];
			for (let level = 1; level <= 8; level += 1) {
				const below = `var(--_v${level - 1})`;
				levels.push(`--_v${level}:${Array(12).fill(below).join(" ")}`);
			}
			const run = prepare(
				`<svg width="10" height="10" style="${levels.join(";")}"><rect fill="var(--_v1)" width="1" height="1"/></svg>`,
			);
			expect(run.outcome).toBe("drawn");
			expect(run.ms).toBeLessThan(250);
			const deep = prepare(
				`<svg width="10" height="10" style="${levels.join(";")}"><rect fill="var(--_v8)" width="1" height="1"/></svg>`,
			);
			expect(deep.ms).toBeLessThan(250);
		});
	});

	it("does not read inherited object keys as attributes or entities", () => {
		const prepared = prepareDiagramSvg(
			'<svg width="10" height="10"><rect constructor="1" toString="2" __proto__="3" x="1" y="1" width="2" height="2"/><text x="1" y="1">a&constructor;b&toString;c</text></svg>',
			{ theme: LIGHT, fontSize: 14 },
		);
		const rect = prepared.root.children.find(
			(child): child is SvgNode =>
				typeof child !== "string" && child.tag === "rect",
		);
		expect(Object.keys(rect?.props ?? {}).sort()).toEqual([
			"height",
			"width",
			"x",
			"y",
		]);
		const text = prepared.root.children.find(
			(child): child is SvgNode =>
				typeof child !== "string" && child.tag === "text",
		);
		expect(text?.children).toEqual(["a&constructor;b&toString;c"]);
	});

	it("keeps only a viewBox of four real numbers", () => {
		for (const box of ["1 1 1 1.2.3", "0 0 10", "a b c d", "0 0 -- 5"]) {
			const prepared = prepareDiagramSvg(
				`<svg width="10" height="10" viewBox="${box}"/>`,
				{ theme: LIGHT, fontSize: 14 },
			);
			expect(prepared.root.props.viewBox).toBe("0 0 10 10");
		}
	});

	it("bounds nesting and size", () => {
		const options: PrepareOptions = { theme: LIGHT, fontSize: 14 };
		const deep = `<svg width="1" height="1">${"<g>".repeat(80)}${"</g>".repeat(80)}</svg>`;
		expect(() => prepareDiagramSvg(deep, options)).toThrow(DiagramSvgError);
		const wide = `<svg width="1" height="1">${"<g/>".repeat(41_000)}</svg>`;
		expect(() => prepareDiagramSvg(wide, options)).toThrow(DiagramSvgError);
	});

	it("refuses a theme value that is not a plain value", () => {
		expect(() =>
			prepareDiagramSvg('<svg width="1" height="1"/>', {
				theme: { "--pele-bg": "url(javascript:alert(1))" },
				fontSize: 14,
			}),
		).toThrow(DiagramSvgError);
	});
});
