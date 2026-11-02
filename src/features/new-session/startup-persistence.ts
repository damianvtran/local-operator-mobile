export interface RevisionFiles {
	list(): Promise<string[]>;
	read(name: string): Promise<string | null>;
	write(name: string, value: string): Promise<void>;
	move(from: string, to: string): Promise<void>;
	remove(name: string): Promise<void>;
}
/** Expo's overwrite move deletes the destination first on iOS. Instead, commit
 * to a NEW numbered filename: the previous committed bytes are never modified.
 * A partial pending write is invisible; a malformed committed latest version is
 * a hard refusal, never rollback to an earlier state that might repeat work.
 * The coordinator serializes calls. Keep the last committed version while
 * pruning predecessors BEFORE the next commit, bounding disk use to two copies. */
export class RevisionStore {
	constructor(private readonly files: RevisionFiles) {}
	private async versions() {
		return (await this.files.list())
			.filter((name) => /^\d{12}\.json$/.test(name))
			.sort();
	}
	async get(): Promise<string | null> {
		const latest = (await this.versions()).at(-1);
		if (!latest) return null;
		const raw = await this.files.read(latest);
		if (raw === null) throw new Error("committed startup revision is missing");
		const saved: unknown = JSON.parse(raw);
		if (
			typeof saved !== "object" ||
			saved === null ||
			!("value" in saved) ||
			typeof saved.value !== "string"
		)
			throw new Error("committed startup revision is corrupt");
		return saved.value;
	}
	async set(value: string): Promise<void> {
		const versions = await this.versions();
		const latest = versions.at(-1);
		// Refuse to write over an unreadable committed history.
		if (latest) await this.get();
		for (const name of await this.files.list()) {
			if (
				name !== latest &&
				(versions.includes(name) || name.endsWith(".pending"))
			)
				await this.files.remove(name);
		}
		const revision = Number(latest?.slice(0, 12) ?? "0") + 1;
		if (revision > 999_999_999_999)
			throw new Error("startup revision capacity reached");
		const name = String(revision).padStart(12, "0");
		await this.files.write(
			`${name}.pending`,
			JSON.stringify({ version: 1, value }),
		);
		await this.files.move(`${name}.pending`, `${name}.json`);
	}
}
