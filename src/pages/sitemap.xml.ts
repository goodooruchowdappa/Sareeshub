import type { APIRoute } from "astro";
import { load } from "../lib/server";
import { absoluteUrl } from "../lib/format";

type Entries = { shops: { slug: string; updated_at: string }[]; products: { slug: string; updated_at: string }[]; tags: { slug: string }[] };
const STATIC = ["/", "/map", "/sarees", "/sell", "/about", "/contact", "/privacy", "/terms", "/refund-policy", "/shipping-policy"];

export const GET: APIRoute = async () => {
  const { data } = await load<Entries>("sitemap_entries");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const url = (loc: string, lastmod?: string, priority = "0.6") =>
    `<url><loc>${esc(absoluteUrl(loc))}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""}<priority>${priority}</priority></url>`;
  const body = [
    ...STATIC.map((p) => url(p, undefined, p === "/" ? "1.0" : "0.7")),
    ...(data?.tags ?? []).map((t) => url(`/collections/${t.slug}`, undefined, "0.7")),
    ...(data?.shops ?? []).map((s) => url(`/shops/${s.slug}`, s.updated_at, "0.8")),
    ...(data?.products ?? []).slice(0, 45000).map((p) => url(`/sarees/${p.slug}`, p.updated_at, "0.6")),
  ].join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
