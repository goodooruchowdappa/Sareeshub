import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "astro:env/client";

type Kind = "view" | "call" | "whatsapp" | "directions";

/** Counts a lead for the seller's dashboard. Fire-and-forget; never blocks the click. */
export function trackShop(shopId: string, kind: Kind, oncePerSession = false) {
  try {
    const key = `sh:t:${kind}:${shopId}`;
    if (oncePerSession) {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    }
    const token = readToken();
    fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/track_shop_event`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token ?? PUBLIC_SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_shop: shopId, p_kind: kind }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Supabase keeps the session in localStorage under sb-<ref>-auth-token. */
function readToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (/^sb-.*-auth-token$/.test(k)) return JSON.parse(localStorage.getItem(k) ?? "{}").access_token ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function shareLink(url: string, title: string, btn?: HTMLElement) {
  if (navigator.share) {
    try {
      await navigator.share({ url, title });
      return;
    } catch {
      /* user cancelled */
    }
  }
  await navigator.clipboard?.writeText(url).catch(() => {});
  if (btn) {
    const old = btn.textContent;
    btn.textContent = "Link copied";
    setTimeout(() => (btn.textContent = old), 1800);
  }
}
