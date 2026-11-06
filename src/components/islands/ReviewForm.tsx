import { useEffect, useState } from "react";
import { rpc, supabase } from "../../lib/supabase";
import { getSession, signInWithGoogle } from "../../lib/session";
import { GoogleIcon } from "./AccountMenu";

type MyReview = { id: string; rating: number; comment: string | null; hidden: boolean } | null;

export default function ReviewForm({ shopId, shopName }: { shopId: string; shopName: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [mine, setMine] = useState<MyReview>(null);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getSession().then(async (s) => {
      setSignedIn(!!s);
      if (s) {
        const r = await rpc<MyReview>(supabase(), "my_review", { p_shop: shopId }).catch(() => null);
        if (r) {
          setMine(r);
          setRating(r.rating);
          setComment(r.comment ?? "");
        }
      }
    });
  }, [shopId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setMsg({ ok: false, text: "Tap the stars to choose a rating." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await rpc<MyReview>(supabase(), "upsert_review", { p_shop: shopId, p_rating: rating, p_comment: comment });
      setMine(r);
      setOpen(false);
      setMsg({ ok: true, text: "Thanks! Your review is live. It may take a couple of minutes to appear for everyone." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save your review." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete your review?")) return;
    setBusy(true);
    try {
      await rpc(supabase(), "delete_my_review", { p_shop: shopId });
      setMine(null);
      setRating(0);
      setComment("");
      setMsg({ ok: true, text: "Your review was deleted." });
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === null) return <div className="h-12 animate-pulse rounded-xl bg-sand" />;

  if (!signedIn)
    return (
      <div className="rounded-2xl border border-dashed border-line bg-white p-4">
        <p className="text-sm font-semibold">Visited {shopName}?</p>
        <p className="text-sm text-muted">Sign in with Google to rate and review. It takes 10 seconds.</p>
        <button type="button" className="btn-outline mt-3" onClick={() => signInWithGoogle(window.location.pathname + "#reviews")}>
          <GoogleIcon /> Continue with Google
        </button>
      </div>
    );

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            {mine ? (
              <>
                <p>
                  Your review: <strong className="text-zari-600">{"★".repeat(mine.rating)}</strong>
                  {mine.hidden && <span className="ml-1 text-brand-700">(hidden by moderators)</span>}
                </p>
                {mine.comment && <p className="mt-1 whitespace-pre-line text-muted">“{mine.comment}”</p>}
              </>
            ) : (
              <p>Share your experience with other buyers.</p>
            )}
          </div>
          <div className="flex gap-2">
            {mine && (
              <button type="button" className="btn-ghost text-sm" onClick={remove} disabled={busy}>
                Delete
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              {mine ? "Edit review" : "Write a review"}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <fieldset>
            <legend className="label">Your rating</legend>
            <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  aria-pressed={rating === n}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setRating(n)}
                  className="p-0.5"
                >
                  <svg viewBox="0 0 20 20" className={`h-8 w-8 ${(hover || rating) >= n ? "text-zari-500" : "text-line"}`} fill="currentColor">
                    <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z" />
                  </svg>
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="rv-comment">Your review (optional)</label>
            <textarea
              id="rv-comment"
              className="input min-h-28"
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Collection, prices, service, quality…"
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Post review"}</button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-leaf" : "text-brand-700"}`} role="status">{msg.text}</p>}
    </div>
  );
}
