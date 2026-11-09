/** Debug simulator only. Release Metro removes this block even if a CI job
 * accidentally supplies the variable. A URL/deep link can never enable it. */
export function debugOAuthProofOrigin(): string | undefined {
	if (typeof __DEV__ !== "undefined" && __DEV__) {
		const value = process.env.EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN;
		if (!value) return undefined;
		try {
			const url = new URL(value);
			if (
				url.protocol === "http:" &&
				url.hostname === "127.0.0.1" &&
				url.port &&
				url.pathname === "/" &&
				!url.username &&
				!url.password &&
				!url.search &&
				!url.hash
			)
				return url.origin;
		} catch {
			/* Invalid debug setup must never redirect authentication. */
		}
	}
	return undefined;
}
