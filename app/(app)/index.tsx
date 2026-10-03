import Home from "@/features/home/home";

/**
 * `/` is the composer home — the default destination ADR 0006 § 6 records.
 * The route file is the wiring and nothing else: composition lives in
 * `src/features/`, so a route's export surface stays the router's.
 */
export default Home;
