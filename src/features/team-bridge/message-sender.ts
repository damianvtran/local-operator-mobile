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
	) => Promise<Message>;
	adopt: (conversation: Conversation) => void;
	isCurrent: () => boolean;
	clientRef?: () => string;
}) {
	let id = options.conversationId;
	let attempt: { body: string; ref: string } | null = null;
	let busy = false;
	return async (input: string) => {
		const body = input.trim();
		if (!body || busy || !options.isCurrent()) return false;
		busy = true;
		if (attempt?.body !== body)
			attempt = { body, ref: (options.clientRef ?? newClientRef)() };
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
			await options.send(options.tenantId, id, body, attempt.ref);
			attempt = null;
			return true;
		} finally {
			busy = false;
		}
	};
}
