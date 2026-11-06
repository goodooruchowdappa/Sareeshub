import { defineMiddleware } from "astro:middleware";

// Public pages are the same for every visitor (personal bits load in the browser),
// so we keep a short-lived copy at Cloudflare's edge. This keeps CPU time and database
// reads low on the free plans. Sellers' edits show up within a few minutes.
const CACHEABLE: RegExp[] = [
  /^\/$/,
  /^\/shops\/[^/]+$/,
  /^\/sarees$/,
  /^\/sarees\/[^/]+$/,
  /^\/collections\/[^/]+$/,
  /^\/sitemap\.xml$/,
];
const EDGE_TTL = 180;

export const onRequest = defineMiddleware(async (ctx, next) => {
  const req = ctx.request;
  const url = new URL(req.url);
  const cache: Cache | undefined =
    typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const cacheable =
    import.meta.env.PROD && req.method === "GET" && !!cache && CACHEABLE.some((r) => r.test(url.pathname)) && !url.searchParams.has("fresh");

  if (cacheable) {
    const hit = await cache!.match(req).catch(() => undefined);
    if (hit) return hit;
  }

  const res = await next();
  const h = res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=(), payment=(self \"https://checkout.razorpay.com\")");
  if (!url.pathname.startsWith("/api/")) h.set("X-Frame-Options", "SAMEORIGIN");

  if (cacheable && res.status === 200) {
    h.set("Cache-Control", `public, max-age=60, s-maxage=${EDGE_TTL}`);
    try {
      await cache!.put(req, res.clone());
    } catch {
      /* cache is best effort (not available on *.workers.dev or in dev) */
    }
  } else if (!h.has("Cache-Control")) {
    h.set("Cache-Control", "no-store");
  }
  return res;
});
