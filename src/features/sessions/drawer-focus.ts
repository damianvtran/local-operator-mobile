export type NewChatIntent = { current: boolean };

/** RN Web restores the modal trigger during its focus-trap unmount. A composer
 * focus requested on the first close frame loses to that restoration. Carry the
 * intent until onDismiss; do not delay native callers on an event Android lacks. */
export const requestDrawerNewChat = (
	platform: string,
	intent: NewChatIntent,
	close: () => void,
	newChat: () => void,
) => {
	if (platform === "web") {
		intent.current = true;
		close();
	} else {
		newChat();
	}
};

export const cancelDrawerNewChat = (intent: NewChatIntent) => {
	intent.current = false;
};

export const finishDrawerDismiss = (
	intent: NewChatIntent,
	newChat?: () => void,
) => {
	const requested = intent.current;
	cancelDrawerNewChat(intent);
	if (requested) newChat?.();
};
