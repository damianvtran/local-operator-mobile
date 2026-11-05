import type { StageBStep } from "./stage-b-draft-flows.ts";

/** Supplied ONLY for a connect flow whose row tap may be silently lost in
 * transit (run 42044812065: reported COMPLETED, never entered JavaScript). The
 * probe decides on positive same-process evidence; it must resolve, never throw,
 * and it is called at most once per batch. */
export interface StageBLostTapRetry {
	probe: () => Promise<{ allow: boolean; reason: string }>;
	record: (decision: { allow: boolean; reason: string }) => void;
}

/** Only adjacent UI operations coalesce. Callers MUST flush before changing the
 * fixture, process, storage observer or device. Those barriers are security
 * evidence boundaries, not optimisation opportunities. The YAML keeps the
 * complete ordered steps; only redundant driver startup/foreground is removed. */
export class StageBDriverBatch {
	private pending: {
		name: string;
		steps: StageBStep[];
		retry?: StageBLostTapRetry;
	}[] = [];
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
	add(name: string, steps: StageBStep[], retry?: StageBLostTapRetry): void {
		this.pending.push({ name, steps, retry });
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
		const bounds: { start: number; end: number; retry?: StageBLostTapRetry }[] =
			[];
		let cursor = 0;
		for (const entry of pending) {
			bounds.push({
				start: cursor,
				end: cursor + entry.steps.length,
				retry: entry.retry,
			});
			cursor += entry.steps.length;
		}
		const segments: { steps: StageBStep[]; start: number }[] = [];
		let current: StageBStep[] = [];
		let start = 0;
		for (const step of steps) {
			current.push(step);
			if (
				(step.tapOn as { id?: string } | undefined)?.id ===
				"attach-option-library"
			) {
				segments.push({ steps: current, start });
				start += current.length;
				current = [];
			}
		}
		if (current.length) segments.push({ steps: current, start });
		for (const segment of segments) {
			const label = `segment-${this.segments.length + 1}-${names[0]}`;
			try {
				await this.execute(label, segment.steps, names);
			} catch (error) {
				// A connect flow's tap can be lost in transit without any JS
				// callback. Retry ONLY on positive no-callback evidence, and only
				// when the failure belongs to that flow's own steps. Everything
				// succeeding in this segment proves the callback ran, so no tail
				// step may be replayed on a lossy gate.
				const bound = bounds.find(
					(item) =>
						item.retry &&
						item.start >= segment.start &&
						item.start < segment.start + segment.steps.length,
				);
				if (!bound?.retry) throw error;
				const decision = await bound.retry.probe();
				bound.retry.record(decision);
				if (!decision.allow) throw error;
				const end = segment.start + segment.steps.length;
				const entrySteps = steps.slice(bound.start, Math.min(bound.end, end));
				const retryLabel = `${label}-lost-tap-retry`;
				await this.execute(retryLabel, entrySteps, names);
				this.segments.push({ names, steps: entrySteps.length });
				const tail = steps.slice(Math.min(bound.end, end), end);
				if (tail.length) {
					await this.execute(`${label}-lost-tap-tail`, tail, names);
					this.segments.push({ names, steps: tail.length });
				}
				continue;
			}
			this.segments.push({ names, steps: segment.steps.length });
		}
		for (const record of acknowledge) record();
	}
}
