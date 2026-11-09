/**
 * One running loop for many users: started by the first, stopped by the last.
 *
 * Exists for animations that are identical across instances — the skeleton's
 * pulse is the case (`components/skeleton.tsx`, performance audit P6) — where
 * one loop per instance multiplies a cost that buys nothing and lets the
 * instances drift out of phase. Kept free of `react-native` so the counting,
 * which is the only part that can be wrong, is a unit test in Node.
 *
 * `retain` returns its own release, and a release is idempotent: an effect
 * cleanup that runs twice (a strict-mode double invoke, a fast refresh) must
 * not stop a loop other mounted instances still depend on.
 */
export const createSharedLoop = (driver: {
	start: () => void;
	stop: () => void;
}): { retain: () => () => void; users: () => number } => {
	let users = 0;
	return {
		retain: () => {
			users += 1;
			if (users === 1) driver.start();
			let released = false;
			return () => {
				if (released) return;
				released = true;
				users -= 1;
				if (users === 0) driver.stop();
			};
		},
		users: () => users,
	};
};
