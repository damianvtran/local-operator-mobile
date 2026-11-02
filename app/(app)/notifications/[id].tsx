import { useLocalSearchParams } from "expo-router";

import NotificationDetail from "@/features/notifications/notification-detail";

/**
 * `/notifications/[id]` — one item, pushed from the inbox.
 *
 * The id arrives URL-encoded (`notifications.tsx` encodes it, because an ask's
 * id is `notify:{id}` style text rather than an opaque slug). It is decoded here
 * once so the screen works with the id the relay knows, not the transport form.
 */
export default function NotificationDetailRoute() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return <NotificationDetail itemId={decodeURIComponent(id ?? "")} />;
}
