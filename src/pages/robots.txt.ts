import type { APIRoute } from "astro";
import { absoluteUrl } from "../lib/format";

export const GET: APIRoute = () =>
  new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /seller",
      "Disallow: /account",
      "Disallow: /login",
      "Disallow: /requests/new",
      "Disallow: /auth/",
      "Disallow: /api/",
      "",
      `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } },
  );
