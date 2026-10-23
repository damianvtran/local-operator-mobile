import { useEffect } from "react";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { DefaultOnNoticeView } from "./default-on-notice";

/** Connected wrapper: asks the store once per organization, renders nothing unless it says so. */
export function DefaultOnNoticeBanner({
	tenantId,
}: {
	tenantId: string | null;
}) {
	const { actions } = useTeamBridge();
	const notice = useTeamBridgeState((s) => s.defaultOnNotice);
	const error = useTeamBridgeState((s) => s.defaultOnNoticeError);
	const busy = useTeamBridgeState((s) => s.defaultOnNoticeBusy);
	useEffect(() => {
		if (tenantId) void actions.loadDefaultOnNotice(tenantId);
	}, [actions, tenantId]);
	if (!notice || notice.tenantId !== tenantId) return null;
	return (
		<DefaultOnNoticeView
			notice={notice}
			failed={error !== null}
			busy={busy}
			onTurnOff={() => void actions.turnOffDefaultOn()}
			onDismiss={() => void actions.dismissDefaultOnNotice()}
		/>
	);
}
