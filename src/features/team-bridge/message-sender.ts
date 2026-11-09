import type { HubClient } from "@/team-bridge/client";
import type { Conversation, Message } from "@/team-bridge/contract";
import {
	draftCreateInput,
	newClientRef,
	type Target,
} from "@/team-bridge/model";

/** One mounted composer owns its acknowledged conversation and its pending send.
 * Keeping them outside render state closes the create→send failure window: React
 * may not have rendered the created id before the reader retries a failed send.
 */
export function createMessageSender(options: {
	tenantId: string;
	conversationId: string | null;
	target: Exclude<Target, { kind: "conversation" }> | null;
	create: HubClient["createConversation"];
	send: (
		tenantId: string,
		conversationId: string,
		body: string,
		clientRef: string,
		attachmentIds?: string[],
	) => Promise<Message>;
	adopt: (conversation: Conversation) => void;
	isCurrent: () => boolean;
	clientRef?: () => string;
}) {
	let id = options.conversationId;
	/*
	 * The idempotency key is reused only for the SAME payload. The hub compares
	 * `(body_hash, attachments_hash)` on a `client_ref` replay, so changing the
	 * text OR the image set must mint a new ref; reusing it would be refused as
	 * `client_ref_conflict` rather than sending the edited message.
	 */
	let attempt: { key: string; ref: string } | null = null;
	let busy = false;
	return async (input: string, attachmentIds: readonly string[] = []) => {
		const body = input.trim();
		const ids = [...attachmentIds];
		// Image-only is a valid message (`body: ""` with ids); nothing at all is not.
		if ((!body && ids.length === 0) || busy || !options.isCurrent())
			return false;
		busy = true;
		const key = JSON.stringify([body, ids]);
		if (attempt?.key !== key)
			attempt = { key, ref: (options.clientRef ?? newClientRef)() };
		try {
			if (!id) {
				if (!options.target) throw new Error("Choose a message recipient.");
				const conversation = await options.create({
					tenantId: options.tenantId,
					...draftCreateInput(options.target),
				});
				id = conversation.id;
				if (!options.isCurrent()) return false;
				options.adopt(conversation);
			}
			if (!options.isCurrent()) return false;
			// Text-only keeps the exact pre-attachments call; ids ride only when present.
			if (ids.length > 0)
				await options.send(options.tenantId, id, body, attempt.ref, ids);
			else await options.send(options.tenantId, id, body, attempt.ref);
			attempt = null;
			return true;
		} finally {
			busy = false;
		}
	};
}
