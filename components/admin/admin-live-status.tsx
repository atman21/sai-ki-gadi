"use client";

import { useEffect, useState } from "react";

import {
  getNotificationPollState,
  subscribeNotificationPoll,
  type NotificationPollState,
} from "@/lib/notification-poll";

export function AdminLiveStatus() {
  const [state, setState] = useState<NotificationPollState>(() =>
    getNotificationPollState(),
  );

  useEffect(() => subscribeNotificationPoll(setState), []);

  const label =
    state.status === "live"
      ? "Live"
      : state.status === "offline"
        ? "Offline"
        : "Connecting";
  const color =
    state.status === "live"
      ? "bg-emerald-500"
      : state.status === "offline"
        ? "bg-rose-500"
        : "bg-amber-400";

  return (
    <div
      className="inline-flex h-9 items-center gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-white px-2.5 text-xs font-medium text-[var(--admin-text-secondary)]"
      title={
        state.lastSuccessAt
          ? `Notifications updated ${state.lastSuccessAt}`
          : "Notification updates"
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${color} ${
          state.status === "live" ? "animate-pulse" : ""
        }`}
        aria-hidden
      />
      <span>{label}</span>
    </div>
  );
}
