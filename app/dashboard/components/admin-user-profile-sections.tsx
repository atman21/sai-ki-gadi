import type { ReactNode } from "react";

import { PhoneNumberAction } from "@/components/admin/phone-number-action";
import { formatDateTime } from "@/lib/format-datetime";

/** Columns selected for Admin user detail / verification profile views. */
export const ADMIN_USER_DETAIL_SELECT = [
  "id",
  "first_name",
  "last_name",
  "phone",
  "email",
  "business_name",
  "business_description",
  "address_line_1",
  "address_line_2",
  "city",
  "state",
  "pincode",
  "membership_type",
  "membership_started_at",
  "membership_expires_at",
  "membership_duration_days",
  "verified",
  "verification_status",
  "status",
  "created_at",
  "updated_at",
  "last_login_at",
  "last_active_at",
  "profile_image",
  "rating_average",
  "rating_count",
  "trip_points",
  "language",
  "force_profile_photo",
  "welcome_completed",
  "admin_remarks",
  "blood_group",
  "birth_date",
  "date_of_birth",
  "preferred_city",
  "preferred_cities",
  "experience_years",
  "vehicle_experience",
  "user_roles",
  "is_driver",
  "is_car_owner",
  "is_booking_agent",
  "reference_name",
  "reference_phone",
  "reference_code",
  "reference_1_name",
  "reference_1_mobile",
  "reference_2_name",
  "reference_2_mobile",
].join(", ");

export type AdminUserDetail = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  business_description: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  membership_type: string | null;
  membership_started_at: string | null;
  membership_expires_at: string | null;
  membership_duration_days: number | null;
  verified: boolean | null;
  verification_status: string | null;
  status: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
  last_active_at: string | null;
  profile_image: string | null;
  rating_average: number | null;
  rating_count: number | null;
  trip_points: number | null;
  language: string | null;
  force_profile_photo: boolean | null;
  welcome_completed: boolean | null;
  admin_remarks: string | null;
  blood_group: string | null;
  birth_date: string | null;
  date_of_birth: string | null;
  preferred_city: string | null;
  preferred_cities: unknown;
  experience_years: number | null;
  vehicle_experience: unknown;
  user_roles: string[] | null;
  is_driver: boolean | null;
  is_car_owner: boolean | null;
  is_booking_agent: boolean | null;
  reference_name: string | null;
  reference_phone: string | null;
  reference_code: string | null;
  reference_1_name: string | null;
  reference_1_mobile: string | null;
  reference_2_name: string | null;
  reference_2_mobile: string | null;
};

const USER_ROLE_LABELS: Record<string, string> = {
  car_owner: "Car Owner",
  driver: "Driver",
  booking_agent: "Booking Agent",
};

const VEHICLE_EXPERIENCE_LABELS: Record<string, string> = {
  manual_car: "Manual Car",
  automatic_car: "Automatic Car",
  tempo_traveller: "Tempo Traveller",
  mini_bus: "Mini Bus",
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  gu: "Gujarati",
  mr: "Marathi",
  kn: "Kannada",
};

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

/**
 * Normalize a DB row so every Admin profile key exists (null when missing),
 * even if PostgREST omitted a column or the value is empty.
 */
export function normalizeAdminUserDetail(
  row: Record<string, unknown>,
): AdminUserDetail {
  return {
    id: String(row.id ?? ""),
    first_name: asString(row.first_name),
    last_name: asString(row.last_name),
    phone: asString(row.phone),
    email: asString(row.email),
    business_name: asString(row.business_name),
    business_description: asString(row.business_description),
    address_line_1: asString(row.address_line_1),
    address_line_2: asString(row.address_line_2),
    city: asString(row.city),
    state: asString(row.state),
    pincode: asString(row.pincode),
    membership_type: asString(row.membership_type),
    membership_started_at: asString(row.membership_started_at),
    membership_expires_at: asString(row.membership_expires_at),
    membership_duration_days: asNumber(row.membership_duration_days),
    verified: asBoolean(row.verified),
    verification_status: asString(row.verification_status),
    status: asBoolean(row.status),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    last_login_at: asString(row.last_login_at),
    last_active_at: asString(row.last_active_at),
    profile_image: asString(row.profile_image),
    rating_average: asNumber(row.rating_average),
    rating_count: asNumber(row.rating_count),
    trip_points: asNumber(row.trip_points),
    language: asString(row.language),
    force_profile_photo: asBoolean(row.force_profile_photo),
    welcome_completed: asBoolean(row.welcome_completed),
    admin_remarks: asString(row.admin_remarks),
    blood_group: asString(row.blood_group),
    birth_date: asString(row.birth_date),
    date_of_birth: asString(row.date_of_birth),
    preferred_city: asString(row.preferred_city),
    preferred_cities: row.preferred_cities ?? null,
    experience_years: asNumber(row.experience_years),
    vehicle_experience: row.vehicle_experience ?? null,
    user_roles: asStringArray(row.user_roles),
    is_driver: asBoolean(row.is_driver),
    is_car_owner: asBoolean(row.is_car_owner),
    is_booking_agent: asBoolean(row.is_booking_agent),
    reference_name: asString(row.reference_name),
    reference_phone: asString(row.reference_phone),
    reference_code: asString(row.reference_code),
    reference_1_name: asString(row.reference_1_name),
    reference_1_mobile: asString(row.reference_1_mobile),
    reference_2_name: asString(row.reference_2_name),
    reference_2_mobile: asString(row.reference_2_mobile),
  };
}

