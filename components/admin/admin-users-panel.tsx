"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import { PERMISSION_MODULES } from "@/lib/admin-permissions";

type RoleEmbed = { id: string; slug: string; name: string };

type AdminUserRow = {
  id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  is_super_admin: boolean;
  last_login_at: string | null;
  created_at: string;
  admin_panel_user_roles?: {
    role_id: string;
    admin_panel_roles: RoleEmbed | RoleEmbed[] | null;
  }[];
};

type RoleOption = {
  id: string;
  slug: string;
  name: string;
};

function roleNames(row: AdminUserRow): string {
  const parts = (row.admin_panel_user_roles ?? []).map((ur) => {
    const r = Array.isArray(ur.admin_panel_roles)
      ? ur.admin_panel_roles[0]
      : ur.admin_panel_roles;
    return r?.name ?? "";
  });
  return parts.filter(Boolean).join(", ") || "—";
}

export function AdminUsersPanel() {
  const { can, me } = useAdminAccess();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [overrideKeys, setOverrideKeys] = useState<
    { permissionKey: string; effect: "grant" | "deny" }[]
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetch("/api/admin/panel-users"),
        fetch("/api/admin/panel-roles"),
      ]);
      const usersJson = (await usersRes.json()) as {
        ok?: boolean;
        error?: string;
        data?: AdminUserRow[];
      };
      const rolesJson = (await rolesRes.json()) as {
        ok?: boolean;
        data?: RoleOption[];
      };
      if (!usersRes.ok || usersJson.ok === false) {
        throw new Error(usersJson.error ?? "Failed to load admins.");
      }
      setRows(usersJson.data ?? []);
      setRoles(rolesJson.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setUsername("");
    setDisplayName("");
    setPassword("");
    setIsSuperAdmin(false);
    setRoleIds([]);
    setOverrideKeys([]);
    setEditId(null);
  };

  const openEdit = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/panel-users/${id}`);
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: AdminUserRow & {
          admin_panel_user_permissions?: {
            permission_key: string;
            effect: "grant" | "deny";
          }[];
        };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error ?? "Failed to load admin.");
      }
      const d = json.data;
      setEditId(d.id);
      setUsername(d.username);
      setDisplayName(d.display_name);
      setPassword("");
      setIsSuperAdmin(d.is_super_admin);
      setRoleIds(
        (d.admin_panel_user_roles ?? []).map((r) => r.role_id).filter(Boolean),
      );
      setOverrideKeys(
        (d.admin_panel_user_permissions ?? []).map((p) => ({
          permissionKey: p.permission_key,
          effect: p.effect,
        })),
      );
      setShowCreate(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!can("admins.manage")) {
      setError("You do not have permission to manage admins.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editId) {
        const res = await fetch(`/api/admin/panel-users/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            password: password || undefined,
            isSuperAdmin: me?.isSuperAdmin ? isSuperAdmin : undefined,
            roleIds: can("permissions.assign") || me?.isSuperAdmin ? roleIds : undefined,
            permissionOverrides:
              can("permissions.assign") || me?.isSuperAdmin
                ? overrideKeys
                : undefined,
          }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || json.ok === false) {
          throw new Error(json.error ?? "Update failed.");
        }
        setSuccess("Admin updated.");
      } else {
        const res = await fetch("/api/admin/panel-users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            displayName: displayName || username,
            password,
            isSuperAdmin: me?.isSuperAdmin ? isSuperAdmin : false,
            roleIds,
          }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || json.ok === false) {
          throw new Error(json.error ?? "Create failed.");
        }
        setSuccess("Admin created.");
      }
      setTimeout(() => setSuccess(""), 3000);
      setShowCreate(false);
      resetForm();
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: AdminUserRow) => {
    if (!can("admins.manage")) return;
    if (
      !window.confirm(
        row.is_active
          ? `Deactivate ${row.username}?`
          : `Activate ${row.username}?`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/panel-users/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.is_active }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      setError(json.error ?? "Update failed.");
      return;
    }
    void load();
  };

  const toggleOverride = (key: string, effect: "grant" | "deny") => {
    setOverrideKeys((prev) => {
      const existing = prev.find((p) => p.permissionKey === key);
      if (existing?.effect === effect) {
        return prev.filter((p) => p.permissionKey !== key);
      }
      return [
        ...prev.filter((p) => p.permissionKey !== key),
        { permissionKey: key, effect },
      ];
    });
  };

  if (!can("admins.view")) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
        Access denied. You need the <code>admins.view</code> permission.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Admin Users</h2>
          <p className="mt-1 text-sm text-slate-600">
            Manage Admin Panel accounts, roles, and permission overrides.
            Signed in as {me?.displayName || me?.username}.
          </p>
        </div>
        {can("admins.manage") ? (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowCreate(true);
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Add Admin
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

      <div className="admin-table-wrap overflow-x-auto">
        <table className="admin-table">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold">User</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Roles</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Last login
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No admin users yet. Sign in with env Super Admin credentials
                  once after migration to seed the first account.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">
                      {row.display_name}
                    </div>
                    <div className="text-xs text-slate-500">@{row.username}</div>
                    {row.is_super_admin ? (
                      <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                        Super Admin
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {roleNames(row)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.is_active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {row.is_active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {row.last_login_at
                      ? new Date(row.last_login_at).toLocaleString("en-IN")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {can("admins.manage") ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void openEdit(row.id)}
                            className="rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleActive(row)}
                            className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            {row.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">
              {editId ? "Edit Admin" : "Add Admin"}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {!editId ? (
                <label className="text-sm font-semibold text-slate-700">
                  Username
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
                  />
                </label>
              ) : (
                <div className="text-sm">
                  <div className="font-semibold text-slate-500">Username</div>
                  <div className="mt-1 font-semibold">@{username}</div>
                </div>
              )}
              <label className="text-sm font-semibold text-slate-700">
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
                />
              </label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                {editId ? "New password (optional)" : "Password"}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
                />
              </label>
            </div>

            {me?.isSuperAdmin ? (
              <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={isSuperAdmin}
                  onChange={(e) => setIsSuperAdmin(e.target.checked)}
                />
                Super Admin
              </label>
            ) : null}

            {(can("permissions.assign") || me?.isSuperAdmin) && (
              <>
                <div className="mt-4">
                  <p className="text-sm font-semibold text-slate-700">Roles</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {roles.map((r) => {
                      const checked = roleIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() =>
                            setRoleIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== r.id)
                                : [...prev, r.id],
                            )
                          }
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                            checked
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {editId ? (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-slate-700">
                      Permission overrides
                    </p>
                    <p className="text-xs text-slate-500">
                      Deny overrides role grants. Grant adds beyond roles.
                    </p>
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-xl border p-3">
                      {PERMISSION_MODULES.flatMap((m) =>
                        m.permissions.map((key) => {
                          const current = overrideKeys.find(
                            (o) => o.permissionKey === key,
                          );
                          return (
                            <div
                              key={key}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <span className="font-mono text-slate-700">
                                {key}
                              </span>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleOverride(key, "grant")}
                                  className={`rounded px-2 py-1 ${
                                    current?.effect === "grant"
                                      ? "bg-emerald-600 text-white"
                                      : "bg-slate-100"
                                  }`}
                                >
                                  Grant
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleOverride(key, "deny")}
                                  className={`rounded px-2 py-1 ${
                                    current?.effect === "deny"
                                      ? "bg-rose-600 text-white"
                                      : "bg-slate-100"
                                  }`}
                                >
                                  Deny
                                </button>
                              </div>
                            </div>
                          );
                        }),
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            )}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetForm();
                }}
                className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || (!editId && (!username || password.length < 8))}
                onClick={() => void save()}
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
