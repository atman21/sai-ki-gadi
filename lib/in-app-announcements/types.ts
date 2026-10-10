export const ANNOUNCEMENT_CATEGORIES = [
  "offer",
  "birthday",
  "important_announcement",
  "feature_information",
  "mandatory_notice",
  "other",
] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "expired",
  "unpublished",
] as const;

export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const AUDIENCE_TYPES = [
  "all_users",
  "active_users",
  "custom_users",
  "free_non_members",
  "gold_members",
  "gold_plus_members",
  "diamond_members",
  "expired_members",
] as const;

export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export const TRIGGER_FEATURE_KEYS = [
  { key: "home", label: "Home", href: "/(app)/(tabs)/home" },
  { key: "requests", label: "Requirements", href: "/(app)/(tabs)/requests" },
  { key: "drivers", label: "Drivers", href: "/(app)/(tabs)/drivers" },
  { key: "membership", label: "Membership", href: "/(app)/account/membership" },
  { key: "my_cars", label: "My Cars", href: "/(app)/account/my-cars" },
  { key: "account", label: "Account", href: "/(app)/account" },
  { key: "exchange", label: "Exchange", href: "/(app)/(tabs)/exchange" },
  { key: "cab_avail", label: "Cab Available", href: "/(app)/(tabs)/cab-avail" },
] as const;

export type TriggerFeatureKey =
  (typeof TRIGGER_FEATURE_KEYS)[number]["key"];

export const BUTTON_POSITIONS = [
  "top_right",
  "bottom_center",
  "bottom_left",
  "bottom_right",
] as const;

export type ButtonPosition = (typeof BUTTON_POSITIONS)[number];

export const BUTTON_STYLES = [
  "icon_only",
  "filled",
  "outline",
  "text",
] as const;

export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export const BUTTON_ACTIONS = [
  "close",
  "record_acceptance",
  "open_app_screen",
  "open_url",
  "submit_form",
  "none",
] as const;

export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

export type AnnouncementButtonConfig = {
  enabled: boolean;
  type:
    | "none"
    | "close"
    | "accept"
    | "agree"
    | "submit"
    | "view_details"
    | "custom";
  label: string;
  position: ButtonPosition;
  style: ButtonStyle;
  backgroundColor: string;
  textColor: string;
  action: ButtonAction;
  /** Must be a key from TRIGGER_FEATURE_KEYS when action is open_app_screen */
  appScreenKey?: TriggerFeatureKey | null;
  /** Approved https URL only when action is open_url */
  url?: string | null;
  /** Predefined form key when action is submit_form */
  formKey?: string | null;
};

