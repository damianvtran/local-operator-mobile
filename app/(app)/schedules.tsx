import Schedules from "@/features/schedules/schedules";

/**
 * `/schedules` — what is armed on the machine: wakes and monitors, read from
 * the relay's derived indexes. The route file is the wiring and nothing else:
 * composition lives in `src/features/`, so a route's export surface stays the
 * router's.
 */
export default Schedules;
