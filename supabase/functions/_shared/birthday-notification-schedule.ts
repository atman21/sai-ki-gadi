/**
 * Compatibility re-export.
 * Canonical Deno copy lives beside the Edge Function so Dashboard/CLI
 * bundling of `send-birthday-notification` does not depend on `../_shared`.
 * Node tests continue to load `lib/birthday/birthday-notification-schedule.ts`.
 */
export * from "../send-birthday-notification/birthday-notification-schedule.ts";
