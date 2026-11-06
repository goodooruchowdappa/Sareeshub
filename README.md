# Sarees Hub

Find saree shops, handloom weavers, co-op societies, wholesalers and showrooms on a map — in India or anywhere else — browse their sarees, and call, WhatsApp or get directions directly. Sellers register for free, admins approve them, and sellers can buy visibility plans through Razorpay.

## What's inside

| For buyers | For sellers | For admins |
|---|---|---|
| Map of shops near you (GPS or search any town worldwide) | Free registration with Zepto-style drop-a-pin location (current location, search, or drag) | Approve / reject (with a note) / suspend shops |
| Filter by type (shop, weaver, co-op…) and speciality (Pure Pattu, Semi Pattu, Kanchipuram…) | Shop photos (auto-compressed to WebP in the browser) | Review name / location change requests |
| Saree catalogue: search, tag filters, price bands, near me, sort | Saree catalogue with photos, price/MRP, colours, tags | Moderate reviews (hide/restore; ratings recalculate) |
| Shop & saree pages with call, WhatsApp (pre-filled message), directions, share | Pick default tags or create new ones (e.g. “Gadwal Pattu”) | Manage tags: mark common, hide spam, merge duplicates |
| Google sign-in to review shops and save favourites | Lead stats: views, calls, WhatsApp, directions (30 days) | Edit plans & prices, record offline UPI payments |
| | Reply to reviews; edits to name/location go for review | Payments list + CSV export, team (add admins by email) |
| | Buy Pro / yearly plans with Razorpay (UPI, cards, netbanking) | Overview: pending, revenue, leads |

SEO: server-rendered pages with titles, descriptions, canonical URLs, Open Graph/Twitter cards, JSON-LD (`ClothingStore`, `Product`, `BreadcrumbList`, `FAQPage`, `WebSite` search), `sitemap.xml`, `robots.txt`, web manifest and icons. Collection pages (e.g. `/collections/pure-pattu`) target searches like “pure pattu sarees near me”.

## Stack and why

| Piece | Choice | Why |
|---|---|---|
| Web app | **Astro 7** (server-rendered HTML) + React for interactive parts | Fast pages and proper meta tags for Google/WhatsApp previews; small CPU use per page, so it fits Cloudflare's free plan (10 ms CPU limit) where heavier frameworks often don't |
| Hosting | **Cloudflare Workers** | Free: 100,000 requests/day, commercial use allowed. Upgrade path: $5/month (~₹450) |
| Database, Google login, photos | **Supabase** | Free: 500 MB database, 1 GB photos, 50k monthly users. All data access goes through tested Postgres functions with row-level security |
| Map | **MapLibre + OpenFreeMap** tiles | No API key, no usage limits, commercial use allowed |
| Address search / reverse geocoding | **Photon** (OpenStreetMap data) | Free, search-as-you-type, worldwide |
| Payments | **Razorpay Standard Checkout** | Orders API → checkout → HMAC signature check → payment re-verified with Razorpay → webhook backup, idempotent |

**Running cost:** ₹0 + your domain (~₹800–1,200/year). Pages are cached at Cloudflare's edge for 3 minutes, which keeps you well inside the free limits. Free Supabase projects pause after 7 days with no traffic; the included GitHub Action pings the site twice a week to prevent that.

## Set up (about 45 minutes)

