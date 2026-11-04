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
		await this.execute(
			`segment-${this.segments.length + 1}-${names[0]}`,
			steps,
			names,
		);
		this.segments.push({ names, steps: steps.length });
		for (const record of acknowledge) record();
	}
}
