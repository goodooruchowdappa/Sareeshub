import { rpc, serverClient } from "./supabase";

/** Loads data for SSR pages. Returns null (→ 503 page) instead of crashing if the database is unreachable. */
export async function load<T>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await rpc<T>(serverClient(), fn, args), error: null };
  } catch (e) {
    console.error(`[load] ${fn}`, e);
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export const num = (v: string | null) => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
