import type { APIRoute } from "astro";
import { PUBLIC_SITE_URL } from "astro:env/client";
import { EMAIL_FROM, getSecret, RESEND_API_BASE } from "astro:env/server";
import { json, serviceClient, userFromRequest } from "../../lib/razorpay.server";

type Mail = { email: string; name: string | null; title: string; body: string | null; link: string | null };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Sends e-mail copies of new notifications (custom requests and replies).
 * Called by the browser right after an action that creates notifications; it flushes whatever is queued,
 * so it needs no cron. Does nothing unless RESEND_API_KEY is set.
 */
export const POST: APIRoute = async ({ request }) => {
  const user = await userFromRequest(request);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const key = getSecret("RESEND_API_KEY");
  if (!key) return json({ sent: 0, skipped: "email not configured" });

  const { data, error } = await serviceClient().rpc("notifications_to_email", { p_limit: 90 });
  if (error) return json({ error: error.message }, 500);
  const mails = (data as Mail[]) ?? [];
  if (mails.length === 0) return json({ sent: 0 });

  const site = PUBLIC_SITE_URL.replace(/\/$/, "");
  const batch = mails.map((m) => {
    const url = `${site}${m.link ?? "/account/requests"}`;
    return {
      from: EMAIL_FROM,
      to: [m.email],
      subject: m.title,
      text: `${m.title}\n\n${m.body ?? ""}\n\nOpen: ${url}\n\n— Sarees Hub`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#18130e">
        <p style="font-size:18px;font-weight:600">${esc(m.title)}</p>
        ${m.body ? `<p>${esc(m.body)}</p>` : ""}
        <p><a href="${esc(url)}" style="display:inline-block;background:#2f4938;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Open Sarees Hub</a></p>
        <p style="color:#655c52;font-size:12px">You get this because you have a Sarees Hub account. Sign in to manage alerts.</p></div>`,
    };
  });
  try {
    const r = await fetch(`${RESEND_API_BASE.replace(/\/$/, "")}/emails/batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!r.ok) console.error("[notify] resend", r.status, await r.text());
    return json({ sent: r.ok ? batch.length : 0 });
  } catch (e) {
    console.error("[notify]", e);
    return json({ sent: 0 }, 502);
  }
};
