/**
 * Detect a service-role key stored under a browser-exposed env name.
 *
 * The name is assembled at runtime so Next.js cannot inline
 * `process.env.NEXT_PUBLIC_*` into a client or server bundle.
 */

const PUBLIC_SERVICE_ROLE_ENV = ["NEXT_PUBLIC", "SUPABASE_SERVICE_ROLE_KEY"].join(
  "_",
);

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function publicServiceRoleConfigured(): boolean {
  return readEnv(PUBLIC_SERVICE_ROLE_ENV).length > 0;
}

export function publicServiceRoleStartupError(): string | null {
  if (!publicServiceRoleConfigured()) return null;
  return "Refusing to start. A service-role key is configured with a public env prefix. Remove that variable and keep only server-only SUPABASE_SERVICE_ROLE_KEY.";
}
