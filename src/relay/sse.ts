/**
 * The streaming reader: framing, and the reconnect discipline.
 *
 * NOT IMPLEMENTED. The protocol stream owns this file.
 *
 * What it has to do: the relay speaks HTTP + Server-Sent Events and never
 * WebSocket, pushes whole snapshots rather than deltas, and sits behind a gateway
 * that CUTS ANY STREAM AT 60 SECONDS. So "long-lived stream" is an illusion: the
 * client reopens and resyncs on the next snapshot, and a snapshot is accepted
 * only if it is the first of a connection or newer than what the store holds.
 *
 * Framing is `eventsource-parser` (pure TypeScript, no DOM), which is why that
 * dependency is in the shared set rather than a hand-rolled framer.
 */
export {};
