import type { AdminPermission } from "@/lib/admin-permissions";

export const APP_MANAGEMENT_TAB_KEYS = ["app-maintenance"] as const;

export type AppManagementTabKey = (typeof APP_MANAGEMENT_TAB_KEYS)[number];

export type AppManagementNavItem = {
  key: AppManagementTabKey;
  label: string;
  viewPermission: AdminPermission;
  managePermission: AdminPermission;
  summary: string;
};

export const APP_MANAGEMENT_NAV_GROUP_TITLE = "APP MANAGEMENT";

export const APP_MANAGEMENT_NAV_ITEMS: readonly AppManagementNavItem[] = [
  {
    key: "app-maintenance",
    label: "Maintenance Mode",
    viewPermission: "app.view",
    managePermission: "app.manage",
    summary:
      "Remote app maintenance, schedule, emergency force, and allowed mobile numbers.",
  },
];

export function isAppManagementTabKey(
  value: string,
): value is AppManagementTabKey {
  return (APP_MANAGEMENT_TAB_KEYS as readonly string[]).includes(value);
}

export function isAppManagementNavGroupTitle(title: string): boolean {
  return title === APP_MANAGEMENT_NAV_GROUP_TITLE;
}

export function resolveAppManagementPanelAccess(
  tabKey: AppManagementTabKey,
  args: {
    permissionsReady: boolean;
    hasPermission: (permission: AdminPermission) => boolean;
  },
): "loading" | "denied" | "ok" {
  if (!args.permissionsReady) return "loading";
  const item = APP_MANAGEMENT_NAV_ITEMS.find((i) => i.key === tabKey);
  if (!item) return "denied";
  if (!args.hasPermission(item.viewPermission)) return "denied";
  return "ok";
}
