"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AdminBadge } from "@/components/admin/ui/badge";
import { ErrorState, EmptyState } from "@/components/admin/ui/page-header";
import { formatDateTime } from "@/lib/format-datetime";
import type {
  AdminTone,
  MemberVerificationDetail,
  MemberVerificationFilter,
  MemberVerificationListItem,
} from "@/lib/admin-ops-parse";

const FILTERS: { id: MemberVerificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "processing", label: "Processing" },
  { id: "manual_review", label: "Manual Review" },
  { id: "correction_required", label: "Correction Required" },
  { id: "completed", label: "Completed" },
  { id: "verified", label: "Verified" },
  { id: "unverified", label: "Unverified" },
];

const PAGE_SIZE = 20;

function ToneBadge({ tone, children }: { tone: AdminTone; children: string }) {
  return <AdminBadge tone={tone}>{children}</AdminBadge>;
}

export function MemberVerificationPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const memberId = searchParams.get("member");
  const [filter, setFilter] = useState<MemberVerificationFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MemberVerificationListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemberVerificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [listReload, setListReload] = useState(0);
  const [detailReload, setDetailReload] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [filter, debouncedSearch]);

  useEffect(() => {
    if (memberId) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          filter,
          search: debouncedSearch,
          page: String(page),
        });
        const response = await fetch(`/api/admin/member-verification?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          items?: MemberVerificationListItem[];
          total?: number | null;
        };
        if (!response.ok || !payload.ok || !payload.items) {
          setError(
            response.status === 401
              ? "Your admin session has expired. Sign in again."
              : "Member verification is unavailable right now.",
          );
          return;
        }
        setItems(payload.items);
        setTotal(typeof payload.total === "number" ? payload.total : null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Member verification is unavailable right now.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [filter, debouncedSearch, page, memberId, listReload]);

  useEffect(() => {
    if (!memberId || !/^[A-Za-z0-9_-]{1,80}$/.test(memberId)) {
      setDetail(null);
      setDetailError(memberId ? "Member verification is unavailable right now." : null);
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await fetch(
          `/api/admin/member-verification/${encodeURIComponent(memberId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          detail?: MemberVerificationDetail;
        };
        if (!response.ok || !payload.ok || !payload.detail) {
          setDetail(null);
          setDetailError(
            response.status === 401
              ? "Your admin session has expired. Sign in again."
              : "Member verification is unavailable right now.",
          );
          return;
        }
        setDetail(payload.detail);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDetail(null);
        setDetailError("Member verification is unavailable right now.");
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [memberId, detailReload]);

  const openMember = (userId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "member-verification");
    params.set("member", userId);
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  };

  const closeMember = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "member-verification");
    params.delete("member");
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  };

  const hasNext =
    total !== null ? page * PAGE_SIZE < total : items.length === PAGE_SIZE;

  return (
    <section className="space-y-4">
      <div className="admin-card px-4 py-4 sm:px-5">
        <p className="admin-eyebrow">Verification</p>
        <h2 className="admin-page-title mt-1.5">Member Verification</h2>
        <p className="admin-caption mt-1.5 max-w-3xl">
          Shadow mode is on. An AI recommendation does not change the member
          account. Actual Account Status comes from users.verified.
        </p>
      </div>

      {memberId ? (
        <DetailView
          loading={detailLoading}
          error={detailError}
          detail={detail}
          onBack={closeMember}
          onRetry={() => setDetailReload((current) => current + 1)}
        />
      ) : (
        <>
          <div className="admin-card px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search member name or mobile number"
                className="h-11 w-full max-w-md rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 placeholder:text-slate-400"
              />
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      filter === item.id
                        ? "bg-[var(--admin-primary)] text-white"
                        : "bg-[var(--admin-surface-muted)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <ErrorState
              title="Member verification is unavailable"
              description={error}
              onRetry={() => setListReload((current) => current + 1)}
            />
          ) : null}

          {!error || items.length > 0 ? (
          <div className="admin-table-wrap">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member name</th>
                    <th>Mobile number</th>
                    <th>Registration</th>
                    <th>Current status</th>
                    <th>AI recommendation</th>
                    <th>Confidence</th>
                    <th>users.verified</th>
                    <th>Last activity</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-sm text-[var(--admin-text-muted)]">
                        Loading member verification…
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState
                          title="No members in this view"
                          description="Try another filter or search by name or mobile number."
                        />
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr
                        key={`${item.userId}-${item.id}`}
                        className={
                          item.needsAttention
                            ? "bg-[var(--admin-warning-soft)]"
                            : undefined
                        }
                      >
                        <td className="whitespace-nowrap font-semibold text-[var(--admin-text)]">
                          {item.memberName}
                          {item.attentionLabels.length > 0 ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {item.attentionLabels.map((label) => (
                                <AdminBadge key={label} tone="warning">
                                  {label}
                                </AdminBadge>
                              ))}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap">{item.mobile}</td>
                        <td className="whitespace-nowrap">
                          {formatDateTime(item.registeredAt)}
                        </td>
                        <td>
                          <ToneBadge tone={item.caseTone}>
                            {item.caseStatusLabel}
                          </ToneBadge>
                        </td>
                        <td className="min-w-52">
                          <ToneBadge tone="info">{item.recommendationLabel}</ToneBadge>
                          {item.shadowNote ? (
                            <p className="mt-1 max-w-xs text-xs text-[var(--admin-warning)]">
                              {item.shadowNote}
                            </p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap">{item.confidenceLabel}</td>
                        <td className="min-w-48">
                          <ToneBadge tone={item.accountTone}>
                            {item.accountStatusLabel}
                          </ToneBadge>
                        </td>
                        <td className="whitespace-nowrap">
                          {formatDateTime(item.lastActivityAt)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="admin-btn admin-btn-secondary"
                            onClick={() => openMember(item.userId)}
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--admin-text-muted)]">
              Page {page}
              {total !== null ? ` · ${total} members` : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={!hasNext || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function DetailView({
  loading,
  error,
  detail,
  onBack,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  detail: MemberVerificationDetail | null;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <button type="button" className="admin-btn admin-btn-secondary" onClick={onBack}>
        Back to list
      </button>
      {loading ? (
        <div className="admin-card px-5 py-8 text-sm text-[var(--admin-text-muted)]">
          Loading verification details…
        </div>
      ) : error ? (
        <ErrorState
          title="Member verification is unavailable"
          description={error}
          onRetry={onRetry}
        />
      ) : detail ? (
        <>
          <div className="admin-card px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-[var(--admin-text)]">
                  {detail.memberName}
                </h3>
                <p className="admin-caption mt-1">{detail.mobile}</p>
              </div>
              {detail.needsAttention ? (
                <div className="flex flex-wrap gap-1">
                  {detail.attentionLabels.map((label) => (
                    <AdminBadge key={label} tone="danger">
                      {label}
                    </AdminBadge>
                  ))}
                </div>
              ) : null}
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <SummaryItem label="Registration" value={formatDateTime(detail.registeredAt)} />
              <SummaryItem label="Case status" value={detail.caseStatusLabel} tone={detail.caseTone} />
              <SummaryItem
                label="AI recommendation"
                value={detail.recommendationLabel}
                tone="info"
              />
              <SummaryItem label="AI confidence" value={detail.confidenceLabel} />
              <SummaryItem
                label="users.verified"
                value={detail.accountStatusLabel}
                tone={detail.accountTone}
              />
            </dl>
            {detail.shadowNote ? (
              <p className="mt-4 rounded-[var(--admin-radius-sm)] border border-[var(--admin-warning-border)] bg-[var(--admin-warning-soft)] px-3 py-2 text-sm text-[var(--admin-warning)]">
                {detail.shadowNote}
              </p>
            ) : null}
            {detail.decisionNote ? (
              <p className="mt-3 text-sm text-[var(--admin-text-secondary)]">
                {detail.decisionNote}
              </p>
            ) : null}
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--admin-text-faint)]">
                Safe reasons
              </p>
              {detail.reasonLabels.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
                  No safe reason labels were returned.
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {detail.reasonLabels.map((label) => (
                    <li key={label}>
                      <AdminBadge tone="neutral">{label}</AdminBadge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="admin-card px-4 py-4 sm:px-5">
            <h3 className="text-sm font-semibold text-[var(--admin-text)]">
              Verification timeline
            </h3>
            {detail.timeline.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
                No verification events with timestamps were returned.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {detail.timeline.map((event) => (
                  <li key={event.key} className="flex gap-3">
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--admin-accent)]"
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-semibold text-[var(--admin-text)]">
                        {event.label}
                      </p>
                      <p className="admin-meta mt-0.5">{formatDateTime(event.at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: AdminTone;
}) {
  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--admin-text-faint)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-[var(--admin-text)]">
        {tone ? <ToneBadge tone={tone}>{value}</ToneBadge> : value}
      </dd>
    </div>
  );
}
