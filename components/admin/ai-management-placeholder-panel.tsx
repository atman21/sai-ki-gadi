"use client";

import { useAdminAccessOptional } from "@/components/admin/admin-access-provider";
import {
  getAiManagementNavItem,
  type AiManagementTabKey,
} from "@/lib/ai-management-nav";

type Props = {
  tabKey: AiManagementTabKey;
};

/**
 * Phase 1 shell for SKG AI Management sections.
 * Intentionally non-operational: no Gemini calls, no FAQ/settings writes.
 */
export function AiManagementPlaceholderPanel({ tabKey }: Props) {
  const item = getAiManagementNavItem(tabKey);
  const adminAccess = useAdminAccessOptional();
  const canManage =
    item.managePermission != null &&
    Boolean(adminAccess?.can(item.managePermission));

  return (
    <div className="admin-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="admin-eyebrow">SKG AI Management</p>
          <h2 className="admin-section-title mt-1">{item.label}</h2>
          <p className="admin-caption mt-2 max-w-2xl">{item.summary}</p>
        </div>
        <span className="admin-badge admin-badge-neutral">Phase 1 shell</span>
      </div>

      <div className="mt-5 rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-4">
        <p className="text-sm font-semibold text-[var(--admin-text)]">
          Coming in a later phase
        </p>
        <p className="mt-1 text-sm text-[var(--admin-text-secondary)]">
          {item.phaseNote}
        </p>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            View permission
          </dt>
          <dd className="mt-1 font-mono text-sm text-[var(--admin-text)]">
            {item.viewPermission}
          </dd>
        </div>
        <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Manage permission
          </dt>
          <dd className="mt-1 font-mono text-sm text-[var(--admin-text)]">
            {item.managePermission ?? "— (view-only section)"}
          </dd>
          {item.managePermission ? (
            <p className="mt-2 text-xs text-[var(--admin-text-secondary)]">
              {canManage
                ? "Your role includes management access for future actions."
                : "View-only for your role. Management actions will stay hidden."}
            </p>
          ) : null}
        </div>
      </dl>
    </div>
  );
}
