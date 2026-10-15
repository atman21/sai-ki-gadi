import type { ReactNode } from "react";

export type AdminNavTabKey =
  | "overview"
  | "pending"
  | "rejected-partial"
  | "not-started"
  | "winners"
  | "cities"
  | "sliders"
  | "users"
  | "birthday-date"
  | "requirements"
  | "exchanges"
  | "fraud-reports"
  | "priority-settings"
  | "profile-changes"
  | "car-verification"
  | "minimum-fares"
  | "fare-override-requests"
  | "active-fare-overrides"
  | "about-us"
  | "in-app-popups"
  | "wallet-management"
  | "membership-management";

type NavIconConfig = {
  bgClass: string;
  colorClass: string;
  icon: ReactNode;
};

function NavSvg({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const NAV_ICON_CONFIG: Record<AdminNavTabKey, NavIconConfig> = {
  overview: {
    bgClass: "bg-indigo-100",
    colorClass: "text-indigo-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M3 3v18h18" />
        <path d="M7 16V9" />
        <path d="M12 16V5" />
        <path d="M17 16v-3" />
      </NavSvg>
    ),
  },
  pending: {
    bgClass: "bg-red-100",
    colorClass: "text-red-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6" />
        <path d="M22 11h-6" />
      </NavSvg>
    ),
  },
  "car-verification": {
    bgClass: "bg-blue-100",
    colorClass: "text-blue-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A2 2 0 0 0 13.7 5H10.3a2 2 0 0 0-1.6.9L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
      </NavSvg>
    ),
  },
  users: {
    bgClass: "bg-blue-100",
    colorClass: "text-blue-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </NavSvg>
    ),
  },
  requirements: {
    bgClass: "bg-sky-100",
    colorClass: "text-sky-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </NavSvg>
    ),
  },
  "fraud-reports": {
    bgClass: "bg-red-100",
    colorClass: "text-red-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </NavSvg>
    ),
  },
  "about-us": {
    bgClass: "bg-blue-100",
    colorClass: "text-blue-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </NavSvg>
    ),
  },
  "birthday-date": {
    bgClass: "bg-red-100",
    colorClass: "text-red-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
      </NavSvg>
    ),
  },
  cities: {
    bgClass: "bg-blue-100",
    colorClass: "text-blue-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
        <circle cx="12" cy="10" r="3" />
      </NavSvg>
    ),
  },
  exchanges: {
    bgClass: "bg-orange-100",
    colorClass: "text-orange-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="m16 3 4 4-4 4" />
        <path d="M20 7H4" />
        <path d="m8 21-4-4 4-4" />
        <path d="M4 17h16" />
      </NavSvg>
    ),
  },
  "in-app-popups": {
    bgClass: "bg-blue-100",
    colorClass: "text-blue-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </NavSvg>
    ),
  },
  "not-started": {
    bgClass: "bg-purple-100",
    colorClass: "text-purple-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </NavSvg>
    ),
  },
  "priority-settings": {
    bgClass: "bg-red-100",
    colorClass: "text-red-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M4 22V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v16" />
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      </NavSvg>
    ),
  },
  "profile-changes": {
    bgClass: "bg-purple-100",
    colorClass: "text-purple-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </NavSvg>
    ),
  },
  "rejected-partial": {
    bgClass: "bg-red-100",
    colorClass: "text-red-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </NavSvg>
    ),
  },
  "minimum-fares": {
    bgClass: "bg-emerald-100",
    colorClass: "text-emerald-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M6 3h12" />
        <path d="M6 8h12" />
        <path d="m6 13 8.5 8" />
        <path d="M6 13h3" />
        <path d="M9 13v6" />
      </NavSvg>
    ),
  },
  "fare-override-requests": {
    bgClass: "bg-amber-100",
    colorClass: "text-amber-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M12 18v-6" />
        <path d="M9 15h6" />
      </NavSvg>
    ),
  },
  "active-fare-overrides": {
    bgClass: "bg-teal-100",
    colorClass: "text-teal-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        <path d="m9 12 2 2 4-4" />
      </NavSvg>
    ),
  },
  sliders: {
    bgClass: "bg-blue-100",
    colorClass: "text-blue-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </NavSvg>
    ),
  },
  winners: {
    bgClass: "bg-orange-100",
    colorClass: "text-orange-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </NavSvg>
    ),
  },
  "wallet-management": {
    bgClass: "bg-emerald-100",
    colorClass: "text-emerald-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
      </NavSvg>
    ),
  },
  "membership-management": {
    bgClass: "bg-amber-100",
    colorClass: "text-amber-600",
    icon: (
      <NavSvg className="h-4 w-4">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        <path d="m9 12 2 2 4-4" />
      </NavSvg>
    ),
  },
};

export function AdminNavIcon({
  tabKey,
  isActive,
}: {
  tabKey: AdminNavTabKey;
  isActive: boolean;
}) {
  const config = NAV_ICON_CONFIG[tabKey];

  return (
    <span
      className={`admin-nav-icon flex shrink-0 items-center justify-center rounded-md ${
        isActive
          ? "bg-white/15 text-white"
          : "bg-[var(--admin-surface-muted)] text-[var(--admin-text-secondary)]"
      }`}
      title={tabKey}
    >
      {config.icon}
    </span>
  );
}
