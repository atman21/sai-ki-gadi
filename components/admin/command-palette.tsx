"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: string;
};

const COMMANDS: CommandItem[] = [
  { id: "overview", label: "Go to Dashboard", href: "/dashboard", group: "Navigate", hint: "Overview" },
  { id: "users", label: "Go to Users", href: "/dashboard?tab=users", group: "Navigate" },
  { id: "requirements", label: "Go to Requirements", href: "/dashboard?tab=requirements", group: "Navigate" },
  { id: "exchanges", label: "Go to Exchanges", href: "/dashboard?tab=exchanges", group: "Navigate" },
  { id: "pending", label: "Go to Pending Verification", href: "/dashboard?tab=pending", group: "Navigate" },
  { id: "car-verification", label: "Go to Car Verification", href: "/dashboard?tab=car-verification", group: "Navigate" },
  { id: "fraud-reports", label: "Go to Fraud Reports", href: "/dashboard?tab=fraud-reports", group: "Navigate" },
  { id: "profile-changes", label: "Go to Profile Changes", href: "/dashboard?tab=profile-changes", group: "Navigate" },
  { id: "priority-settings", label: "Go to Priority Timeline", href: "/dashboard?tab=priority-settings", group: "Navigate" },
  { id: "wallet-management", label: "Go to Wallet Management", href: "/dashboard?tab=wallet-management", group: "Navigate" },
  { id: "membership-management", label: "Go to Membership Management", href: "/dashboard?tab=membership-management", group: "Navigate" },
  { id: "minimum-fares", label: "Go to Minimum Fare", href: "/dashboard?tab=minimum-fares", group: "Navigate" },
  { id: "cities", label: "Go to Cities", href: "/dashboard?tab=cities", group: "Navigate" },
  { id: "winners", label: "Go to Winners", href: "/dashboard?tab=winners", group: "Navigate" },
  { id: "sliders", label: "Go to Sliders", href: "/dashboard?tab=sliders", group: "Navigate" },
  { id: "in-app-popups", label: "Go to In-App Pop-ups", href: "/dashboard?tab=in-app-popups", group: "Navigate" },
  { id: "about-us", label: "Go to About Us", href: "/dashboard?tab=about-us", group: "Navigate" },
  { id: "birthday-date", label: "Go to Birthday", href: "/dashboard?tab=birthday-date", group: "Navigate" },
];

export function openAdminCommandPalette() {
  window.dispatchEvent(new CustomEvent("admin:open-command-palette"));
}

export function AdminCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const openPalette = () => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  };

  const closePalette = () => {
    setOpen(false);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setActiveIndex(0);
        setOpen((wasOpen) => !wasOpen);
      }
      if (event.key === "Escape") closePalette();
    };
    const onOpen = () => openPalette();
    window.addEventListener("keydown", onKey);
    window.addEventListener("admin:open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("admin:open-command-palette", onOpen);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.id.includes(q) ||
        (c.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [query]);

  if (!open) return null;

  const run = (item: CommandItem) => {
    closePalette();
    router.push(item.href);
  };

  const safeIndex =
    filtered.length === 0
      ? 0
      : Math.min(activeIndex, filtered.length - 1);

  return (
    <div
      className="admin-overlay fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={closePalette}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-white shadow-[var(--admin-shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--admin-border)] px-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-[var(--admin-text-faint)]"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) =>
                  Math.min(i + 1, Math.max(filtered.length - 1, 0)),
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && filtered[safeIndex]) {
                e.preventDefault();
                run(filtered[safeIndex]);
              }
            }}
            placeholder="Search modules…"
            className="h-12 w-full border-0 bg-transparent text-sm text-[var(--admin-text)] outline-none placeholder:text-[var(--admin-text-faint)]"
          />
          <kbd className="hidden rounded border border-[var(--admin-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-text-faint)] sm:inline">
            ESC
          </kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-[var(--admin-text-muted)]">
              No matching commands
            </li>
          ) : (
            filtered.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-[var(--admin-radius-sm)] px-3 py-2.5 text-left text-sm ${
                    index === safeIndex
                      ? "bg-[var(--admin-primary)] text-white"
                      : "text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(item)}
                >
                  <span className="font-medium">{item.label}</span>
                  <span
                    className={`text-xs ${
                      index === safeIndex
                        ? "text-white/70"
                        : "text-[var(--admin-text-faint)]"
                    }`}
                  >
                    {item.group}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
