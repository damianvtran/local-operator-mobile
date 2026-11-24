/**
 * A community member's avatar: one component for every place a member is
 * shown — message authors, People rows, DM requests and the profile card
 * (design review round 1, D1). Before this, only the profile card drew one, so
 * a conversation was a column of names and every People row the same glyph.
 *
 * WHAT IT DRAWS, AND WHY NOT A PHOTO YET. The contract's only avatar is
 * `avatar_asset_id`, fetched through the assets proxy (`getAsset`), which is
 * `x-status: planned` and serves approved bytes only, never a public URL. The
 * `Avatar` primitive also refuses remote URLs (an unauthenticated fetch). So
 * until the proxy ships this draws, in order:
 *
 * - an agent: the agent glyph (an agent is a different kind of identity, the
 *   Team Bridge convention in `profile-card.tsx`);
 * - a pending member (the server's "New member · NNNN" placeholder): the
 *   default mark, not "NM" initials (D9);
 * - anyone else: their mark (`memberMarkOf`): Latin initials as before, else
 *   the first grapheme of a name in any script (D11, round 2), else the
 *   default mark — never "?".
 *
 * When the proxy ships, read the bytes with the community bearer into a
 * `data:` URI (the `team-bridge/avatars.ts` pattern) and pass it as
 * `imageUri`; the initials stay painted underneath, so nothing else changes.
 */
import { Bot, UserRound } from "lucide-react-native";
import { isPlaceholderName } from "@/community/model";
import { useTokenColor } from "@/ui/appearance";
import { Avatar } from "@/ui/components/avatar";
import { AVATAR_SIZES, type AvatarSize } from "@/ui/variants";
import { memberMarkOf } from "./member-mark";

export function MemberAvatar({
	name,
	kind = "human",
	size = "sm",
}: {
	name: string;
	kind?: "human" | "agent" | "former_member" | "system" | "deleted";
	size?: AvatarSize;
}) {
	const agentInk = useTokenColor("accent-active");
	const mutedInk = useTokenColor("ink-muted");
	const glyph = AVATAR_SIZES[size].px / 2;
	if (kind === "agent")
		return (
			<Avatar
				initials=""
				size={size}
				fallback={<Bot size={glyph} color={agentInk} />}
			/>
		);
	const mark = memberMarkOf(name);
	if (kind !== "human" || isPlaceholderName(name) || mark === null)
		return (
			<Avatar
				initials=""
				size={size}
				fallback={<UserRound size={glyph} color={mutedInk} />}
			/>
		);
	return <Avatar initials={mark} size={size} />;
}
