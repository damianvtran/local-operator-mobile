import { useState } from "react";
import { Platform, Text, View } from "react-native";
import type { TranscriptFileRef } from "@/contracts";
import {
	downloadRetainedFile,
	saveRetainedFile,
} from "@/features/session/retained-file";
import { t } from "@/i18n";
import { type ImageBytes, isRelayError } from "@/relay";
import { transcriptFileId, transcriptFileSaveId } from "@/ui/a11y";
import { Button } from "@/ui/components/button";

/** The card's inline error. A genuine sign-in failure is already handled by the
 * phone's global auth path (it drops live state and asks to sign in again); the
 * card says only that the save failed rather than echoing the relay's raw,
 * untranslated `authentication required` (QA Q1). Operation-local remote errors
 * (peer 403, unsupported) keep their catalogue sentence via `displayableMessage`. */
export const fileSaveError = (cause: unknown): string =>
	isRelayError(cause) &&
	cause.kind !== "relay-unauthorized" &&
	cause.kind !== "radiant-login-required"
		? cause.displayableMessage
		: t("mobile.remote_sessions.file_save_failed");

export function TranscriptFiles({
	entryId,
	files,
	load,
}: {
	entryId: string;
	files: TranscriptFileRef[];
	load: (entry: string, index: number) => Promise<ImageBytes>;
}) {
	return (
		<View className="gap-2 px-4 pb-2">
			{files.map((file) => (
				<RetainedFileRow
					key={file.index}
					entryId={entryId}
					file={file}
					load={load}
				/>
			))}
		</View>
	);
}

function RetainedFileRow({
	entryId,
	file,
	load,
}: {
	entryId: string;
	file: TranscriptFileRef;
	load: (entry: string, index: number) => Promise<ImageBytes>;
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const save = async () => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await downloadRetainedFile(load, entryId, file, (bytes, name, mime) =>
				saveRetainedFile(bytes, name, mime, Platform.OS),
			);
		} catch (cause) {
			setError(fileSaveError(cause));
		} finally {
			setSaving(false);
		}
	};
	return (
		<View
			className="gap-1 rounded-sm border border-hairline bg-elevated p-3"
			testID={transcriptFileId(entryId, file.index)}
		>
			<Text className="text-body text-ink" numberOfLines={2}>
				{file.filename}
			</Text>
			<Text className="text-meta text-ink-dim">{file.mime_type}</Text>
			<Button
				label={
					saving
						? t("mobile.remote_sessions.file_saving")
						: t("mobile.common.save")
				}
				/* Several files in one turn must not read "Save, Save, Save" to a
				 *  screen reader (D4/U6): the name carries the file. */
				accessibilityLabel={t("mobile.remote_sessions.file_save_label", {
					name: file.filename,
				})}
				disabled={saving}
				variant="outline"
				testID={transcriptFileSaveId(entryId, file.index)}
				onPress={() => {
					void save();
				}}
			/>
			{error ? (
				<Text accessibilityRole="alert" className="text-body-sm text-danger">
					{error}
				</Text>
			) : null}
		</View>
	);
}
