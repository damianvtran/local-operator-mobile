/** Native IO is lazy so web/FOSS binaries without the module never advertise
 * readiness. Android MUST publish to MediaStore: Expo's channel resolver only
 * reads res/raw and SystemUI cannot read an app-private file:// URL. iOS uses
 * Library/Sounds, where UNNotificationSound searches before the app bundle.
 * Native inventory verifies bytes on every launch, not just index presence. */
import { Platform } from "react-native";
import { customSoundStem, type SoundCacheDisk } from "./custom-sound-cache";

interface NativeSoundStore extends Omit<SoundCacheDisk, "commit"> {
	available(): Promise<boolean>;
	install(sha: string, stage: string, used: number): Promise<void>;
}

export async function openSoundDisk(): Promise<SoundCacheDisk | null> {
	if (Platform.OS !== "android" && Platform.OS !== "ios") return null;
	try {
		const { requireNativeModule } = await import("expo");
		const native = requireNativeModule<NativeSoundStore>(
			"LopNotificationSound",
		);
		if (!(await native.available())) return null;
		const { File, Paths } = await import("expo-file-system");
		return {
			inventory: () => native.inventory(),
			touch: (sha, used) => native.touch(sha, used),
			remove: (sha) => native.remove(sha),
			claims: () => native.claims(),
			claim: (scope, shas) => native.claim(scope, shas),
			async commit(sha, bytes, used) {
				// The serialized cache owner is the only staging writer. Native
				// accepts ONLY this cache filename and rechecks SHA before publish.
				const file = new File(Paths.cache, "lop-notification-sound-stage.wav");
				customSoundStem(sha);
				try {
					file.write(bytes);
					await native.install(sha, file.uri, used);
				} finally {
					if (file.exists) file.delete();
				}
			},
		};
	} catch {
		return null;
	}
}
