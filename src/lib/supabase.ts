import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "astro:env/client";

/** Anonymous client for server-side rendering of public pages. No session, no cookies. */
export function serverClient(): SupabaseClient {
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let browser: SupabaseClient | undefined;
/** Browser client: Google sign-in with PKCE, session kept in localStorage. */
export function supabase(): SupabaseClient {
  if (typeof window === "undefined") return serverClient();
  browser ??= createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return browser;
}

/** Calls a database function and throws a readable Error on failure. */
export async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(friendlyError(error.message));
  return data as T;
}

export function friendlyError(msg: string) {
  if (/JWT|jwt|permission denied for function/.test(msg)) return "Please sign in again to continue.";
  if (/Failed to fetch|NetworkError|fetch failed/.test(msg)) return "Network problem. Check your connection and try again.";
  return msg;
}
