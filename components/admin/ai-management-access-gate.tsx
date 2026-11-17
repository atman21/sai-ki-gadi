"use client";

import { useAdminAccessOptional } from "@/components/admin/admin-access-provider";
import { AiInstructionsAdminPanel } from "@/components/admin/ai-instructions-admin-panel";
import { AiKnowledgeAdminPanel } from "@/components/admin/ai-knowledge-admin-panel";
import { AiKnowledgeImportPanel } from "@/components/admin/ai-knowledge-import-panel";
import { AiManagementDashboardPanel } from "@/components/admin/ai-management-dashboard-panel";
import { AiManagementPlaceholderPanel } from "@/components/admin/ai-management-placeholder-panel";
import { AiSettingsAdminPanel } from "@/components/admin/ai-settings-admin-panel";
import { HelpFaqAdminPanel } from "@/components/admin/help-faq-admin-panel";
import {
  resolveAiManagementPanelAccess,
  type AiManagementTabKey,
} from "@/lib/ai-management-nav";

type Props = {
  tabKey: AiManagementTabKey;
};

/**
 * Ensures AI Management panel content never mounts until permissions are known
 * and authorized. Redirect to overview remains the dashboard fallback.
 * Client-side only — server routes must still enforce requireAdminPermission.
 */
export function AiManagementAccessGate({ tabKey }: Props) {
  const adminAccess = useAdminAccessOptional();
  const permissionsReady = Boolean(
    adminAccess && !adminAccess.loading && adminAccess.me,
  );
  const access = resolveAiManagementPanelAccess(tabKey, {
    permissionsReady,
    hasPermission: (permission) =>
      permissionsReady ? adminAccess!.can(permission) : false,
  });

  if (access === "loading") {
    return (
      <div className="admin-card p-5" aria-busy="true" aria-live="polite">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">Checking access</h2>
        <p className="admin-caption mt-2">
          Loading permissions before showing this section…
        </p>
      </div>
    );
  }

  if (access === "denied") {
    return (
      <div className="admin-card p-5" role="status">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">Access restricted</h2>
        <p className="admin-caption mt-2">
          You do not have permission for this section. Returning to the
          dashboard…
        </p>
      </div>
    );
  }

  if (tabKey === "ai-dashboard") {
    return <AiManagementDashboardPanel />;
  }

  if (tabKey === "ai-settings") {
    return <AiSettingsAdminPanel />;
  }

  if (tabKey === "ai-knowledge-base") {
    return <AiKnowledgeAdminPanel />;
  }

  if (tabKey === "ai-knowledge-import") {
    return <AiKnowledgeImportPanel />;
  }

  if (tabKey === "ai-faq-help") {
    return <HelpFaqAdminPanel />;
  }

  if (tabKey === "ai-instructions") {
    return <AiInstructionsAdminPanel />;
  }

  return <AiManagementPlaceholderPanel tabKey={tabKey} />;
}
