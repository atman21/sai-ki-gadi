/**
 * Minimal Deno + remote-import ambient types for this Edge Function.
 * The function runs on Supabase Edge (Deno); these declarations let the
 * Next.js TypeScript/ESLint toolchain validate the file without @ts-nocheck.
 */

declare namespace Deno {
  const env: {
    get(key: string): string | undefined;
  };

  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  type DbError = { message: string; code?: string };

  type QueryResult<T> = {
    data: T | null;
    error: DbError | null;
  };

  interface FilterBuilder<T> {
    select(columns?: string): FilterBuilder<T>;
    insert(values: Record<string, unknown>): FilterBuilder<T>;
    update(values: Record<string, unknown>): FilterBuilder<T>;
    delete(): FilterBuilder<T>;
    eq(column: string, value: unknown): FilterBuilder<T>;
    in(column: string, values: readonly unknown[]): FilterBuilder<T>;
    maybeSingle(): Promise<QueryResult<T>>;
    then: Promise<QueryResult<T[]>>["then"];
  }

  export type SupabaseClient = {
    from(table: string): FilterBuilder<Record<string, unknown>>;
    rpc(
      fn: string,
      args?: Record<string, unknown>,
    ): Promise<QueryResult<unknown>>;
  };

  export function createClient(url: string, key: string): SupabaseClient;
}
