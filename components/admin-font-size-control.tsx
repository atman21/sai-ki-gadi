"use client";

import { useEffect, useState } from "react";

import {
  ADMIN_FONT_SIZE_OPTIONS,
  applyAdminFontSize,
  clearAdminFontSize,
  persistAdminFontSize,
  readStoredAdminFontSize,
  type AdminFontSize,
} from "@/lib/admin-font-size";

export function AdminFontSizeControl() {
  // Lazy init from localStorage avoids a sync setState-in-effect cascade.
  // SSR and the first server render still use "normal"; the client hydrate
  // path reads storage once when the state initializer runs.
  const [fontSize, setFontSize] = useState<AdminFontSize>(() => {
    if (typeof window === "undefined") return "normal";
    return readStoredAdminFontSize();
  });

  useEffect(() => {
    // Keep DOM attribute/scale in sync with the selected size, and clear
    // admin scaling when leaving dashboard routes.
    applyAdminFontSize(fontSize);

    return () => {
      clearAdminFontSize();
    };
  }, [fontSize]);

  const handleSelect = (next: AdminFontSize) => {
    setFontSize(next);
    persistAdminFontSize(next);
  };

  return (
    <div
      className="flex h-9 items-center gap-0.5 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-0.5"
      role="group"
      aria-label="Font size accessibility controls"
    >
      {ADMIN_FONT_SIZE_OPTIONS.map((option) => {
        const isActive = fontSize === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            aria-label={option.ariaLabel}
            aria-pressed={isActive}
            title={option.ariaLabel}
            className={`min-h-8 min-w-8 rounded-[5px] px-1.5 text-[11px] font-bold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)] focus-visible:ring-offset-1 sm:min-w-9 sm:px-2 sm:text-xs ${
              isActive
                ? "bg-[var(--admin-primary)] text-white shadow-[var(--admin-shadow-xs)]"
                : "bg-transparent text-[var(--admin-text-muted)] hover:bg-white hover:text-[var(--admin-text)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
