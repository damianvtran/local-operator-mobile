import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { groupProjectsByStatus, type ProjectSummary } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	projectDisplayName,
	projectRefusalSentence,
	projectRowMeta,
	STALE_BADGE_LABEL,
	showsStaleMark,
} from "@/features/projects/projects-copy";
import { ProjectsStateMarkers } from "@/features/projects/projects-markers";
import { CONTROL, EMPTY, projectRowId, ROLE, SCREEN, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/empty-state";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Skeleton } from "@/ui/components/skeleton";

/**
 * Projects — the workstreams the relay's project store holds (S16, the read
 * path).
 *
 * WHAT THIS IS. A **screen**, not a sheet: the app has a router, so the listing
 * and one project's detail are two routes rather than two panels inside one
 * modal (the web client nests only because its sheet system draws one panel at a
 * time). The list pushes the detail; Back pops.
 *
 * READ-ONLY, DELIBERATELY. This slice ships no mutation: no create, no edit, no
 * delete, no milestone change, no link or unlink. A row is a link, not a control
 * with verbs. The relay's write routes and their refusals (`409
 * project_name_exists`, `409 project_schema_newer`, `422 project_invalid`, `422
 * project_confirm_mismatch`, `503 project_store_busy`, `400` for a non-object
 * body) belong to the slices that add those calls; the one refusal THIS path can
 * receive is the detail's `404 project_not_found`, and it is rendered verbatim
 * (see `projectRefusalSentence`).
 *
 * NOTHING IS DERIVED HERE. `progress_stale`, a milestone's status and the live
 * count all cross the wire computed by the relay, and the sections are the
 * relay's own `STATUS_RANK` order — the rows are bucketed, never re-sorted, so
 * the order the relay chose survives to the screen. The one client-side decision
 * is where a status this build does not know goes, and that is a trailing
 * section rather than a vanished row (`src/contracts/project-status.ts`).
 */
export default function Projects() {
	const router = useRouter();
	const { relay, refusal } = useConnection();

	const [rows, setRows] = useState<ProjectSummary[]>([]);
	const [loading, setLoading] = useState(true);
	/** The daemon's own sentence for a failed read, when it sent one. */
	const [refused, setRefused] = useState<string | null>(null);
	/** A read that failed without a sentence: a transport drop, which the
	 *  connection's own surface owns rather than this screen re-wording it. */
	const [unreachable, setUnreachable] = useState(false);

	const load = useCallback(async () => {
		const client = relay();
		if (!client) return;
		setLoading(true);
		setRefused(null);
		setUnreachable(false);
		try {
			const answer = await client.projects();
			setRows(answer.projects);
		} catch (error) {
			const sentence = projectRefusalSentence(error);
			if (sentence !== null) setRefused(sentence);
			else setUnreachable(true);
		} finally {
			setLoading(false);
		}
	}, [relay]);

	useEffect(() => {
		void load();
	}, [load]);

	const sections = groupProjectsByStatus(rows);
	const hasUnknownStatus = sections.some((section) => !section.known);
	const failed = refused !== null || unreachable;
	/* `!failed` is not decoration: the marker this drives is zero-height and aria-hidden
	 * (readiness reads it as a probe, not as content), and the audit's contract is that
	 * REFUSED and EMPTY are mutually exclusive by construction. Without it the unreachable
	 * arm renders `projects-empty` (DIV 358x0, aria-hidden) beside `project-refusal`, so a
	 * check that trusts the mutual exclusion is looking at a state that cannot exist. */
	const empty = !loading && !failed && sections.length === 0;

	return (
		<Screen
			title="Projects"
			testID={SCREEN.projects}
			headerLeading={
				<Button
					testID={CONTROL.projectsBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<ProjectsStateMarkers
				empty={empty}
				refused={failed}
				unknownStatus={hasUnknownStatus}
			/>

			{/* The connection's own refusal, when the failure is the connection's: its
			 *  taxonomy names a cause and a remedy, and this screen has nothing to add
			 *  to that. */}
			{refusal !== null ? (
				<RefusalSurface
					kind={refusal.kind}
					subject={refusal.subject}
					detail={refusal.detail}
					remedy={refusal.remedy}
					retryAfterMs={refusal.retryAfterMs}
					onRetry={() => void load()}
					onUseAnotherAddress={() => router.push("/custom")}
				/>
			) : loading && rows.length === 0 ? (
				<Skeleton lines={4} testID={SURFACE.projectsLoading} />
			) : refused !== null ? (
				/* The daemon's sentence, verbatim and never re-worded — the same rule
				 *  the session list's refusals follow. A `404 project_not_found` carries
				 *  the reader a near-miss name, which is the whole reason the relay
				 *  writes the sentence itself. */
				<View className="gap-3">
					<Alert severity="error" testID={SURFACE.projectRefusal}>
						{refused}
					</Alert>
					<Button
						testID={CONTROL.projectsRetry}
						label="Try again"
						onPress={() => void load()}
						variant="outline"
						size="sm"
					/>
				</View>
			) : unreachable ? (
				<View className="gap-3">
					<Alert severity="error" testID={SURFACE.projectRefusal}>
						We couldn't read your projects just now.
					</Alert>
					<Button
						testID={CONTROL.projectsRetry}
						label="Try again"
						onPress={() => void load()}
						variant="outline"
						size="sm"
					/>
				</View>
			) : empty ? (
				<EmptyState
					testID={EMPTY.projects}
					headline="No projects yet."
					/* The second line names an ACTION, and it is honest about where that
					 *  action lives: this screen cannot create one, so it must not imply
					 *  it can. */
					next="Start one from the desktop app, or ask an agent to open a project."
				/>
			) : (
				<View>
					{sections.map((section) => (
						<View key={section.status}>
							<SectionHeader
								label={section.status}
								testID={
									section.known ? undefined : SURFACE.projectsUnknownStatus
								}
							/>
							{section.rows.map((project) => (
								<Pressable
									key={project.id}
									accessibilityRole={ROLE.button}
									// The stale verdict is part of the label rather than left to the badge: an
									// explicit `accessibilityLabel` REPLACES the children's text, so a
									// screen reader would otherwise announce the name and the counts and
									// never the one word that says the row's progress has gone old.
									accessibilityLabel={`${projectDisplayName(project)}, ${projectRowMeta(project)}${showsStaleMark(project) ? `, ${STALE_BADGE_LABEL}` : ""}`}
									onPress={() => router.push(`/projects/${project.id}`)}
									testID={projectRowId(project.id)}
								>
									{({ pressed }) => (
										<View
											className={`gap-1 border-b border-hairline py-3 ${
												pressed ? "bg-row-hover" : ""
											}`}
										>
											<View className="flex-row items-center gap-2">
												<Text
													className="flex-1 text-body-sm font-medium text-ink"
													numberOfLines={1}
													ellipsizeMode="tail"
												>
													{projectDisplayName(project)}
												</Text>
												{/* The relay's own staleness verdict, never compared against this
												 *  phone's clock — and shown only where a progress line exists
												 *  to be stale (`showsStaleMark`). */}
												{showsStaleMark(project) ? (
													<Badge label={STALE_BADGE_LABEL} tone="warning" />
												) : null}
											</View>
											<Text
												className="text-meta text-ink-dim"
												numberOfLines={1}
												ellipsizeMode="tail"
											>
												{projectRowMeta(project)}
											</Text>
										</View>
									)}
								</Pressable>
							))}
						</View>
					))}
				</View>
			)}
		</Screen>
	);
}
