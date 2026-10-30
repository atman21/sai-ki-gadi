"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getNotificationPollState,
  NOTIFICATION_POLL_INTERVAL_MS,
  setNotificationPollState,
} from "@/lib/notification-poll";

export type AdminNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  user_id: string | null;
  is_read: boolean;
  created_at: string;
};

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function playNotificationSound() {
  try {
    const audio = new Audio("/sounds/notification.wav");
    audio.volume = 0.55;
    void audio.play().catch(() => {
      // Autoplay may be blocked until a user gesture — ignore.
    });
  } catch {
    // Ignore sound errors.
  }
}

type ToastState = {
  id: string;
  title: string;
  message: string;
} | null;

export function AdminNotificationsBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"unread" | "all">("all");
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);
  const inFlightRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const visible = notifications.filter((n) =>
    filter === "unread" ? !n.is_read : true,
  );

  const loadNotifications = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        notifications?: AdminNotification[];
        unreadCount?: number;
      };
      if (!res.ok || !payload.ok || !payload.notifications) {
        setLoadError(true);
        setNotificationPollState({
          status: "offline",
          lastSuccessAt: getNotificationPollState().lastSuccessAt,
        });
        return;
      }

      const next = payload.notifications;
      if (hydratedRef.current) {
        const fresh = next.filter((n) => !seenIdsRef.current.has(n.id));
        const newest = fresh[0];
        if (newest) {
          setToast({
            id: newest.id,
            title: newest.title,
            message: newest.message,
          });
          playNotificationSound();
        }
      }
      for (const n of next) seenIdsRef.current.add(n.id);
      hydratedRef.current = true;
      setNotifications(next);
      setUnreadCount(
        typeof payload.unreadCount === "number"
          ? payload.unreadCount
          : next.filter((n) => !n.is_read).length,
      );
      setLoadError(false);
      setNotificationPollState({
        status: "live",
        lastSuccessAt: new Date().toLocaleTimeString(),
      });
    } catch {
      setLoadError(true);
      setNotificationPollState({
        status: "offline",
        lastSuccessAt: getNotificationPollState().lastSuccessAt,
      });
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void loadNotifications();
    };
    tick();
    const timer = window.setInterval(tick, NOTIFICATION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setNotificationPollState({ status: "offline", lastSuccessAt: null });
    };
  }, [loadNotifications]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const markRead = async (ids?: string[], markAllRead = false) => {
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          markAllRead ? { markAllRead: true } : { ids: ids ?? [] },
        ),
      });
      const payload = (await res.json()) as { ok?: boolean };
      if (!res.ok || !payload.ok) {
        setLoadError(true);
        return;
      }

      setNotifications((prev) =>
        prev.map((n) => {
          if (markAllRead) return { ...n, is_read: true };
          if (ids?.includes(n.id)) return { ...n, is_read: true };
          return n;
        }),
      );
      setUnreadCount((count) => {
        if (markAllRead) return 0;
        const marked = notifications.filter(
          (n) => !n.is_read && ids?.includes(n.id),
        ).length;
        return Math.max(0, count - marked);
      });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  };

  const deleteNotification = async (id: string) => {
    const confirmed = window.confirm("Delete this notification?");
    if (!confirmed) return;
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await res.json()) as { ok?: boolean };
      if (!res.ok || !payload.ok) {
        setLoadError(true);
        return;
      }
      const removed = notifications.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (removed && !removed.is_read) {
        setUnreadCount((count) => Math.max(0, count - 1));
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="admin-btn admin-btn-secondary admin-btn-icon relative"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-[var(--admin-danger)] px-1 py-0.5 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-white shadow-[var(--admin-shadow-lg)]">
          <div className="flex items-center justify-between border-b border-[var(--admin-border)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--admin-text)]">
              Notifications
            </p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markRead(undefined, true)}
                className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="flex gap-1 border-b border-[var(--admin-border)] px-2 py-2">
            {(["all", "unread"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${
                  filter === key
                    ? "bg-[var(--admin-primary)] text-white"
                    : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          {loadError ? (
            <p className="border-b border-[var(--admin-border)] bg-[var(--admin-danger-soft)] px-4 py-2 text-xs text-[var(--admin-danger)]">
              Notifications are temporarily unavailable. Retrying shortly.
            </p>
          ) : null}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="admin-skeleton h-14 w-full" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--admin-text-muted)]">
                {filter === "unread"
                  ? "You're all caught up."
                  : "No notifications yet."}
              </p>
            ) : (
              <ul>
                {visible.map((n) => (
                  <li key={n.id} className="border-b border-[var(--admin-border)] last:border-0">
                    <div
                      className={`flex items-start gap-2 px-4 py-3 ${
                        n.is_read ? "bg-white" : "bg-[var(--admin-accent-soft)]/50"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          if (!n.is_read) void markRead([n.id]);
                        }}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                              n.is_read
                                ? "bg-[var(--admin-border-strong)]"
                                : "bg-[var(--admin-accent)]"
                            }`}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--admin-text)]">
                              {n.title}
                            </p>
                            <p className="mt-0.5 text-sm text-[var(--admin-text-secondary)]">
                              {n.message}
                            </p>
                            <p className="admin-meta mt-1">
                              {formatRelative(n.created_at)}
                            </p>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-danger)]"
                        aria-label={`Delete notification ${n.title}`}
                        onClick={() => void deleteNotification(n.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="admin-toast fixed right-4 top-[calc(var(--admin-header-h)+0.75rem)] z-[60] w-[22rem] max-w-[calc(100vw-2rem)] p-4 sm:right-6">
          <p className="text-sm font-semibold text-[var(--admin-text)]">
            {toast.title}
          </p>
          <p className="mt-1 text-sm text-[var(--admin-text-secondary)]">
            {toast.message}
          </p>
          <button
            type="button"
            className="mt-3 text-xs font-semibold text-[var(--admin-accent)]"
            onClick={() => setToast(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
