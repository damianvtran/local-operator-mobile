import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import type { LinkedSession, ProjectMilestone, ProjectView } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	linkedSessionLabel,
	linkedSessionState,
	projectDisplayName,
	projectRefusalSentence,
	projectStatusTone,
	showsStaleMark,
} from "@/features/projects/projects-copy";
import { ProjectDetailStateMarkers } from "@/features/projects/projects-markers";
import { CONTROL, SCREEN, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Skeleton } from "@/ui/components/skeleton";
import type { SemanticTone } from "@/ui/variants";

/**
 * One project, pushed from the list (S16 detail).
 *
 * Everything a milestone shows is the relay's: its `status` is derived once
 * server-side (`local_operator/projects.py:milestone_status`) and a renderer
 * that recomputed it from the dates would be a second derivation that can
 * disagree with a tool result about which milestone is late. The progress line,
 * `progress_stale` and the linked-session rows are the same — read, never
 * derived.
 *
 * Linked sessions arrive composed by `build_project_view`, and the `role` split
 * matters: a `work` row carries liveness facts, a `coordination` row ("filed by")
 * carries none, and the two are labelled so a filing can never be read as a
 * worker.
 */
export default function ProjectDetail() {
	const router = useRouter();
	const { key } = useLocalSearchParams<{ key: string }>();
	const { relay, refusal } = useConnection();

	const [project, setProject] = useState<ProjectView | null>(null);
	const [links, setLinks] = useState<LinkedSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [refused, setRefused] = useState<string | null>(null);
	const [unreachable, setUnreachable] = useState(false);

	const load = useCallback(async () => {
		const client = relay();
		if (!client || key === undefined) return;
		setLoading(true);
		setRefused(null);
		setUnreachable(false);
		try {
			const answer = await client.project(key);
			setProject(answer.project);
			setLinks(answer.links);
		} catch (error) {
			const sentence = projectRefusalSentence(error);
			if (sentence !== null) setRefused(sentence);
			else setUnreachable(true);
		} finally {
			setLoading(false);
		}
	}, [relay, key]);

	useEffect(() => {
		void load();
	}, [load]);

	const failed = refused !== null || unreachable;

	return (
		<Screen
			title={project === null ? "Project" : projectDisplayName(project)}
			testID={SCREEN.projectDetail}
			headerLeading={
				<Button
					testID={CONTROL.projectDetailBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<ProjectDetailStateMarkers refused={failed} />

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
			) : loading ? (
				<Skeleton lines={5} testID={SURFACE.projectDetailLoading} />
			) : project === null ? (
				<View className="gap-3">
					<Alert severity="error" testID={SURFACE.projectDetailRefusal}>
						{refused ?? "We couldn't read that project just now."}
					</Alert>
					<Button
						testID={CONTROL.projectDetailRetry}
						label="Try again"
						onPress={() => void load()}
						variant="outline"
						size="sm"
					/>
				</View>
			) : (
				<View className="gap-4">
					<View className="flex-row flex-wrap items-center gap-2">
						<Badge
							label={project.status}
							tone={projectStatusTone(project.status)}
						/>
						{/* The same rule the row uses: a stale verdict is only shown where a
						 *  progress line exists to be stale (`showsStaleMark`). */}
						{showsStaleMark(project) ? (
							<Badge label="progress stale" tone="warning" />
						) : null}
					</View>

					{project.description.trim() !== "" ? (
						<Text className="text-body-sm text-ink-muted">
							{project.description}
						</Text>
					) : null}

					{project.progress.trim() !== "" ? (
						<View className="gap-1">
							<SectionHeader label="progress" />
							<Text className="text-body-sm text-ink">{project.progress}</Text>
						</View>
					) : null}

					<View>
						<SectionHeader label="milestones" />
						{project.milestones.length === 0 ? (
							<Text className="py-1 text-body-sm text-ink-dim">
								No milestones.
							</Text>
						) : (
							project.milestones.map((milestone) => (
								<MilestoneRow
									/* The store keys a milestone by its NAME within one project
									 *  (`MilestoneEdit(name=…)` addresses it that way), so the
									 *  name is the row's identity — an index would be a key that
									 *  moves when the list is reordered. */
									key={milestone.name}
									milestone={milestone}
								/>
							))
						)}
					</View>

					<View testID={SURFACE.projectLinks}>
						<SectionHeader label="linked sessions" />
						{links.length === 0 ? (
							<Text className="py-1 text-body-sm text-ink-dim">
								No sessions linked.
							</Text>
						) : (
							links.map((link) => (
								<View
									key={link.session_id}
									className="gap-1 border-b border-hairline py-3"
								>
									<Text
										className="text-body-sm text-ink"
										numberOfLines={1}
										ellipsizeMode="tail"
									>
										{linkedSessionLabel(link)}
									</Text>
									{linkedSessionState(link) !== null ? (
										<Text className="text-meta text-ink-dim">
											{linkedSessionState(link)}
										</Text>
									) : null}
								</View>
							))
						)}
					</View>
				</View>
			)}
		</Screen>
	);
}

/** One milestone: the name, the relay's derived status, and the dates behind it. */
const MilestoneRow = ({ milestone }: { milestone: ProjectMilestone }) => (
	<View className="flex-row items-center gap-2 border-b border-hairline py-3">
		<View className="flex-1">
			<Text className="text-body-sm text-ink" numberOfLines={1}>
				{milestone.name}
			</Text>
			{milestone.target_date !== null ? (
				<Text className="text-meta text-ink-dim">
					due {milestone.target_date}
				</Text>
			) : null}
		</View>
		<Badge
			label={milestone.status}
			tone={MILESTONE_TONE[milestone.status]}
			accessibilityLabel={`${milestone.name}: ${milestone.status}`}
		/>
	</View>
);

/** The tone per DERIVED milestone status. The relay's three values, closed. */
const MILESTONE_TONE: Record<ProjectMilestone["status"], SemanticTone> = {
	completed: "success",
	overdue: "danger",
	upcoming: "neutral",
};
