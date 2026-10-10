"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_STATUSES,
  AUDIENCE_TYPES,
  DEFAULT_CLOSE_BUTTON,
  DEFAULT_PRIMARY_BUTTON,
  categoryLabel,
  audienceLabel,
  validateAnnouncementConfig,
  type InAppAnnouncement,
} from "@/lib/in-app-announcements/types";

type ScreenRegistryEntry = {
  key: string;
  label: string;
  href: string;
  minAppVersion: string;
};

type AnalyticsSummary = {
  targetedUsers: number | null;
  uniqueViews: number;
  totalDisplays: number;
  primaryButtonClicks: number;
  secondaryButtonClicks: number;
  dismissals: number;
  acceptances: number;
  pendingAcceptance: number | null;
  audioPlays: number;
};

type UserSearchRow = {
  id: string;
  fullName: string;
  phone: string;
  membership_type: string;
};

/** Match existing Admin Panel form controls (About Us / Winner modals). */
const fieldClass =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500";
const selectClass =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none focus:border-indigo-500";
const textareaClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500";
const labelClass = "flex items-center gap-2 text-sm font-medium text-slate-700";
const sectionTitleClass = "font-semibold text-slate-900";
const helperClass = "text-xs text-slate-500";
const secondaryBtnClass =
  "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
const primaryBtnClass =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60";

