import type { StageBStep } from "./stage-b-draft-flows.ts";

/** Only adjacent UI operations coalesce. Callers MUST flush before changing the
 * fixture, process, storage observer or device. Those barriers are security
 * evidence boundaries, not optimisation opportunities. The YAML keeps the
 * complete ordered steps; only redundant driver startup/foreground is removed. */
export class StageBDriverBatch {
	private pending: { name: string; steps: StageBStep[] }[] = [];
	private acknowledgements: (() => void)[] = [];
	verified(record: () => void): void {
		if (this.pending.length) this.acknowledgements.push(record);
		else record();
	}
	readonly segments: { names: string[]; steps: number }[] = [];
	private readonly execute: (
		name: string,
		steps: StageBStep[],
		names: string[],
	) => Promise<void>;
	constructor(
		execute: (
			name: string,
			steps: StageBStep[],
			names: string[],
		) => Promise<void>,
	) {
		this.execute = execute;
	}
	add(name: string, steps: StageBStep[]): void {
		this.pending.push({ name, steps });
	}
	async flush(): Promise<void> {
		if (!this.pending.length) return;
		const pending = this.pending;
		this.pending = [];
		const acknowledge = this.acknowledgements;
		this.acknowledgements = [];
		const names = pending.map(({ name }) => name);
		const steps = pending.flatMap(({ steps }) => steps);
		// PHPicker is an out-of-process remote view. Run 41882974569 proved
		// a long-lived driver could not see it while a fresh driver could.
		// Split EVERY library presentation, even inside a combined caller flow;
		// keep acknowledgements behind all resulting segments, never the opener.
		const segments: StageBStep[][] = [];
		let current: StageBStep[] = [];
		for (const step of steps) {
			current.push(step);
			if (
				(step.tapOn as { id?: string } | undefined)?.id ===
				"attach-option-library"
			) {
				segments.push(current);
				current = [];
			}
		}
		if (current.length) segments.push(current);
		for (const segment of segments) {
			await this.execute(
				`segment-${this.segments.length + 1}-${names[0]}`,
				segment,
				names,
			);
			this.segments.push({ names, steps: segment.length });
		}
		for (const record of acknowledge) record();
	}
}
