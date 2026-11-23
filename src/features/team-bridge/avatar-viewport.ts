/** Pure viewport geometry and scroll notifications shared by drawer and rows. */
export type AvatarViewportBox = { y: number; width: number; height: number };

/** Use the clipping view in window coordinates, not the device window: rows
 * under drawer chrome are not visible. No overscan means no speculative reads. */
export function inAvatarViewport(
	row: AvatarViewportBox,
	viewport: AvatarViewportBox,
): boolean {
	return (
		row.width > 0 &&
		row.height > 0 &&
		viewport.width > 0 &&
		viewport.height > 0 &&
		row.y + row.height > viewport.y &&
		row.y < viewport.y + viewport.height
	);
}

export type ViewportSignal = {
	subscribe: (listener: () => void) => () => void;
	emit: () => void;
};

export function createViewportSignal(): ViewportSignal {
	const listeners = new Set<() => void>();
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		emit() {
			for (const listener of [...listeners]) listener();
		},
	};
}
