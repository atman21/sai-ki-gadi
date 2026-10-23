/**
 * Canonical Admin Panel permission keys.
 * Must stay in sync with seeded rows in migration 065.
 */

export const ADMIN_PERMISSIONS = [
  "dashboard.view",
  "members.view",
  "members.edit",
  "members.approve",
  "members.reject",
  "members.wallet",
  "members.membership",
  "vehicles.view",
  "vehicles.approve",
  "vehicles.reject",
  "profile_changes.view",
  "profile_changes.approve",
  "profile_changes.reject",
  "requirements.view",
  "exchanges.view",
  "fraud.view",
  "fraud.manage",
  "cities.view",
  "cities.manage",
  "sliders.view",
  "sliders.manage",
  "winners.view",
  "winners.manage",
  "minimum_fares.view",
  "minimum_fares.manage",
  "fare_overrides.view",
  "fare_overrides.manage",
  "priority.view",
  "priority.manage",
  "about.view",
  "about.manage",
  "announcements.view",
  "announcements.manage",
  "birthday.view",
  "birthday.manage",
  "lucky_draw.view",
  "lucky_draw.manage",
  "admins.view",
  "admins.manage",
  "roles.manage",
  "permissions.assign",
  "audit_logs.view",
  "audit_logs.view_details",
  "audit_logs.export",
  "settings.view",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

/** Tab → required permission to view. */
export const TAB_PERMISSION_MAP: Record<string, AdminPermission> = {
  overview: "dashboard.view",
  users: "members.view",
  pending: "members.view",
  "rejected-partial": "members.view",
  "not-started": "members.view",
  "birthday-date": "birthday.view",
  "wallet-management": "members.wallet",
  "membership-management": "members.membership",
  "car-verification": "vehicles.view",
  "profile-changes": "profile_changes.view",
  requirements: "requirements.view",
  exchanges: "exchanges.view",
  "fraud-reports": "fraud.view",
  cities: "cities.view",
  sliders: "sliders.view",
  winners: "winners.view",
  "minimum-fares": "minimum_fares.view",
  "fare-override-requests": "fare_overrides.view",
  "active-fare-overrides": "fare_overrides.view",
  "priority-settings": "priority.view",
  "about-us": "about.view",
  "in-app-popups": "announcements.view",
  "admin-users": "admins.view",
  "admin-roles": "roles.manage",
  "audit-logs": "audit_logs.view",
};

export const PERMISSION_MODULES: {
  module: string;
  label: string;
  permissions: AdminPermission[];
}[] = [
  {
    module: "dashboard",
    label: "Dashboard",
    permissions: ["dashboard.view"],
  },
  {
    module: "members",
    label: "Members",
    permissions: [
      "members.view",
      "members.edit",
      "members.approve",
      "members.reject",
      "members.wallet",
      "members.membership",
    ],
  },
  {
    module: "vehicles",
    label: "Car Verification",
    permissions: ["vehicles.view", "vehicles.approve", "vehicles.reject"],
  },
  {
    module: "profile_changes",
    label: "Profile Changes",
    permissions: [
      "profile_changes.view",
      "profile_changes.approve",
      "profile_changes.reject",
    ],
  },
  {
    module: "listings",
    label: "Requirements & Exchanges",
    permissions: ["requirements.view", "exchanges.view"],
  },
  {
    module: "fraud",
    label: "Fraud Reports",
    permissions: ["fraud.view", "fraud.manage"],
  },
  {
    module: "content",
    label: "Content",
    permissions: [
      "cities.view",
      "cities.manage",
      "sliders.view",
      "sliders.manage",
      "winners.view",
      "winners.manage",
      "about.view",
      "about.manage",
      "announcements.view",
      "announcements.manage",
    ],
  },
  {
    module: "fares",
    label: "Fares",
    permissions: [
      "minimum_fares.view",
      "minimum_fares.manage",
      "fare_overrides.view",
      "fare_overrides.manage",
    ],
  },
  {
    module: "settings",
    label: "Settings & Notifications",
    permissions: [
      "priority.view",
      "priority.manage",
      "birthday.view",
      "birthday.manage",
      "lucky_draw.view",
      "lucky_draw.manage",
      "settings.view",
    ],
  },
  {
    module: "administration",
    label: "Administration",
    permissions: [
      "admins.view",
      "admins.manage",
      "roles.manage",
      "permissions.assign",
      "audit_logs.view",
      "audit_logs.view_details",
      "audit_logs.export",
    ],
  },
];
