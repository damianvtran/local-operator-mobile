import Notifications from "@/features/notifications/notifications";

/**
 * `/notifications` — the inbox: open asks pinned, updates grouped by time, and
 * the explicit read/dismiss acts. The route file is the wiring and nothing else:
 * composition lives in `src/features/`, so a route's export surface stays the
 * router's.
 */
export default Notifications;