### 1. Supabase
1. Create a **new** project at [supabase.com](https://supabase.com) (region: Mumbai `ap-south-1`). Use a new project — the old Lovable project's tables have different shapes.
2. **SQL Editor → New query →** paste the whole of [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
   - It creates the tables, security rules, functions, plans, ~65 common saree tags and the `media` photo bucket.
   - It makes **goodooruchowdappa@gmail.com** an admin. To use a different admin email, change it in the file before running (search for `admin_emails`). More admins can be added later from **Admin → Team**.
3. **Project Settings → API:** copy the Project URL, the `anon`/publishable key and the `service_role`/secret key.

### 2. Google sign-in
1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **OAuth consent screen**: External, app name “Sarees Hub”, your support email, authorised domain = your domain. Publish the app.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorised JavaScript origins: `https://yourdomain.in`
   - Authorised redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Supabase → **Authentication → Sign In / Providers → Google**: paste the client ID and secret, enable.
4. Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://yourdomain.in`
   - Redirect URLs: `https://yourdomain.in/auth/callback`, `http://localhost:4321/auth/callback`

### 3. Cloudflare (hosting + domain)
1. Create a free Cloudflare account and add your domain (change the nameservers at your registrar).
2. Easiest: **Workers & Pages → Create → Import a repository** → pick this repo.
   - Build command `npm run build`, deploy command `npx wrangler deploy`.
   - Build variables: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_SITE_URL` (e.g. `https://sareeshub.in`), `PUBLIC_CONTACT_EMAIL`, `PUBLIC_CONTACT_PHONE`, `PUBLIC_BUSINESS_NAME`, `PUBLIC_BUSINESS_ADDRESS`.
   - **Settings → Variables and Secrets** (type *Secret*): `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
   - **Settings → Domains & Routes → Add custom domain** → `sareeshub.in` (and `www`).
3. From your computer instead: `npm ci && npm run build && npx wrangler deploy`, then `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (and the three Razorpay secrets).

### 4. Razorpay
1. Sign up at [razorpay.com](https://razorpay.com) and finish KYC. Razorpay checks your site for **Contact, Terms, Privacy, Refund and Shipping** pages — they're already at `/contact`, `/terms`, `/privacy`, `/refund-policy`, `/shipping-policy`. Review the wording and set `PUBLIC_BUSINESS_NAME` / `PUBLIC_BUSINESS_ADDRESS` to your legal details.
2. **Settings → API Keys:** generate keys (start with Test mode) → set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Settings → Payment Capture:** automatic capture (the app also captures authorised payments itself if needed).
4. **Settings → Webhooks → Add:** URL `https://yourdomain.in/api/pay/webhook`, events `payment.captured`, `payment.failed`, `order.paid`, choose a secret → set it as `RAZORPAY_WEBHOOK_SECRET`.
5. Test with a test card or UPI `success@razorpay`, then switch to Live keys.

Until Razorpay is set up, sellers see “Online payments aren't switched on yet”, and you can record UPI/cash payments from **Admin → shop → Grant plan**.

### 5. Keep-alive and CI (GitHub)
- Repository **Settings → Secrets and variables → Actions → Variables:** add `SITE_URL` = `https://yourdomain.in`. The *Keep Supabase awake* workflow then pings `/api/health` twice a week.
- `CI` runs type checks, the 29 database security tests, and the build on every push.
- Optional `deploy.yml` deploys on push to `main` if you add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets plus the `PUBLIC_*` variables (skip it if you used Cloudflare's Git import).

### 6. After launch
- Sign in at `/login` with the admin Google account, then go to `/admin`.
- Submit `https://yourdomain.in/sitemap.xml` in [Google Search Console](https://search.google.com/search-console).
- Change plan prices any time in **Admin → Plans** (prices include GST; consult your CA about GST registration).

## Local development

```sh
npm ci
cp .env.example .env      # fill in your Supabase values
npm run dev               # http://localhost:4321 (runs on the real Workers runtime)
```

Add `http://localhost:4321/auth/callback` to Supabase redirect URLs to test Google sign-in locally.

## Tests

```sh
npm run check             # TypeScript / Astro
npm run test:db           # 29 database tests: security rules, approvals, plan limits, payments, reviews, tags
```

`tests/e2e/run.py` drives Chrome through 19 real flows (map, search, reviews, seller registration on a phone with GPS pin and photo upload, admin approval, change requests, saree upload, Razorpay order → signature → activation → webhook). It runs against a local Postgres plus a mock of Supabase/Photon/Razorpay — see [`tests/README.md`](tests/README.md).

## How the code is organised

```
src/pages/            Routes (server-rendered .astro pages and /api endpoints)
  index, map, sarees/, shops/, collections/, sell, login, account, seller/, admin
  api/pay/order|verify|webhook   Razorpay (secrets stay on the server)
src/components/islands/  React parts: MapExplorer, LocationPicker, TagPicker, ImageUploader,
                         ShopForm, SellerApp, AdminApp, ReviewForm…
src/lib/              Supabase client, formatting, geocoding, image compression, Razorpay helpers
src/middleware.ts     Security headers + 3-minute edge cache for public pages
supabase/migrations/  Schema → API functions → seed (plans, tags, admin, storage)
supabase/setup.sql    All migrations in one file for the SQL editor
```

**Security model.** Tables aren't reachable through Supabase's REST API at all; the browser can only call the Postgres functions in `20261107000002_api.sql`, and each function checks who is calling (owner, admin, signed in). Payment functions can only be called with the service key from the server. Photos can only be uploaded into the uploader's own folder. All of this is covered by `tests/db/api.test.ts`.

**Rules worth knowing**
- New shops stay hidden until an admin approves them. Rejected shops go back to *pending* when the seller edits them.
- On approved shops, contact details, photos, hours and tags update instantly. Name, business type and location changes (pin moves over 300 m) wait for admin review.
- Reviews publish immediately; admins can hide abusive ones, and users can't un-hide them. Owners can't review their own shop.
- Plan limits (sarees and shop photos) are enforced in the database. Buying the same plan again extends it.
