"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AdminFontSizeControl } from "@/components/admin-font-size-control";
import { AdminLiveStatus } from "@/components/admin/admin-live-status";
import { AdminNotificationsBell } from "@/components/admin-notifications-bell";
import { openAdminCommandPalette } from "@/components/admin/command-palette";
import { useAdminAccessOptional } from "@/components/admin/admin-access-provider";

export function AdminTopHeader({
  onToggleNav,
}: {
  onToggleNav?: () => void;
}) {
  const router = useRouter();
  const adminAccess = useAdminAccessOptional();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const actorLabel =
    adminAccess?.me?.displayName ||
    adminAccess?.me?.username ||
    "Admin";
  const actorInitial = actorLabel.trim().charAt(0).toUpperCase() || "A";

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 flex h-[var(--admin-header-h)] items-center gap-2 border-b border-[var(--admin-border)] bg-white/90 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
      {onToggleNav ? (
        <button
          type="button"
          className="admin-btn admin-btn-ghost admin-btn-icon lg:hidden"
          aria-label="Open navigation"
          onClick={onToggleNav}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </svg>
        </button>
      ) : null}

      <div className="mr-auto min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--admin-text-muted)]">
          Sai Ki Gadi
        </p>
        <p className="truncate text-sm font-semibold tracking-tight text-[var(--admin-text)]">
          Admin Console
        </p>
      </div>

      <button
        type="button"
        onClick={() => openAdminCommandPalette()}
        className="hidden h-9 items-center gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-muted)] px-3 text-xs text-[var(--admin-text-muted)] transition hover:border-[var(--admin-border-strong)] hover:bg-white md:inline-flex"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" />
        </svg>
        <span>Search</span>
        <kbd className="ml-2 rounded border border-[var(--admin-border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-text-faint)]">
          ⌘K
        </kbd>
      </button>

      <AdminLiveStatus />
      <AdminFontSizeControl />
      <AdminNotificationsBell />

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className="admin-btn admin-btn-secondary gap-2 pl-1.5 pr-2.5"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--admin-primary)] text-[10px] font-bold text-white">
            {actorInitial}
          </span>
          <span className="hidden max-w-[9rem] truncate sm:inline">
            {actorLabel}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {menuOpen ? (
          <div className="absolute right-0 z-50 mt-1.5 w-44 overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white py-1 shadow-[var(--admin-shadow-md)]">
            <button
              type="button"
              className="flex w-full px-3 py-2 text-left text-sm text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
              onClick={() => {
                setMenuOpen(false);
                openAdminCommandPalette();
              }}
            >
              Command palette
            </button>
            <button
              type="button"
              className="flex w-full px-3 py-2 text-left text-sm text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)]"
              onClick={() => void logout()}
            >
              Log out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
