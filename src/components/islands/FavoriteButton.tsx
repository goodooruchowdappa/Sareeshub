import { useEffect, useState } from "react";
import { rpc, supabase } from "../../lib/supabase";
import { getSession, signInWithGoogle } from "../../lib/session";

export default function FavoriteButton({ shopId }: { shopId: string }) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSession().then((s) => {
      if (s) rpc<boolean>(supabase(), "is_favorite", { p_shop: shopId }).then(setSaved).catch(() => {});
    });
  }, [shopId]);

  async function toggle() {
    const s = await getSession();
    if (!s) return signInWithGoogle();
    setBusy(true);
    try {
      setSaved(await rpc<boolean>(supabase(), "toggle_favorite", { p_shop: shopId }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={toggle} disabled={busy} className="btn-outline" aria-pressed={saved}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={saved ? "#557c62" : "none"} stroke={saved ? "#557c62" : "currentColor"} strokeWidth="2">
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" />
      </svg>
      {saved ? "Saved" : "Save"}
    </button>
  );
}
