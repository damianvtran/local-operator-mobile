import { describe, expect, it, vi } from "vitest";
import {
	avatarFailure,
	avatarKey,
	createAvatarCache,
	endpointAvatarKey,
} from "@/team-bridge/avatars";
import {
	registerTeamBridgeRetirement,
	retireTeamBridgeDevice,
	retireTeamBridgeScope,
} from "@/team-bridge/retirement";

const HASH = "0123456789abcdef";
const URI = "data:image/png;base64,RETIRED_FIXTURE";

describe("merged photo and sign-out retirement boundary", () => {
	it("fences active/queued endpoint results before awaiting device cleanup", async () => {
		const avatars = createAvatarCache({ maxEntries: 1 });
		let finishPhoto!: (value: string) => void;
		let finishPush!: () => void;
		const pending = avatars.loadEndpoint(
			endpointAvatarKey("bep_first", HASH, 64),
			() =>
				new Promise((resolve) => {
					finishPhoto = resolve;
				}),
			avatarFailure,
		);
		await Promise.resolve();
		const next = vi.fn(async () => URI);
		const queued = avatars.loadEndpoint(
			endpointAvatarKey("bep_next", HASH, 64),
			next,
			avatarFailure,
		);
		const pushes = {
			retire: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						finishPush = resolve;
					}),
			),
		};
		const unregister = registerTeamBridgeRetirement(() =>
			retireTeamBridgeScope({ avatars, pushes }),
		);
		const epoch = avatars.epoch;
		const retiring = retireTeamBridgeDevice();
		try {
			// This is the real registered callback, not a later React effect or
			// an unmount. No push/network completion is necessary to withdraw URI
			// authority from a provider still mounted during durable retirement.
			expect(avatars.epoch).toBe(epoch + 1);
			expect(pushes.retire).toHaveBeenCalledOnce();
			finishPhoto(URI);
			expect(await pending).toBeNull();
			expect(await queued).toBeNull();
			expect(next).not.toHaveBeenCalled();
			expect(avatars.stats()).toEqual({ entries: 0, bytes: 0 });
		} finally {
			finishPhoto(URI);
			finishPush();
			await retiring;
			unregister();
		}
	});
	it("clears held account bytes even if device deletion fails", async () => {
		const avatars = createAvatarCache();
		const key = avatarKey("acct_owner", HASH, 64);
		await avatars.load(key, async () => URI, avatarFailure);
		const pushes = {
			retire: vi.fn(async () => {
				throw new Error("Fixture registry unavailable");
			}),
		};
		const unregister = registerTeamBridgeRetirement(() =>
			retireTeamBridgeScope({ avatars, pushes }),
		);
		try {
			await retireTeamBridgeDevice();
			expect(avatars.peek(key)).toBeNull();
			expect(avatars.stats()).toEqual({ entries: 0, bytes: 0 });
		} finally {
			unregister();
		}
	});
});
