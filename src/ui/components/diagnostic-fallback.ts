/**
 * What the refusal surface's "Show details" reveals when no detail was passed:
 * the error class and kind, as `src/features/auth/refusal.ts` composes them when
 * the error carries no kind of its own.
 *
 * Deliberately NOT in the catalogue: it is a developer diagnostic token a reader
 * quotes back in a bug report, and a translated copy would no longer match the
 * code that raised it.
 *
 * WHY ITS OWN MODULE (#257 review N2). The surface and the feature each held a
 * copy of this string, free to drift apart. It cannot live in the feature (the
 * design system must not import from the feature layer — see
 * `refusal-surface.tsx`'s header), and it cannot live in `refusal-surface.tsx`
 * either: `refusal.ts` imports only a TYPE from there today, and a value import
 * would drag the surface's native-only dependencies (`lucide-react-native`) into
 * every Node test and probe that loads `refusal.ts`. A dependency-free module is
 * the one place both can import.
 */
export const DIAGNOSTIC_FALLBACK = "RelayError · connection-response";