export function adminUserFullName(user: AdminUserDetail): string {
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  if (name) return name;
  return user.email || user.phone || user.id;
}

const EMPTY = "-";

function displayValue(value: string | number | null | undefined): string {
  if (value == null) return EMPTY;
  const text = String(value).trim();
  return text ? text : EMPTY;
}

function yesNo(value: boolean | null | undefined): string {
  if (value == null) return EMPTY;
  return value ? "Yes" : "No";
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const iso = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function formatUserRoles(roles: string[] | null | undefined): string {
  if (!roles || roles.length === 0) return EMPTY;
  const labels = roles
    .map((role) => USER_ROLE_LABELS[role] ?? role)
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : EMPTY;
}

function formatVehicleExperience(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return EMPTY;
  const labels = raw
    .map((item) => {
      const key = String(item ?? "").trim();
      return key ? (VEHICLE_EXPERIENCE_LABELS[key] ?? key) : null;
    })
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(", ") : EMPTY;
}

function formatPreferredCities(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return EMPTY;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      const city = item.trim();
      if (!city || seen.has(city.toLowerCase())) continue;
      seen.add(city.toLowerCase());
      labels.push(city);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const city = String((item as { city?: unknown }).city ?? "").trim();
    const state = String((item as { state?: unknown }).state ?? "").trim();
    if (!city) continue;
    const key = `${city.toLowerCase()}|${state.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(state ? `${city}, ${state}` : city);
  }
  return labels.length > 0 ? labels.join("; ") : EMPTY;
}

function formatLanguage(value: string | null | undefined): string {
  if (!value?.trim()) return EMPTY;
  const key = value.trim().toLowerCase();
  return LANGUAGE_LABELS[key] ?? value.trim();
}

function formatVerificationStatus(value: string | null | undefined): string {
  if (!value?.trim()) return EMPTY;
  const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "pending") return "Pending";
  if (normalized === "rejected") return "Rejected";
  return value.trim();
}

function formatDateTimeOrEmpty(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const formatted = formatDateTime(value);
  return formatted === "—" ? EMPTY : formatted;
}

function ProfileField({
  label,
  value,
  className,
  valueClassName,
  phone,
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
  /** When set, render Call / WhatsApp actions for this phone value. */
  phone?: string | null;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div
        className={`mt-1 text-sm font-semibold text-slate-900 ${valueClassName ?? ""}`}
      >
        {phone !== undefined ? (
          <PhoneNumberAction phone={phone} emptyLabel={EMPTY} />
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      ) : null}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

/**
 * Always renders every profile field label.
 * Empty / null / [] values show "-" — fields are never hidden.
 */
export function AdminUserProfileSections({
  user,
  aadhaarNumber,
}: {
  user: AdminUserDetail;
  aadhaarNumber?: string | null;
}) {
  return (
    <>
      <Section title="Basic Information">
        <ProfileField
          label="First Name"
          value={displayValue(user.first_name)}
        />
        <ProfileField label="Last Name" value={displayValue(user.last_name)} />
        <ProfileField
          label="Phone"
          value={displayValue(user.phone)}
          phone={user.phone}
        />
        <ProfileField label="Email" value={displayValue(user.email)} />
        <ProfileField
          label="Blood Group"
          value={displayValue(user.blood_group)}
        />
        <ProfileField
          label="Birth Date"
          value={formatDateOnly(user.birth_date)}
        />
        <ProfileField
          label="Date of Birth"
          value={formatDateOnly(user.date_of_birth)}
        />
        <ProfileField
          label="Aadhaar Number"
          value={displayValue(aadhaarNumber)}
        />
      </Section>

      <Section title="Address">
        <ProfileField
          label="Address Line 1"
          value={displayValue(user.address_line_1)}
        />
        <ProfileField
          label="Address Line 2"
          value={displayValue(user.address_line_2)}
        />
        <ProfileField label="City" value={displayValue(user.city)} />
        <ProfileField label="State" value={displayValue(user.state)} />
        <ProfileField label="Pincode" value={displayValue(user.pincode)} />
      </Section>

      <Section title="Professional / Business">
        <ProfileField
          label="Business Name"
          value={displayValue(user.business_name)}
        />
        <ProfileField
          label="Business Description"
          value={displayValue(user.business_description)}
          className="sm:col-span-2"
        />
        <ProfileField
          label="Experience Years"
          value={
            user.experience_years != null
              ? String(user.experience_years)
              : EMPTY
          }
        />
        <ProfileField
          label="Vehicle Experience"
          value={formatVehicleExperience(user.vehicle_experience)}
          className="sm:col-span-2"
        />
      </Section>

      <Section title="Preferences">
        <ProfileField
          label="Preferred Cities"
          value={formatPreferredCities(user.preferred_cities)}
          className="sm:col-span-2"
        />
        <ProfileField
          label="Preferred City"
          value={displayValue(user.preferred_city)}
        />
        <ProfileField
          label="Language"
          value={formatLanguage(user.language)}
        />
      </Section>

      <Section title="Roles">
        <ProfileField label="Is Driver" value={yesNo(user.is_driver)} />
        <ProfileField label="Is Car Owner" value={yesNo(user.is_car_owner)} />
        <ProfileField
          label="Is Booking Agent"
          value={yesNo(user.is_booking_agent)}
        />
        <ProfileField
          label="User Roles"
          value={formatUserRoles(user.user_roles)}
          className="sm:col-span-2 lg:col-span-3"
        />
      </Section>

      <Section title="Reference Information">
        <ProfileField
          label="Reference Name"
          value={displayValue(user.reference_name)}
        />
        <ProfileField
          label="Reference Phone"
          value={displayValue(user.reference_phone)}
          phone={user.reference_phone}
        />
        <ProfileField
          label="Reference Code"
          value={displayValue(user.reference_code)}
        />
        <ProfileField
          label="Reference 1 Name"
          value={displayValue(user.reference_1_name)}
        />
        <ProfileField
          label="Reference 1 Mobile"
          value={displayValue(user.reference_1_mobile)}
          phone={user.reference_1_mobile}
        />
        <div className="hidden lg:block" aria-hidden />
        <ProfileField
          label="Reference 2 Name"
          value={displayValue(user.reference_2_name)}
        />
        <ProfileField
          label="Reference 2 Mobile"
          value={displayValue(user.reference_2_mobile)}
          phone={user.reference_2_mobile}
        />
      </Section>

      <Section title="Membership">
        <ProfileField
          label="Membership Type"
          value={displayValue(user.membership_type)}
        />
        <ProfileField
          label="Membership Started"
          value={formatDateTimeOrEmpty(user.membership_started_at)}
        />
        <ProfileField
          label="Membership Expires"
          value={formatDateTimeOrEmpty(user.membership_expires_at)}
        />
        <ProfileField
          label="Membership Duration"
          value={
            user.membership_duration_days != null
              ? `${user.membership_duration_days} day${user.membership_duration_days === 1 ? "" : "s"}`
              : EMPTY
          }
        />
        <ProfileField
          label="Trip Points"
          value={
            user.trip_points != null ? String(user.trip_points) : EMPTY
          }
        />
        <ProfileField
          label="Average Rating"
          value={
            user.rating_average != null
              ? `${Number(user.rating_average).toFixed(2)}${
                  user.rating_count != null
                    ? ` (${user.rating_count})`
                    : ""
                }`
              : EMPTY
          }
        />
      </Section>

      <Section title="Account / Verification">
        <ProfileField
          label="Verified"
          value={yesNo(user.verified)}
          valueClassName={
            user.verified === true
              ? "text-emerald-600"
              : user.verified === false
                ? "text-amber-600"
                : undefined
          }
        />
        <ProfileField
          label="Verification Status"
          value={formatVerificationStatus(user.verification_status)}
        />
        <ProfileField
          label="Account Status"
          value={
            user.status == null ? EMPTY : user.status ? "Active" : "Blocked"
          }
          valueClassName={
            user.status === true
              ? "text-emerald-600"
              : user.status === false
                ? "text-red-600"
                : undefined
          }
        />
        <ProfileField
          label="Welcome Completed"
          value={yesNo(user.welcome_completed)}
        />
        <ProfileField
          label="Force Profile Photo"
          value={yesNo(user.force_profile_photo)}
        />
        <ProfileField
          label="Admin Remarks"
          value={displayValue(user.admin_remarks)}
          className="sm:col-span-2 lg:col-span-3"
        />
        <ProfileField
          label="Joined"
          value={formatDateTimeOrEmpty(user.created_at)}
        />
        <ProfileField
          label="Updated At"
          value={formatDateTimeOrEmpty(user.updated_at)}
        />
        <ProfileField
          label="Last Login At"
          value={formatDateTimeOrEmpty(user.last_login_at)}
        />
        <ProfileField
          label="Last Active"
          value={formatDateTimeOrEmpty(user.last_active_at)}
        />
      </Section>
    </>
  );
}
