import type { APIRoute } from "astro";
import { load } from "../../lib/server";

// Pinged by a scheduled GitHub Action so the free Supabase project never pauses for inactivity.
export const GET: APIRoute = async () => {
  const { data, error } = await load<{ ok: boolean }>("health");
  return Response.json({ ok: !!data?.ok, error: error ? "database unreachable" : null }, { status: data?.ok ? 200 : 503 });
};
