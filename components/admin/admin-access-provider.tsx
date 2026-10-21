"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AdminPermission } from "@/lib/admin-permissions";

export type AdminMe = {
  id: string | null;
  username: string;
  displayName: string;
  isSuperAdmin: boolean;
  isEnvBootstrap: boolean;
  permissions: AdminPermission[];
};

type AdminAccessContextValue = {
  me: AdminMe | null;
  loading: boolean;
  error: string | null;
  can: (permission: AdminPermission) => boolean;
  refresh: () => Promise<void>;
};

const AdminAccessContext = createContext<AdminAccessContextValue | null>(null);

export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/me");
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: AdminMe;
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error ?? "Failed to load admin session.");
      }
      setMe(json.data);
    } catch (e) {
      setMe(null);
      setError(e instanceof Error ? e.message : "Failed to load permissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AdminAccessContextValue>(() => {
    const permissionSet = new Set(me?.permissions ?? []);
    return {
      me,
      loading,
      error,
      can: (permission) => {
        if (!me) return false;
        if (me.isSuperAdmin) return true;
        return permissionSet.has(permission);
      },
      refresh,
    };
  }, [me, loading, error, refresh]);

  return (
    <AdminAccessContext.Provider value={value}>
      {children}
    </AdminAccessContext.Provider>
  );
}

export function useAdminAccess(): AdminAccessContextValue {
  const ctx = useContext(AdminAccessContext);
  if (!ctx) {
    throw new Error("useAdminAccess must be used within AdminAccessProvider");
  }
  return ctx;
}

/** Safe optional hook when provider may be missing during incremental rollout. */
export function useAdminAccessOptional(): AdminAccessContextValue | null {
  return useContext(AdminAccessContext);
}
