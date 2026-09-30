/**
 * The design system's public surface.
 *
 * Components are imported from here rather than from their files, so the
 * directory can be reorganised without touching every screen — and so an
 * accidental raw colour in a screen is easy to spot: a screen that does not import
 * from this module is not using the design system.
 */

export { CONTROL, LIVE_REGION, ROLE, SCREEN, state } from "@/ui/a11y";
export { useReducedMotion, useTheme, useTokenColor } from "@/ui/appearance";
export { Alert } from "@/ui/components/alert";
export { Avatar, initialsOf } from "@/ui/components/avatar";
export { Badge } from "@/ui/components/badge";
export { Banner } from "@/ui/components/banner";
export { Button } from "@/ui/components/button";
export { Card } from "@/ui/components/card";
export { Chip } from "@/ui/components/chip";
export { Dialog } from "@/ui/components/dialog";
export { Divider } from "@/ui/components/divider";
export { EmptyState } from "@/ui/components/empty-state";
export { IconButton } from "@/ui/components/icon-button";
export { Input } from "@/ui/components/input";
export { ListRow } from "@/ui/components/list-row";
export { Screen } from "@/ui/components/screen";
export { Segmented } from "@/ui/components/segmented";
export { Sheet } from "@/ui/components/sheet";
export { Skeleton } from "@/ui/components/skeleton";
export { Textarea } from "@/ui/components/textarea";
export { Toast, ToastHost } from "@/ui/components/toast";
export { useShadow } from "@/ui/elevation";
