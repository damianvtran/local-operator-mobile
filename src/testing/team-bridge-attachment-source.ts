import type { RawImage } from "@/features/team-bridge/attachment-source";
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";

/** Known synthetic 24×16 PNG, never operator media. This replaces ONLY acquisition:
 * the normal manipulator, byte limits, draft, upload and UI still run. It proves
 * web pick/paste flows, not native permissions, picker behaviour or EXIF removal.
 * Both the existing build/platform/loopback guard and an explicit source opt-in
 * are required; a production URL cannot turn this adapter on.
 */
export function syntheticAttachmentSource(): RawImage | null {
	const fixture = teamBridgeFixture();
	if (!fixture?.world.split("~")[0]?.startsWith("attachments")) return null;
	if (new URLSearchParams(location.search).get("tb-source") !== "synthetic")
		return null;
	return {
		uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAGklEQVR4nGMw6rlEFcQwatCoQaMGjRpEGQIAJLhYH7OKJGgAAAAASUVORK5CYII=",
		width: 24,
		height: 16,
		isPng: true,
	};
}
