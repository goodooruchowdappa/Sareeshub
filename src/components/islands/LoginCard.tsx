import { useEffect, useState } from "react";
import { getSession, safeNext, signInWithGoogle } from "../../lib/session";
import { GoogleIcon } from "./AccountMenu";

export default function LoginCard() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = safeNext(new URLSearchParams(window.location.search).get("next"));
  const reason = new URLSearchParams(window.location.search).get("error");

  useEffect(() => {
    getSession().then((s) => s && window.location.replace(next));
  }, [next]);

  async function go() {
    setBusy(true);
    setErr(null);
    const { error } = await signInWithGoogle(next);
    if (error) {
      setErr(error.message);
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h1 className="text-3xl">Sign in to Sarees Hub</h1>
      <p className="mt-2 text-sm text-muted">
        Use your Google account to review shops, save favourites, or register your shop. We never post anything on your behalf.
      </p>
      {reason && <p className="mt-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">Sign-in didn't complete. Please try again.</p>}
      <button onClick={go} disabled={busy} className="btn-outline mt-6 w-full !py-3 text-base">
        <GoogleIcon /> {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {err && <p className="mt-3 text-sm text-brand-700">{err}</p>}
      <p className="mt-6 text-xs text-muted">
        By continuing you agree to our <a className="underline" href="/terms">Terms</a> and <a className="underline" href="/privacy">Privacy Policy</a>.
      </p>
    </div>
  );
}
