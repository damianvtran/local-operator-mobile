import { Pressable, Text } from "react-native";
import type { StatusTrayFacts } from "@/features/session/components/status-tray";
import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { ChromeGroup, ChromeSurface } from "@/ui/components/chrome-surface";
import { TOUCH_FLOOR } from "@/ui/layout";

/* Its own module, not `status-tray.tsx`: this one reaches the native glass
 * module, and `status-tray.tsx`'s summary is unit-tested in Node, where a
 * native import cannot load (`vitest.config.ts`). */

/**
 * The phone's status, as the relay draws it (decision record 2026-11-04 §2.2,
 * D-S3): `Tasks 10/11` and `Agents 1/57` capsules ABOVE the composer, each
 * opening the status sheet. The under-header tray row ("running hub · 1/1
 * agents · 10% context ›") crowded a header that was already crunched; the
 * relay distributes the same facts — state in the header subtitle, these
 * chips by the thumb, context % on the composer's meta line.
 *
 * Geometry: a 44 pt band (each capsule's TARGET is 44, its paint 36), `gap-2`;
 * the host slot's `px-2` aligns the first capsule's edge with the composer's
 * 8 pt margin. Glass on iOS 26 inside one `GlassContainer`, so the
 * capsules merge as one material; solid `elevated` capsules otherwise.
 * Absent when there is nothing to count: the band then costs nothing.
 */
export const StatusChips = ({
	facts,
	onOpen,
	glass,
}: {
	facts: StatusTrayFacts;
	onOpen: (panel: "todos" | "subagents") => void;
	glass: boolean;
}) => {
	const tasks =
		facts.tasks !== null && facts.tasks.total > 0 ? facts.tasks : null;
	const agents =
		facts.agents !== null && facts.agents.total > 0 ? facts.agents : null;
	if (tasks === null && agents === null) return null;
	const chip = (
		label: string,
		panel: "todos" | "subagents",
		testID: string,
	) => (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={label}
			accessibilityHint={t("mobile.session.status_tray.hint")}
			onPress={() => onOpen(panel)}
			testID={testID}
			className="justify-center"
			style={{ minHeight: TOUCH_FLOOR }}
		>
			<ChromeSurface
				glass={glass}
				radii={{ top: CHIP_RADIUS, bottom: CHIP_RADIUS }}
				className="h-9 flex-row items-center px-3"
			>
				<Text className="text-meta text-ink-muted" numberOfLines={1}>
					{label}
				</Text>
			</ChromeSurface>
		</Pressable>
	);
	return (
		<ChromeGroup glass={glass} className="flex-row items-center gap-2">
			{tasks !== null
				? chip(
						t("relay.chrome.session.tray.tasks", {
							done: tasks.total - tasks.open,
							total: tasks.total,
						}),
						"todos",
						CONTROL.sessionTasksChip,
					)
				: null}
			{agents !== null
				? chip(
						t("relay.chrome.session.tray.agents", {
							running: agents.running,
							total: agents.total,
						}),
						"subagents",
						CONTROL.sessionAgentsChip,
					)
				: null}
		</ChromeGroup>
	);
};

/** A capsule: half of its 36 pt paint height (`radius.full` in spirit, as a
 *  number because the glass view takes its radii as props). */
const CHIP_RADIUS = 18;
