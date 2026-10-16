"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  looksLikePhoneDisplay,
  normalizePhoneForActions,
} from "@/lib/phone-actions";

type PhoneNumberActionProps = {
  /** Original display value from the app (preserved). */
  phone: string | null | undefined;
  /** Optional fallback when phone is empty (default "—"). */
  emptyLabel?: string;
  className?: string;
  /** Extra class on the interactive trigger. */
  triggerClassName?: string;
  /** When true, render only the fallback label (non-interactive). */
  disabled?: boolean;
};

type MenuCoords = { top: number; left: number; openUp: boolean };

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

function MenuPortal({
  open,
  coords,
  menuId,
  labelledBy,
  onClose,
  children,
}: {
  open: boolean;
  coords: MenuCoords | null;
  menuId: string;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, onClose]);

  if (!open || !coords || typeof document === "undefined") return null;

  const style: CSSProperties = {
    position: "fixed",
    top: coords.openUp ? undefined : coords.top,
    bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
    left: Math.min(coords.left, window.innerWidth - 200),
    zIndex: 80,
  };

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-labelledby={labelledBy}
      style={style}
      className="admin-card min-w-[11.5rem] overflow-hidden border border-[var(--admin-border)] bg-white p-1 shadow-[var(--admin-shadow-lg)]"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Interactive phone display: click/tap opens Call + WhatsApp actions.
 * Safe for tables (fixed portal menu; stops row navigation).
 */
export function PhoneNumberAction({
  phone,
  emptyLabel = "—",
  className = "",
  triggerClassName = "",
  disabled = false,
}: PhoneNumberActionProps) {
  const display = phone == null || String(phone).trim() === ""
    ? emptyLabel
    : String(phone).trim();

  const normalized = normalizePhoneForActions(phone);
  const interactive =
    !disabled && looksLikePhoneDisplay(phone) && normalized.actionable;

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const triggerId = useId();

  const close = useCallback(() => setOpen(false), []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuH = 96;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuH + 12 && r.top > menuH + 12;
    setCoords({
      top: openUp ? r.top - 6 : r.bottom + 6,
      left: Math.max(8, r.left),
      openUp,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePosition]);

  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!interactive) return;
    setOpen((v) => !v);
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (!interactive) return;
      setOpen(true);
    }
  };

  const runCall = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!normalized.telHref) return;
    close();
    window.location.href = normalized.telHref;
  };

  const runWhatsApp = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!normalized.whatsAppUrl) return;
    close();
    window.open(normalized.whatsAppUrl, "_blank", "noopener,noreferrer");
  };

  if (!interactive) {
    return (
      <span className={`text-inherit ${className}`.trim()}>{display}</span>
    );
  }

  return (
    <span className={`relative inline-flex max-w-full ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        className={`inline-flex min-h-11 max-w-full items-center rounded-[var(--admin-radius-sm)] px-1.5 py-1 text-left font-medium text-[var(--admin-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-accent)] ${triggerClassName}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Phone actions for ${display}`}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="truncate">{display}</span>
      </button>

      <MenuPortal
        open={open}
        coords={coords}
        menuId={menuId}
        labelledBy={triggerId}
        onClose={close}
      >
        <button
          type="button"
          role="menuitem"
          className="admin-btn admin-btn-ghost flex h-10 w-full justify-start gap-2 px-3 text-sm font-semibold text-[var(--admin-text)]"
          onClick={runCall}
        >
          <PhoneIcon className="shrink-0 text-[var(--admin-accent)]" />
          Call
        </button>
        <button
          type="button"
          role="menuitem"
          className="admin-btn admin-btn-ghost flex h-10 w-full justify-start gap-2 px-3 text-sm font-semibold text-[var(--admin-text)]"
          onClick={runWhatsApp}
        >
          <WhatsAppIcon className="shrink-0 text-[#25D366]" />
          WhatsApp
        </button>
      </MenuPortal>
    </span>
  );
}
