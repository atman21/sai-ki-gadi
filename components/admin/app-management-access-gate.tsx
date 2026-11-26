"use client";

import { useAdminAccessOptional } from "@/components/admin/admin-access-provider";
import { AppMaintenanceAdminPanel } from "@/components/admin/app-maintenance-admin-panel";
import {
  resolveAppManagementPanelAccess,
  type AppManagementTabKey,
} from "@/lib/app-management-nav";

type Props = {
  tabKey: AppManagementTabKey;
};

export function AppManagementAccessGate({ tabKey }: Props) {
  const adminAccess = useAdminAccessOptional();
  const permissionsReady = Boolean(
    adminAccess && !adminAccess.loading && adminAccess.me,
  );
  const access = resolveAppManagementPanelAccess(tabKey, {
    permissionsReady,
    hasPermission: (permission) =>
      permissionsReady ? adminAccess!.can(permission) : false,
  });

  if (access === "loading") {
    return (
      <div className="admin-card p-5" aria-busy="true">
        <p className="admin-eyebrow">App Management</p>
        <h2 className="admin-section-title mt-1">Checking access</h2>
        <p className="admin-caption mt-2">Loading permissions…</p>
      </div>
    );
  }

  if (access === "denied") {
    return (
      <div className="admin-card p-5" role="status">
        <p className="admin-eyebrow">App Management</p>
        <h2 className="admin-section-title mt-1">Access restricted</h2>
        <p className="admin-caption mt-2">
          You do not have permission for this section.
        </p>
      </div>
    );
  }

  if (tabKey === "app-maintenance") {
    return <AppMaintenanceAdminPanel />;
  }

  return null;
}
