/**
 * Canonical Admin Panel permission keys.
 * Must stay in sync with seeded rows in migrations 065+ (e.g. 068 for
 * members.convert_regular_to_gold).
 * Must stay in sync with seeded rows in migration 065 (+ later seeds).
 * `listings.fare_view` also requires a DB seed (see A18-DB fare-masking migration);
 * Super Admin receives it in-app via allPermissionsSet() / isSuperAdmin bypass.
 */

export const ADMIN_PERMISSIONS = [
  "dashboard.view",
  "members.view",
  "members.edit",
  "members.approve",
  "members.reject",
  "members.wallet",
  "members.membership",
  "members.convert_regular_to_gold",
  "vehicles.view",
  "vehicles.approve",
  "vehicles.reject",
  "profile_changes.view",
  "profile_changes.approve",
  "profile_changes.reject",
  "requirements.view",
  "exchanges.view",
  /** Full raw requirements.price / exchange_listings.price in Admin. */
  "listings.fare_view",
  "fraud.view",
  "fraud.manage",
  "reviews.view",
  "reviews.moderate",
  "disputed_numbers.view",
  "disputed_numbers.manage",
  "help.view",
  "help.manage",
  "help_ai.view",
  "help_ai.manage",
  "reviews.view",
  "reviews.moderate",
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
  /** Help Center FAQ (Mobile T29 / Admin AI Management Console). */
  "help.view",
  "help.manage",
  /** SKG AI Voice / settings / analytics (Mobile T29 help_ai.*). */
  "help_ai.view",
  "help_ai.manage",
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
  "member-reviews": "reviews.view",
  "disputed-numbers": "disputed_numbers.view",
  "help-center": "help.view",
  "help-ai": "help_ai.view",
  "member-reviews": "reviews.view",
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
  // SKG AI Management Console (Phase 1 shell)
  "ai-dashboard": "help_ai.view",
  "ai-settings": "help_ai.manage",
  "ai-knowledge-base": "help_ai.view",
  "ai-knowledge-import": "help_ai.manage",
  "ai-instructions": "help_ai.view",
  "ai-faq-help": "help.view",
  "ai-tools": "help_ai.manage",
  "ai-test-assistant": "help_ai.manage",
  "ai-conversations": "help_ai.view",
  "ai-usage": "help_ai.view",
  "ai-security-audit": "help_ai.view",
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
      "members.convert_regular_to_gold",
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
    permissions: [
      "requirements.view",
      "exchanges.view",
      "listings.fare_view",
    ],
  },
  {
    module: "fraud",
    label: "Fraud Reports",
    permissions: ["fraud.view", "fraud.manage"],
  },
  {
    module: "reviews",
    label: "Member Reviews",
    permissions: ["reviews.view", "reviews.moderate"],
  },
  {
    module: "disputed_numbers",
    label: "Disputed Numbers",
    permissions: ["disputed_numbers.view", "disputed_numbers.manage"],
  },
  {
    module: "help",
    label: "Help Center",
    permissions: ["help.view", "help.manage"],
  },
  {
    module: "help_ai",
    label: "Help AI Voice",
    permissions: ["help_ai.view", "help_ai.manage"],
  },
  {
    module: "reviews",
    label: "Member Reviews",
    permissions: ["reviews.view", "reviews.moderate"],
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
    module: "help",
    label: "Help Center FAQ",
    permissions: ["help.view", "help.manage"],
  },
  {
    module: "help_ai",
    label: "SKG AI Management",
    permissions: ["help_ai.view", "help_ai.manage"],
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
