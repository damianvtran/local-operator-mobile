/** Model-authored links are untrusted. Keep the relay's HTTP(S)-only policy,
 * not desktop's local-file/app actions: those target the computer,
 * not this phone. Validate again at activation, not only while styling text.
 * No HTML/entity decoding occurs here; a disguised scheme never gains a handler.
 */
const PUBLIC_SCHEME = /^https?:\/\//i;

export function safeMarkdownHref(value: string): string | null {
	if (
		[...value].some(
			(char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
		)
	)
		return null;
	if (!PUBLIC_SCHEME.test(value)) return null;
	try {
		const url = new URL(value);
		if (
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.hostname &&
			!url.username &&
			!url.password
		)
			return value;
	} catch {
		/* Incomplete streamed destinations remain non-interactive text. */
	}
	return null;
}

/** Injection keeps the policy testable without importing a native host. Failed
 * platform handoffs do not become unhandled rejections in a streaming row. */
export async function openMarkdownLink(
	value: string,
	open: (url: string) => Promise<unknown>,
): Promise<boolean> {
	const href = safeMarkdownHref(value);
	if (!href) return false;
	try {
		await open(href);
		return true;
	} catch {
		return false;
	}
}
