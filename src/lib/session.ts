import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { rpc, supabase } from "./supabase";
import type { Me } from "./types";

let mePromise: Promise<Me | null> | null = null;

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

/** Signed-in user's profile + roles (cached for the page). */
export function loadMe(force = false): Promise<Me | null> {
  if (!mePromise || force) {
    mePromise = (async () => {
      const s = await getSession();
      if (!s) return null;
      try {
        return await rpc<Me>(supabase(), "me");
      } catch {
        return null;
      }
    })();
  }
  return mePromise;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadMe().then((m) => {
      if (alive) {
        setMe(m);
        setReady(true);
      }
    });
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        loadMe(true).then((m) => alive && setMe(m));
      }
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return { me, ready, refresh: () => loadMe(true).then(setMe) };
}

export function signInWithGoogle(next = window.location.pathname + window.location.search) {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
  return supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
}

export async function signOut() {
  await supabase().auth.signOut();
  mePromise = null;
  window.location.href = "/";
}

export const safeNext = (n: string | null | undefined) =>
  n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/auth") ? n : "/";

/** Redirects to /login when there is no session. Returns the session token for API calls. */
export async function requireSession(): Promise<Session | null> {
  const s = await getSession();
  if (!s) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return null;
  }
  return s;
}
