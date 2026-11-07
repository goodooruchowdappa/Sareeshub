import { useEffect, useRef, useState } from "react";
import { signInWithGoogle, signOut, useMe } from "../../lib/session";
import { rpc, supabase } from "../../lib/supabase";
import { timeAgo } from "../../lib/format";
import type { Notification } from "../../lib/types";

export default function AccountMenu() {
  const { me, ready } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!ready) return <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" aria-hidden />;

  if (!me)
    return (
      <button type="button" className="btn-outline !px-3 !py-2" onClick={() => signInWithGoogle()}>
        <GoogleIcon /> <span>Sign in</span>
      </button>
    );

  const initials = (me.full_name || me.email || "?").trim().slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-1.5">
    <Bell initial={me.unread ?? 0} />
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 p-0.5 pr-2 text-cream hover:bg-white/15"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {me.avatar_url ? (
          <img src={me.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">
            {initials}
          </span>
        )}
        <span className="hidden max-w-[8rem] truncate text-sm font-medium md:inline">
          {me.full_name?.split(" ")[0] ?? "Account"}
        </span>
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 z-[60] mt-2 w-60 overflow-hidden p-1 text-sm text-ink">
          <div className="border-b border-line px-3 py-2">
            <p className="truncate font-semibold">{me.full_name ?? "Signed in"}</p>
            <p className="truncate text-xs text-muted">{me.email}</p>
          </div>
          <MenuLink href="/account">Saved shops & reviews</MenuLink>
          <MenuLink href="/account/requests">My custom requests</MenuLink>
          {me.shops.length > 0 ? (
            <MenuLink href="/seller">Seller dashboard</MenuLink>
          ) : (
            <MenuLink href="/seller/register">Register your shop</MenuLink>
          )}
          {me.is_admin && <MenuLink href="/admin">Admin portal</MenuLink>}
          <button type="button" role="menuitem" onClick={signOut} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-sand">
            Sign out
          </button>
        </div>
      )}
    </div>
    </div>
  );
}

function Bell({ initial }: { initial: number }) {
  const [unread, setUnread] = useState(initial);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setUnread(initial), [initial]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    try {
      const r = await rpc<{ unread: number; items: Notification[] }>(supabase(), "my_notifications", { p_limit: 20 });
      setItems(r.items);
      if (r.unread > 0) {
        await rpc(supabase(), "mark_notifications_read");
        setUnread(0);
      }
    } catch {
      setItems([]);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open}
              className="relative grid h-9 w-9 place-items-center rounded-full text-cream hover:bg-white/10" data-testid="bell">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-zari-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card fixed inset-x-2 top-16 z-[60] max-h-[70vh] overflow-auto p-1 text-sm text-ink sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80">
          <p className="border-b border-line px-3 py-2 font-semibold">Notifications</p>
          {items === null ? (
            <div className="m-3 h-12 animate-pulse rounded-lg bg-sand" />
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-muted">You're all caught up.</p>
          ) : (
            items.map((n) => (
              <a key={n.id} href={n.link ?? "#"} className={`block rounded-lg px-3 py-2 hover:bg-sand ${n.read ? "" : "bg-brand-50"}`}>
                <p className="font-medium">{n.title}</p>
                {n.body && <p className="line-clamp-2 text-xs text-muted">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-muted">{timeAgo(n.created_at)}</p>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a role="menuitem" href={href} className="block rounded-lg px-3 py-2 hover:bg-sand">
      {children}
    </a>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}
