import OwnTunnel from "@/features/auth/own-tunnel";

/**
 * `/custom` is the address-and-password screen's original URL (F-3), kept as an
 * alias so every existing link — the sign-in panel, a refusal surface, a deep
 * link — still lands on the guided flow rather than a second, thinner
 * implementation of it. `/own-tunnel` is the canonical URL; one screen serves both.
 */
export default OwnTunnel;
