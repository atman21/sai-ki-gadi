"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import {
  PERMISSION_MODULES,
  type AdminPermission,
} from "@/lib/admin-permissions";

type RoleRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  admin_panel_role_permissions?: { permission_key: string }[];
};

export function AdminRolesPanel() {
  const { can } = useAdminAccess();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [edit, setEdit] = useState<RoleRow | null>(null);
  const [keys, setKeys] = useState<AdminPermission[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/panel-roles");
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: RoleRow[];
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Failed to load roles.");
      }
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("roles.manage") && !can("admins.view")) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
        Access denied.
      </div>
    );
  }

  const openEdit = (row: RoleRow) => {
    setEdit(row);
    setKeys(
      (row.admin_panel_role_permissions ?? []).map(
        (p) => p.permission_key as AdminPermission,
      ),
    );
  };

  const saveEdit = async () => {
    if (!edit || !can("roles.manage")) return;
    if (edit.slug === "super_admin") {
      setError("Super Admin role permissions cannot be edited.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/panel-roles/${edit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKeys: keys }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Update failed.");
      }
      setSuccess("Role permissions updated.");
      setTimeout(() => setSuccess(""), 3000);
      setEdit(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const createRole = async () => {
    if (!can("roles.manage")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/panel-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: newSlug,
          name: newName,
          permissionKeys: keys,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Create failed.");
      }
      setCreateOpen(false);
      setNewSlug("");
      setNewName("");
      setKeys([]);
      setSuccess("Role created.");
      setTimeout(() => setSuccess(""), 3000);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Roles</h2>
          <p className="mt-1 text-sm text-slate-600">
            System and custom roles. Explicit deny overrides on a user still win
            over role grants.
          </p>
        </div>
        {can("roles.manage") ? (
          <button
            type="button"
            onClick={() => {
              setKeys([]);
              setCreateOpen(true);
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Create Role
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900">{row.name}</h3>
                  <p className="text-xs text-slate-500">{row.slug}</p>
                  {row.is_system ? (
                    <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                      System
                    </span>
                  ) : null}
                </div>
                {can("roles.manage") && row.slug !== "super_admin" ? (
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
                  >
                    Edit permissions
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {row.description || "—"}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {(row.admin_panel_role_permissions ?? []).length} permissions
              </p>
            </div>
          ))
        )}
      </div>

      {(edit || createOpen) && can("roles.manage") ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold">
              {createOpen ? "Create Role" : `Edit ${edit?.name}`}
            </h3>
            {createOpen ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Slug
                  <input
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Name
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
                  />
                </label>
              </div>
            ) : null}
            <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
              {PERMISSION_MODULES.map((mod) => (
                <div key={mod.module}>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {mod.label}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {mod.permissions.map((key) => {
                      const on = keys.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setKeys((prev) =>
                              on
                                ? prev.filter((k) => k !== key)
                                : [...prev, key],
                            )
                          }
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                            on
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setEdit(null);
                  setCreateOpen(false);
                }}
                className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void (createOpen ? createRole() : saveEdit())
                }
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
