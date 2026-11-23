import { describe, expect, it } from "vitest";

import {
	diagramLayout,
	isDiagramBlock,
	MAX_DRAWN_AREA_PT,
	MAX_DRAWN_SIDE_PT,
	MIN_DIAGRAM_SCALE,
	viewerScale,
	withinDrawBudget,
} from "@/features/session/diagram-source";
import { type Block, parseMarkdown } from "@/features/session/markdown";

type Code = Extract<Block, { kind: "code" }>;

const codeBlocks = (text: string): Code[] =>
	parseMarkdown(text).filter((block): block is Code => block.kind === "code");

describe("which fences draw as a diagram", () => {
	it("draws a closed mermaid fence", () => {
		const [block] = codeBlocks("```mermaid\nflowchart TD\n  A --> B\n```");
		expect(block && isDiagramBlock(block)).toBe(true);
	});

	it("accepts the language in any case", () => {
		const [block] = codeBlocks("```Mermaid\nflowchart TD\n  A --> B\n```");
		expect(block && isDiagramBlock(block)).toBe(true);
	});

	it("keeps every other language as code", () => {
		for (const language of ["", "ts", "mermaidjs", "sh", "json"]) {
			const [block] = codeBlocks(`\`\`\`${language}\nA --> B\n\`\`\``);
			expect(block && isDiagramBlock(block)).toBe(false);
		}
	});

	it("keeps an unterminated fence as plain code while it streams", () => {
		const [block] = codeBlocks("```mermaid\nflowchart TD\n  A --> B");
		expect(block?.unterminated).toBe(true);
		expect(block && isDiagramBlock(block)).toBe(false);
	});

	it("flips to a diagram on the frame that carries the closing fence", () => {
		const text = "Here:\n```mermaid\nflowchart TD\n  A --> B\n```\nDone.";
		// Every prefix up to and including the closing fence's first backtick
		// stays code; the full fence line is the frame that draws.
		const closeAt = text.indexOf("\n```\n") + 1;
		for (let end = 1; end < closeAt + 3; end += 1) {
			const frame = codeBlocks(text.slice(0, end))[0];
			if (frame) expect(isDiagramBlock(frame)).toBe(false);
		}
		const done = codeBlocks(text.slice(0, closeAt + 3))[0];
		expect(done && isDiagramBlock(done)).toBe(true);
	});

	it("does not mark a closed fence as unterminated", () => {
		const [block] = codeBlocks("```ts\nconst a = 1;\n```");
		expect(block).toEqual({
			kind: "code",
			language: "ts",
			lines: ["const a = 1;"],
		});
	});

	it("takes only the diagram's own lines as its source", () => {
		const [block] = codeBlocks("```mermaid\nflowchart TD\n  A --> B\n```");
		expect(block?.lines.join("\n")).toBe("flowchart TD\n  A --> B");
	});
});

describe("fitting a diagram to the column", () => {
	it("draws at full size when it fits and never enlarges", () => {
		const layout = diagramLayout({ width: 200, height: 100 }, 340);
		expect(layout).toEqual({
			scale: 1,
			width: 200,
			height: 100,
			scrolls: false,
		});
	});

	it("shrinks to the column down to the floor", () => {
		const layout = diagramLayout({ width: 340, height: 200 }, 300);
		expect(layout.scale).toBeCloseTo(300 / 340, 5);
		expect(layout.width).toBeCloseTo(300, 5);
		expect(layout.scrolls).toBe(false);
	});

	it("keeps Pele's smallest labels readable at the floor", () => {
		// Pele's smallest labels are 12 pt at full size.
		expect(12 * MIN_DIAGRAM_SCALE).toBeGreaterThanOrEqual(10);
	});

	it("holds the floor and scrolls sideways beyond it", () => {
		const layout = diagramLayout({ width: 800, height: 400 }, 300);
		expect(layout.scale).toBe(MIN_DIAGRAM_SCALE);
		expect(layout.width).toBeCloseTo(680, 5);
		expect(layout.height).toBeCloseTo(340, 5);
		expect(layout.scrolls).toBe(true);
	});

	it("survives a column that has not been measured", () => {
		const layout = diagramLayout({ width: 300, height: 100 }, 0);
		expect(layout.scale).toBe(MIN_DIAGRAM_SCALE);
		expect(Number.isFinite(layout.width)).toBe(true);
	});
});

describe("the draw budget", () => {
	it("draws what real diagrams measure (Pele 1.13.0 at maxWidth 340)", () => {
		const measured = [
			{ width: 452, height: 385 }, // 10-node tree
			{ width: 1576, height: 466 }, // 30-node tree
			{ width: 3210, height: 547 }, // 60-node tree
			{ width: 78, height: 4620 }, // 50-node chain
			{ width: 2442, height: 836 }, // 80-node random graph
		];
		for (const size of measured) expect(withinDrawBudget(size, 322)).toBe(true);
	});

	it("refuses what a native view cannot hold", () => {
		const hostile = [
			{ width: 78, height: 5827 }, // 62-node chain, drawn at scale 1
			{ width: 78, height: 9268 }, // 100-node chain
			{ width: 5388, height: 628 }, // 100-node tree
			{ width: 137, height: 55_768 }, // 600-node chain
			{ width: 6865, height: 14_137 }, // 200 random nodes
			{ width: Number.POSITIVE_INFINITY, height: 10 },
			{ width: Number.NaN, height: 10 },
		];
		for (const size of hostile) expect(withinDrawBudget(size, 322)).toBe(false);
	});

	it("never lets the viewer exceed the budget either", () => {
		for (const size of [
			{ width: 100, height: 100 },
			{ width: 1576, height: 466 },
			{ width: 78, height: 4620 },
			{ width: 2442, height: 836 },
		]) {
			const scale = viewerScale(size, 390);
			expect(size.width * scale * size.height * scale).toBeLessThanOrEqual(
				MAX_DRAWN_AREA_PT + 1,
			);
			expect(Math.max(size.width, size.height) * scale).toBeLessThanOrEqual(
				MAX_DRAWN_SIDE_PT + 1,
			);
		}
	});
});

describe("the viewer's scale", () => {
	it("fits the window's width, up to 3x", () => {
		expect(viewerScale({ width: 100, height: 100 }, 390)).toBe(3);
		expect(viewerScale({ width: 300, height: 100 }, 390)).toBeCloseTo(
			(390 - 32) / 300,
			5,
		);
	});

	it("opens a wide diagram at full size to pan, never below", () => {
		expect(viewerScale({ width: 2000, height: 400 }, 390)).toBe(1);
	});
});

describe("the budget holds at the scale the layout uses", () => {
	it("agrees with diagramLayout for narrow and wide diagrams", () => {
		for (const size of [
			{ width: 78, height: 4620 },
			{ width: 78, height: 5827 },
			{ width: 3210, height: 547 },
			{ width: 5388, height: 628 },
		]) {
			const layout = diagramLayout(size, 322);
			const fits =
				layout.height <= MAX_DRAWN_SIDE_PT &&
				layout.width <= MAX_DRAWN_SIDE_PT &&
				layout.width * layout.height <= MAX_DRAWN_AREA_PT;
			expect(withinDrawBudget(size, 322), JSON.stringify(size)).toBe(fits);
		}
	});
});