export type InAppAnnouncement = {
  id: string;
  internal_name: string;
  category: AnnouncementCategory;
  internal_description: string | null;
  priority: number;
  status: AnnouncementStatus;
  image_url: string | null;
  image_fit: "contain" | "cover";
  background_color: string;
  primary_button: AnnouncementButtonConfig | null;
  secondary_button: AnnouncementButtonConfig | null;
  close_button: AnnouncementButtonConfig | null;
  dismissal_type: string;
  show_close: boolean;
  outside_tap_closes: boolean;
  back_button_closes: boolean;
  auto_dismiss: boolean;
  auto_dismiss_seconds: number | null;
  close_after_audio_ends: boolean;
  delay_after_audio_seconds: number;
  is_mandatory: boolean;
  record_acceptance: boolean;
  content_version: string;
  is_legal_consent: boolean;
  audio_enabled: boolean;
  audio_source: "upload" | "tts";
  audio_url: string | null;
  tts_text: string | null;
  tts_language: "gu" | "hi" | "en" | null;
  audio_autoplay: boolean;
  show_replay_button: boolean;
  show_mute_button: boolean;
  audience_type: AudienceType;
  active_within_days: number | null;
  trigger_type: "app_open" | "feature_open";
  trigger_feature_key: string | null;
  trigger_delay_seconds: number;
  show_once_per_session: boolean;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  frequency: string;
  max_displays_per_user: number | null;
  re_show_after_dismissal: boolean;
  custom_interval_hours: number | null;
  custom_interval_value: number | null;
  custom_interval_unit: "minutes" | "hours" | "days" | null;
  is_birthday_template: boolean;
  birthday_personalize_name: boolean;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_CLOSE_BUTTON: AnnouncementButtonConfig = {
  enabled: true,
  type: "close",
  label: "×",
  position: "top_right",
  style: "icon_only",
  backgroundColor: "rgba(0,0,0,0.45)",
  textColor: "#FFFFFF",
  action: "close",
};

export const DEFAULT_PRIMARY_BUTTON: AnnouncementButtonConfig = {
  enabled: true,
  type: "accept",
  label: "I Understand",
  position: "bottom_center",
  style: "filled",
  backgroundColor: "#4F46E5",
  textColor: "#FFFFFF",
  action: "record_acceptance",
};

export function categoryLabel(category: AnnouncementCategory): string {
  switch (category) {
    case "offer":
      return "Offer";
    case "birthday":
      return "Birthday";
    case "important_announcement":
      return "Important Announcement";
    case "feature_information":
      return "Feature Information";
    case "mandatory_notice":
      return "Mandatory Notice";
    default:
      return "Other";
  }
}

export function audienceLabel(audience: AudienceType): string {
  switch (audience) {
    case "all_users":
      return "All Users";
    case "active_users":
      return "Active Users";
    case "custom_users":
      return "Custom Users";
    case "free_non_members":
      return "Free / Non-Members";
    case "gold_members":
      return "Gold Members";
    case "gold_plus_members":
      return "Gold Plus Members";
    case "diamond_members":
      return "Diamond Members";
    case "expired_members":
      return "Expired Members";
  }
}

export function validateAnnouncementConfig(input: {
  is_mandatory?: boolean;
  record_acceptance?: boolean;
  internal_name?: string;
  status?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  show_close?: boolean;
  outside_tap_closes?: boolean;
  back_button_closes?: boolean;
  auto_dismiss?: boolean;
  auto_dismiss_seconds?: number | null;
  close_after_audio_ends?: boolean;
  priority?: number;
  frequency?: string;
  custom_interval_value?: number | null;
  custom_interval_unit?: string | null;
  audio_enabled?: boolean;
  audio_url?: string | null;
}): string | null {
  const start = input.starts_at ? Date.parse(input.starts_at) : null;
  const end = input.ends_at ? Date.parse(input.ends_at) : null;
  if ((input.starts_at && !Number.isFinite(start)) || (input.ends_at && !Number.isFinite(end))) {
    return "Please enter valid Start and End date/time values.";
  }
  if (start !== null && end !== null && end <= start) {
    return "End date/time must be later than Start date/time.";
  }
  const isWinner = /(?:lucky\\s*draw|daily\\s*winner|winner)/i.test(input.internal_name ?? "");
  if (isWinner && ["active", "scheduled"].includes(input.status ?? "")) {
    if (start === null || end === null) {
      return "Lucky Draw winner notifications require both Start and End date/time.";
    }
    if (end <= Date.now()) {
      return "Cannot publish an expired Lucky Draw winner notification.";
    }
  }
  const mandatory = Boolean(input.is_mandatory);
  if (mandatory) {
    if (input.show_close) {
      return "Mandatory notices cannot show a Close (×) button.";
    }
    if (input.outside_tap_closes) {
      return "Mandatory notices cannot allow outside tap to close.";
    }
    if (input.back_button_closes) {
      return "Mandatory notices cannot allow Android Back to close.";
    }
    if (input.auto_dismiss || input.close_after_audio_ends) {
      return "Mandatory notices cannot auto-dismiss or close after audio.";
    }
    if (!input.record_acceptance) {
      return "Mandatory notices must record acceptance.";
    }
  }

  const priority = Number(input.priority ?? 100);
  if (!Number.isFinite(priority) || priority < 1 || priority > 9999) {
    return "Display priority must be a number between 1 and 9999.";
  }

  if (input.auto_dismiss) {
    const seconds = Number(input.auto_dismiss_seconds ?? 0);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
      return "Auto dismiss must be between 1 and 3600 seconds when enabled.";
    }
  }

  if (input.frequency === "custom_interval") {
    const value = Number(input.custom_interval_value ?? 0);
    const unit = input.custom_interval_unit ?? "hours";
    if (!Number.isFinite(value) || value < 1) {
      return "Custom interval value must be at least 1.";
    }
    const maxByUnit =
      unit === "minutes" ? 10080 : unit === "hours" ? 720 : 365;
    if (value > maxByUnit) {
      return `Custom interval is too large for ${unit}.`;
    }
    if (!["minutes", "hours", "days"].includes(unit)) {
      return "Custom interval unit must be minutes, hours, or days.";
    }
  }

  if (input.audio_enabled && !input.audio_url?.trim()) {
    return "Audio is enabled but no audio file has been uploaded.";
  }

  return null;
}

/** Allow only https URLs for open_url actions. */
export function isApprovedAnnouncementUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}
