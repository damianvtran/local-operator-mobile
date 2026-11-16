import { afterEach, describe, expect, it, vi } from "vitest";
import { transcriptEntrySchema, transcriptFileRefSchema } from "@/contracts";
import { fixtureBody } from "@/testing/fixture-relay";
import {
	downloadRetainedFile,
	retainedFilename,
	saveRetainedFile,
} from "./retained-file";
import { isBlankAssistantEntry } from "./turn-condensing";

afterEach(() => vi.unstubAllGlobals());
const file = {
	index: 3,
	filename: "../../retained-notes.txt",
	mime_type: "text/plain",
	bytes: 5,
};
describe("sparse retained document references", () => {
	it("defaults older rows to no files and preserves a sparse block index, including file-only answers", () => {
		const sample = (
			fixtureBody("http/history-ok.json") as { entries: unknown[] }
		).entries[0];
		expect(transcriptEntrySchema.parse(sample).files).toEqual([]);
		const row = transcriptEntrySchema.parse({
			...(sample as object),
			kind: "assistant",
			text: "",
			files: [file],
		});
		expect(row.files).toEqual([file]);
		expect(isBlankAssistantEntry(row)).toBe(false);
		for (const index of [-1, 0.5])
			expect(
				transcriptFileRefSchema.safeParse({ ...file, index }).success,
			).toBe(false);
	});
	it("loads by row and sparse index, never a filename/path, and saves only returned bytes", async () => {
		const bytes = new TextEncoder().encode("proof");
		const load = vi.fn(async () => ({ bytes, mimeType: "text/plain" }));
		const save = vi.fn(async () => true);
		expect(await downloadRetainedFile(load, "owner-row", file, save)).toBe(
			true,
		);
		expect(load).toHaveBeenCalledExactlyOnceWith("owner-row", 3);
		expect(save).toHaveBeenCalledExactlyOnceWith(
			bytes,
			"retained-notes.txt",
			"text/plain",
		);
		expect(retainedFilename("C:\\private\\notes.txt\u0000")).toBe("notes.txt");
		expect(retainedFilename("..")).toBe("attachment");
	});
	it("keeps permission failures visible and never saves placeholder bytes", async () => {
		const refusal = new Error("synthetic owner refusal");
		const save = vi.fn(async () => true);
		await expect(
			downloadRetainedFile(
				async () => {
					throw refusal;
				},
				"row",
				file,
				save,
			),
		).rejects.toBe(refusal);
		expect(save).not.toHaveBeenCalled();
	});
	it("web download uses an opaque blob, a safe filename, and releases its object URL", async () => {
		const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
		const createObjectURL = vi.fn(() => "blob:synthetic-retained-file");
		const revokeObjectURL = vi.fn();
		vi.stubGlobal("document", {
			createElement: () => anchor,
			body: { appendChild: vi.fn() },
		});
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
		await downloadRetainedFile(
			async () => ({ bytes: new Uint8Array([1, 2]), mimeType: "text/html" }),
			"row",
			file,
			(bytes, name, mime) => saveRetainedFile(bytes, name, mime, "web"),
		);
		expect(anchor.href).toBe("blob:synthetic-retained-file");
		expect(anchor.download).toBe("retained-notes.txt");
		expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].type).toBe(
			"application/octet-stream",
		);
		expect(anchor.click).toHaveBeenCalledTimes(1);
		/* R1-3: revoked on a later task — Safari/Firefox can drop a download
		 *  whose URL is revoked in the click's own task. */
		expect(revokeObjectURL).not.toHaveBeenCalled();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(revokeObjectURL).toHaveBeenCalledWith(anchor.href);
	});
});
