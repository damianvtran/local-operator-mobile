import type { ReactNode } from "react";
import { View } from "react-native";

import { cardClasses } from "@/ui/variants";

/**
 * An in-flow block: a session card, a tool card, the about panel.
 *
 * No elevation: in-flow content is never lifted by a shadow, and background step
 * is how the grounds are told apart (docs/design/components.md § 5). The two
 * shadows in the system both belong to objects that leave the flow — the sheet
 * and the dialog.
 *
 * The container owns the gap (components.md § 22): a card carries no outer margin,
 * so a caller that asks for one is asking for a layout bug when the same card is
 * reused inside a list.
 */
export type CardProps = {
	children: ReactNode;
	/** 12 inside a list, 16 standalone. */
	inList?: boolean;
	testID?: string;
};

export const Card = ({ children, inList = false, testID }: CardProps) => (
	<View className={cardClasses({ inList })} testID={testID}>
		{children}
	</View>
);