/** Browser datetime-local fields need a LOCAL wall time, not a sliced UTC ISO value. */
function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(Date.parse(value) + 330 * 60000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function legacyCustomIntervalHours(
  value: number,
  unit: "minutes" | "hours" | "days",
): number {
  if (unit === "minutes") return Math.max(1, Math.ceil(value / 60));
  if (unit === "days") return value * 24;
  return value;
}

function buildSavePayload(form: Partial<InAppAnnouncement>) {
  const next = { ...form };
  if (next.frequency === "custom_interval") {
    const value = Number(next.custom_interval_value ?? 1);
    const unit = (next.custom_interval_unit ?? "hours") as
      | "minutes"
      | "hours"
      | "days";
    next.custom_interval_value = value;
    next.custom_interval_unit = unit;
    next.custom_interval_hours = legacyCustomIntervalHours(value, unit);
  } else {
    next.custom_interval_value = null;
    next.custom_interval_unit = null;
    next.custom_interval_hours = null;
  }
  if (!next.auto_dismiss) {
    next.auto_dismiss_seconds = null;
  }
  return next;
}

const EMPTY_FORM: Partial<InAppAnnouncement> = {
  internal_name: "",
  category: "other",
  internal_description: "",
  priority: 100,
  status: "draft",
  image_fit: "contain",
  background_color: "#000000",
  primary_button: DEFAULT_PRIMARY_BUTTON,
  secondary_button: null,
  close_button: DEFAULT_CLOSE_BUTTON,
  dismissal_type: "close_button",
  show_close: true,
  outside_tap_closes: false,
  back_button_closes: true,
  auto_dismiss: false,
  auto_dismiss_seconds: 3,
  close_after_audio_ends: false,
  delay_after_audio_seconds: 2,
  is_mandatory: false,
  record_acceptance: false,
  content_version: "1",
  is_legal_consent: false,
  audio_enabled: false,
  audio_source: "upload",
  audio_autoplay: true,
  show_replay_button: false,
  show_mute_button: true,
  audience_type: "all_users",
  active_within_days: 30,
  trigger_type: "app_open",
  trigger_feature_key: null,
  trigger_delay_seconds: 0,
  show_once_per_session: true,
  timezone: "Asia/Kolkata",
  frequency: "once_per_user",
  custom_interval_value: 6,
  custom_interval_unit: "hours",
  custom_interval_hours: 6,
  is_birthday_template: false,
  birthday_personalize_name: false,
};

export function InAppAnnouncementsAdminPanel() {
  const [items, setItems] = useState<InAppAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<Partial<InAppAnnouncement>>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"image" | "audio" | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<UserSearchRow[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserSearchRow[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [userSearchPage, setUserSearchPage] = useState(1);
  const [userSearchTotalPages, setUserSearchTotalPages] = useState(1);
  const [screenRegistry, setScreenRegistry] = useState<ScreenRegistryEntry[]>([]);

  const selectedUserIds = useMemo(
    () => selectedUsers.map((user) => user.id),
    [selectedUsers],
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(
        `/api/admin/in-app-announcements?${params.toString()}`,
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        items?: InAppAnnouncement[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to load announcements.");
      }
      setItems(payload.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load announcements.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void fetch("/api/admin/in-app-announcements/screen-registry")
      .then((res) => res.json())
      .then((payload: { ok?: boolean; registry?: { screens?: ScreenRegistryEntry[] } }) => {
        if (payload.ok && payload.registry?.screens) {
          setScreenRegistry(payload.registry.screens);
        }
      })
      .catch(() => undefined);
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setSelectedUsers([]);
    setUserResults([]);
    setUserSearch("");
    setUserSearchError(null);
    setUserSearchPage(1);
    setAnalytics(null);
    setEditorOpen(true);
  }

  async function openEdit(id: string) {
    setError(null);
    try {
      const response = await fetch(`/api/admin/in-app-announcements/${id}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        item?: InAppAnnouncement;
        error?: string;
      };
      if (!response.ok || !payload.item) {
        throw new Error(payload.error ?? "Failed to load announcement.");
      }
      setEditingId(id);
      setForm({
        ...payload.item,
        custom_interval_value:
          payload.item.custom_interval_value ??
          payload.item.custom_interval_hours ??
          6,
        custom_interval_unit:
          payload.item.custom_interval_unit ??
          (payload.item.frequency === "custom_interval" ? "hours" : null),
      });
      setEditorOpen(true);

      if (payload.item.audience_type === "custom_users") {
        const recipientsRes = await fetch(
          `/api/admin/in-app-announcements/${id}/recipients`,
        );
        const recipientsPayload = (await recipientsRes.json()) as {
          recipients?: {
            user_id: string;
            users?: {
              id: string;
              first_name: string | null;
              last_name: string | null;
              phone: string | null;
              membership_type?: string | null;
            } | null;
          }[];
        };
        const selected = (recipientsPayload.recipients ?? []).map((row) => {
          const user = row.users;
          return {
            id: row.user_id,
            fullName: user
              ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "—"
              : row.user_id.slice(0, 8),
            phone: user?.phone ?? "—",
            membership_type: user?.membership_type ?? "user",
          };
        });
        setSelectedUsers(selected);
      } else {
        setSelectedUsers([]);
      }

      const analyticsRes = await fetch(
        `/api/admin/in-app-announcements/${id}/analytics`,
      );
      const analyticsPayload = (await analyticsRes.json()) as {
        analytics?: AnalyticsSummary;
        error?: string;
      };
      if (analyticsRes.ok && analyticsPayload.analytics) {
        setAnalytics(analyticsPayload.analytics);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open editor.");
    }
  }

  async function handleUpload(kind: "image" | "audio", file: File) {
    setUploading(kind);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const response = await fetch("/api/admin/in-app-announcements/upload", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Upload failed.");
      }
      if (kind === "image") {
        setForm((prev) => ({ ...prev, image_url: payload.url }));
      } else {
        setForm((prev) => ({ ...prev, audio_url: payload.url, audio_source: "upload" }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  async function saveAnnouncement(publish = false) {
    setSaving(true);
    setError(null);
    try {
      const prepared = buildSavePayload(form);
      const validationError = validateAnnouncementConfig(prepared);
      if (validationError) {
        throw new Error(validationError);
      }

      const payload = {
        ...prepared,
        status: publish ? "active" : (prepared.status ?? "draft"),
        published_at: publish ? new Date().toISOString() : prepared.published_at,
      };

      const response = await fetch(
        editingId
          ? `/api/admin/in-app-announcements/${editingId}`
          : "/api/admin/in-app-announcements",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        item?: InAppAnnouncement;
        error?: string;
      };
      if (!response.ok || !result.item) {
        throw new Error(result.error ?? "Save failed.");
      }

      const savedId = result.item.id;
      if (form.audience_type === "custom_users") {
        const recipientsRes = await fetch(
          `/api/admin/in-app-announcements/${savedId}/recipients`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds: selectedUserIds }),
          },
        );
        const recipientsPayload = (await recipientsRes.json()) as { error?: string };
        if (!recipientsRes.ok) {
          throw new Error(recipientsPayload.error ?? "Failed to save recipients.");
        }
      }

      setEditorOpen(false);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setError(null);
    const response = await fetch(`/api/admin/in-app-announcements/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Status update failed.");
      return;
    }
    await loadItems();
  }

  async function duplicateAnnouncement(id: string) {
    const response = await fetch(
      `/api/admin/in-app-announcements/${id}/duplicate`,
      { method: "POST" },
    );
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Duplicate failed.");
      return;
    }
    await loadItems();
  }

  async function searchUsers(page = 1) {
    setUserSearchLoading(true);
    setUserSearchError(null);
    try {
      const params = new URLSearchParams();
      if (userSearch.trim()) params.set("q", userSearch.trim());
      params.set("page", String(page));
      params.set("pageSize", "20");
      const response = await fetch(
        `/api/admin/in-app-announcements/users-search?${params.toString()}`,
      );
      const payload = (await response.json()) as {
        users?: UserSearchRow[];
        error?: string;
        totalPages?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "User search failed.");
      }
      setUserResults(payload.users ?? []);
      setUserSearchPage(page);
      setUserSearchTotalPages(payload.totalPages ?? 1);
      if ((payload.users ?? []).length === 0 && userSearch.trim()) {
        setUserSearchError("No users matched your search.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "User search failed.";
      setUserSearchError(message);
      setError(message);
    } finally {
      setUserSearchLoading(false);
    }
  }

  function toggleSelectedUser(user: UserSearchRow) {
    setSelectedUsers((prev) => {
      const exists = prev.some((row) => row.id === user.id);
      if (exists) {
        return prev.filter((row) => row.id !== user.id);
      }
      return [...prev, user];
    });
  }

  function removeSelectedUser(userId: string) {
    setSelectedUsers((prev) => prev.filter((row) => row.id !== userId));
  }

  const previewButtons = useMemo(
    () => ({
      close: form.close_button ?? DEFAULT_CLOSE_BUTTON,
      primary: form.primary_button ?? DEFAULT_PRIMARY_BUTTON,
    }),
    [form.close_button, form.primary_button],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Notifications → In-App Pop-ups
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Create image-based announcements with overlay buttons and optional audio.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Create New
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or description"
          className={`${fieldClass} min-w-[220px]`}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${selectClass} w-auto min-w-[160px]`}
        >
          <option value="all">All statuses</option>
          {ANNOUNCEMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void loadItems()}
          className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No announcements yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {item.internal_name}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{categoryLabel(item.category)}</td>
                    <td className="px-4 py-3 capitalize text-slate-700">{item.status}</td>
                    <td className="px-4 py-3 text-slate-700">{audienceLabel(item.audience_type)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {item.trigger_type}
                      {item.trigger_feature_key
                        ? ` / ${item.trigger_feature_key}`
                        : ""}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {new Date(item.updated_at).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-indigo-600 hover:underline"
                          onClick={() => void openEdit(item.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-indigo-600 hover:underline"
                          onClick={() => {
                            setForm(item);
                            setPreviewOpen(true);
                          }}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          className="text-indigo-600 hover:underline"
                          onClick={() => void duplicateAnnouncement(item.id)}
                        >
                          Duplicate
                        </button>
                        {item.status !== "active" ? (
                          <button
                            type="button"
                            className="text-emerald-600 hover:underline"
                            onClick={() => void setStatus(item.id, "active")}
                          >
                            Publish
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-amber-600 hover:underline"
                            onClick={() => void setStatus(item.id, "unpublished")}
                          >
                            Unpublish
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-rose-600 hover:underline"
                          onClick={() => void setStatus(item.id, "unpublished")}
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editorOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-6 w-full max-w-5xl rounded-2xl bg-white p-6 text-slate-900 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {editingId ? "Edit Announcement" : "Create Announcement"}
              </h3>
              <button
                type="button"
                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                onClick={() => setEditorOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-3">
                <h4 className={sectionTitleClass}>Basic Details</h4>
                <input
                  className={fieldClass}
                  placeholder="Internal Notification Name"
                  value={form.internal_name ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, internal_name: e.target.value }))
                  }
                />
                <textarea
                  className={textareaClass}
                  placeholder="Internal Description"
                  rows={3}
                  value={form.internal_description ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      internal_description: e.target.value,
                    }))
                  }
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700">
                      Category
                    </label>
                    <select
                      className={selectClass}
                      value={form.category ?? "other"}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          category: e.target.value as InAppAnnouncement["category"],
                        }))
                      }
                    >
                      {ANNOUNCEMENT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {categoryLabel(category)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700">
                      Display Priority
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      className={fieldClass}
                      value={form.priority ?? 100}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          priority: Number(e.target.value),
                        }))
                      }
                    />
                    <p className={`${helperClass} mt-1`}>
                      Lower numbers appear first when multiple announcements are
                      eligible. Default is 100. Mandatory notices still rank
                      above non-mandatory categories.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h4 className={sectionTitleClass}>UI Image</h4>
                {form.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.image_url}
                    alt="Announcement preview"
                    className="max-h-64 w-full rounded-lg border border-slate-200 bg-black object-contain"
                  />
                ) : null}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-700"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload("image", file);
                  }}
                />
                {uploading === "image" ? (
                  <p className={helperClass}>Uploading image…</p>
                ) : null}
              </section>

              <section className="space-y-3">
                <h4 className={sectionTitleClass}>Show To</h4>
                <select
                  className={selectClass}
                  value={form.audience_type ?? "all_users"}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      audience_type: e.target.value as InAppAnnouncement["audience_type"],
                    }))
                  }
                >
                  {AUDIENCE_TYPES.map((audience) => (
                    <option key={audience} value={audience}>
                      {audienceLabel(audience)}
                    </option>
                  ))}
                </select>
                {form.audience_type === "active_users" ? (
                  <input
                    type="number"
                    className={fieldClass}
                    placeholder="Active within days"
                    value={form.active_within_days ?? 30}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        active_within_days: Number(e.target.value),
                      }))
                    }
                  />
                ) : null}
                {form.audience_type === "custom_users" ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex gap-2">
                      <input
                        className={fieldClass}
                        placeholder="Search name / mobile / member id"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void searchUsers(1);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="h-11 shrink-0 rounded-xl bg-slate-800 px-3 text-sm font-semibold text-white hover:bg-slate-900"
                        onClick={() => void searchUsers(1)}
                      >
                        Search
                      </button>
                    </div>
                    {userSearchLoading ? (
                      <p className={helperClass}>Searching…</p>
                    ) : null}
                    {userSearchError ? (
                      <p className="text-xs text-rose-600">{userSearchError}</p>
                    ) : null}
                    <p className="text-sm text-slate-600">
                      Selected users: {selectedUserIds.length}
                    </p>
                    {selectedUsers.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedUsers.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
                            onClick={() => removeSelectedUser(user.id)}
                            title="Remove selected user"
                          >
                            {user.fullName} · {user.phone} ×
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {userResults.length === 0 && !userSearchLoading ? (
                        <p className={helperClass}>
                          Search by name, 10-digit mobile, or member UUID.
                        </p>
                      ) : null}
                      {userResults.map((user) => {
                        const checked = selectedUserIds.includes(user.id);
                        return (
                          <label key={user.id} className={labelClass}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelectedUser(user)}
                            />
                            <span>
                              {user.fullName} · {user.phone}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {userSearchTotalPages > 1 ? (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          className={secondaryBtnClass}
                          disabled={userSearchLoading || userSearchPage <= 1}
                          onClick={() => void searchUsers(userSearchPage - 1)}
                        >
                          Previous
                        </button>
                        <span className={helperClass}>
                          Page {userSearchPage} of {userSearchTotalPages}
                        </span>
                        <button
                          type="button"
                          className={secondaryBtnClass}
                          disabled={
                            userSearchLoading ||
                            userSearchPage >= userSearchTotalPages
                          }
                          onClick={() => void searchUsers(userSearchPage + 1)}
                        >
                          Next
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="space-y-3">
                <h4 className={sectionTitleClass}>Actions & Dismissal</h4>
                <label className={labelClass}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.show_close)}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, show_close: e.target.checked }))
                    }
                  />
                  Show Close (×)
                </label>
                <label className={labelClass}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.outside_tap_closes)}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        outside_tap_closes: e.target.checked,
                      }))
                    }
                  />
                  Outside tap closes
                </label>
                <label className={labelClass}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.auto_dismiss)}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        auto_dismiss: e.target.checked,
                        auto_dismiss_seconds: e.target.checked
                          ? Math.max(prev.auto_dismiss_seconds ?? 3, 1)
                          : null,
                      }))
                    }
                  />
                  Auto dismiss
                </label>
                {form.auto_dismiss ? (
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700">
                      Auto dismiss seconds
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3600}
                      className={fieldClass}
                      value={form.auto_dismiss_seconds ?? 3}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          auto_dismiss_seconds: Math.max(
                            1,
                            Number(e.target.value) || 1,
                          ),
                        }))
                      }
                    />
                    <p className={`${helperClass} mt-1`}>
                      Must be at least 1 second. Set Auto dismiss off to disable
                      the timer completely.
                    </p>
                  </div>
                ) : null}
                <label className={labelClass}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.is_mandatory)}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        is_mandatory: e.target.checked,
                        record_acceptance: e.target.checked
                          ? true
                          : prev.record_acceptance,
                      }))
                    }
                  />
                  Mandatory / record acceptance
                </label>
                <input
                  className={fieldClass}
                  placeholder="Content version"
                  value={form.content_version ?? "1"}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, content_version: e.target.value }))
                  }
                />
              </section>

              <section className="space-y-3">
                <h4 className={sectionTitleClass}>Audio</h4>
                <label className={labelClass}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.audio_enabled)}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, audio_enabled: e.target.checked }))
                    }
                  />
                  Audio enabled
                </label>
                <input
                  type="file"
                  accept="audio/*"
                  className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-700"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload("audio", file);
                  }}
                />
                {form.audio_url ? (
                  <audio controls src={form.audio_url} className="w-full" />
                ) : null}
                <p className={helperClass}>
                  TTS generation interface is reserved for a future backend provider.
                  Upload audio is fully supported.
                </p>
              </section>

              <section className="space-y-3">
                <h4 className={sectionTitleClass}>Trigger & Schedule</h4>
                <select
                  className={selectClass}
                  value={form.trigger_type ?? "app_open"}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      trigger_type: e.target.value as InAppAnnouncement["trigger_type"],
                    }))
                  }
                >
                  <option value="app_open">App Open</option>
                  <option value="feature_open">Specific Feature Open</option>
                </select>
                {form.trigger_type === "feature_open" ? (
                  <select
                    className={selectClass}
                    value={form.trigger_feature_key ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        trigger_feature_key: e.target.value || null,
                      }))
                    }
                  >
                    <option value="">Select screen</option>
                    {screenRegistry.map((feature) => (
                      <option key={feature.key} value={feature.key}>
                        {feature.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {form.trigger_type === "feature_open" &&
                form.trigger_feature_key &&
                !screenRegistry.some(
                  (screen) => screen.key === form.trigger_feature_key,
                ) ? (
                  <p className="text-xs text-amber-700">
                    Saved screen key &quot;{form.trigger_feature_key}&quot; is
                    not in the current app registry. It will remain stored but
                    may not trigger on older app versions.
                  </p>
                ) : null}
                {(["starts_at", "ends_at"] as const).map((field) => {
                  const local = toDateTimeLocal(form[field]);
                  const day = local.slice(0, 10);
                  const time24 = local.slice(11, 16);
                  const hour24 = time24 ? Number(time24.slice(0, 2)) : 9;
                  const minute = time24 ? Number(time24.slice(3, 5)) : 0;
                  const period = hour24 >= 12 ? "PM" : "AM";
                  const hour12 = hour24 % 12 || 12;
                  const updatePart = (nextDay: string, nextHour: number, nextMinute: number, nextPeriod: string) => {
                    if (!nextDay) {
                      setForm((prev) => ({ ...prev, [field]: null }));
                      return;
                    }
                    const h = (nextHour % 12) + (nextPeriod === "PM" ? 12 : 0);
                    const wall = nextDay + "T" + String(h).padStart(2, "0") + ":" + String(nextMinute).padStart(2, "0") + ":00+05:30";
                    const parsed = new Date(wall);
                    if (!Number.isNaN(parsed.getTime())) {
                      setForm((prev) => ({ ...prev, [field]: parsed.toISOString() }));
                    }
                  };
                  return (
                    <div key={field} className="space-y-2">
                      <label className="block text-sm font-semibold text-slate-700">
                        {field === "starts_at" ? "Start" : "End"} (IST)
                      </label>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                        <input type="date" aria-label={field === "starts_at" ? "Start date" : "End date"}
                          className={fieldClass} value={day}
                          onChange={(e) => updatePart(e.target.value, hour12, minute, period)} />
                        <div className="flex items-center gap-1">
                          <select aria-label="Hour" className={selectClass + " min-w-0 flex-1 px-2"}
                            value={hour12} onChange={(e) => updatePart(day, Number(e.target.value), minute, period)}>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
                          </select>
                          <span className="font-bold">:</span>
                          <select aria-label="Minute" className={selectClass + " min-w-0 flex-1 px-2"}
                            value={minute} onChange={(e) => updatePart(day, hour12, Number(e.target.value), period)}>
                            {Array.from({ length: 60 }, (_, i) => i).map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                          </select>
                          <select aria-label="AM or PM" className={selectClass + " min-w-0 flex-1 px-2"}
                            value={period} onChange={(e) => updatePart(day, hour12, minute, e.target.value)}>
                            <option value="AM">AM</option><option value="PM">PM</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">Select date, hour, minute and AM/PM (India time).{!day ? " Select the date first to enable saving the time." : ""}</p>
                    </div>
                  );
                })}
                <select
                  className={selectClass}
                  value={form.frequency ?? "once_per_user"}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, frequency: e.target.value }))
                  }
                >
                  <option value="once_per_user">Once per User</option>
                  <option value="once_per_day">Once per Day</option>
                  <option value="every_app_open">Every App Open</option>
                  <option value="once_per_session">Once per Session</option>
                  <option value="once_per_birthday">Once per Birthday</option>
                  <option value="custom_interval">Custom Interval</option>
                </select>
                {form.frequency === "custom_interval" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-700">
                        Interval Value
                      </label>
                      <input
                        type="number"
                        min={1}
                        className={fieldClass}
                        value={form.custom_interval_value ?? 1}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            custom_interval_value: Math.max(
                              1,
                              Number(e.target.value) || 1,
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-700">
                        Interval Unit
                      </label>
                      <select
                        className={selectClass}
                        value={form.custom_interval_unit ?? "hours"}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            custom_interval_unit: e.target
                              .value as InAppAnnouncement["custom_interval_unit"],
                          }))
                        }
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                    <p className={`${helperClass} col-span-2`}>
                      Example: every 30 minutes, every 6 hours, or every 2 days
                      after the last eligible display.
                    </p>
                  </div>
                ) : null}
                <label className={labelClass}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.is_birthday_template)}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        is_birthday_template: e.target.checked,
                        category: e.target.checked ? "birthday" : prev.category,
                        frequency: e.target.checked
                          ? "once_per_birthday"
                          : prev.frequency,
                      }))
                    }
                  />
                  Birthday template
                </label>
              </section>
            </div>

            {analytics ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <h4 className="mb-2 font-semibold text-slate-900">Analytics</h4>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div>Unique views: {analytics.uniqueViews}</div>
                  <div>Displays: {analytics.totalDisplays}</div>
                  <div>Primary clicks: {analytics.primaryButtonClicks}</div>
                  <div>Acceptances: {analytics.acceptances}</div>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={secondaryBtnClass}
                onClick={() => {
                  setPreviewOpen(true);
                }}
              >
                Preview
              </button>
              <button
                type="button"
                disabled={saving}
                className={secondaryBtnClass}
                onClick={() => void saveAnnouncement(false)}
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={saving}
                className={primaryBtnClass}
                onClick={() => void saveAnnouncement(true)}
              >
                Publish
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-black p-3 shadow-xl">
            <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-black">
              {form.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.image_url}
                  alt="Preview"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-white">
                  No image
                </div>
              )}
              {previewButtons.close.enabled !== false ? (
                <button
                  type="button"
                  className="absolute right-3 top-3 rounded-full bg-black/50 px-3 py-1 text-white"
                >
                  {previewButtons.close.label || "×"}
                </button>
              ) : null}
              {previewButtons.primary.enabled !== false ? (
                <button
                  type="button"
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
                  style={{
                    backgroundColor:
                      previewButtons.primary.backgroundColor ?? "#4F46E5",
                  }}
                >
                  {previewButtons.primary.label || "OK"}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900"
              onClick={() => setPreviewOpen(false)}
            >
              Close Preview
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
