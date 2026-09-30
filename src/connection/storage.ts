/**
 * `expo-secure-store` reads and writes — the ONLY module that touches the
 * keystore.
 *
 * NOT IMPLEMENTED. The connection stream owns this file. The rule it exists to
 * hold is in docs/architecture.md: nothing else in the app imports
 * `expo-secure-store` directly, so "what is stored, and where" is one file to
 * audit rather than a search across screens.
 *
 * This shell does not store anything yet, deliberately: the theme preference is
 * not a secret and does not belong in the keystore, and persisting it needs a
 * storage decision (a preference store) that is not this stream's to make.
 */
export {};
