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
| **Custom saree requests:** upload reference photos, pick saree type, colours, budget, date and distance (sign-in required) | **Custom requests tab:** see requests near you, open one, reply with your photos, price and ready-in days | Moderate requests and replies |
| Free: 1 request / 30 days; Request Pass ₹49 (5) and Request Plus ₹149 (unlimited, 90 days) via Razorpay | Free plan: 3 requests a month, seen after a 2-hour head start; Pro/yearly: unlimited, notified instantly | Set each plan's request allowance in **Plans**; reply cap, expiry, head start in **Custom requests → Request rules** |
| Map never dead-ends: an empty town shows the nearest shops; request form shows how many sellers it will reach and refuses if none; requests nobody answered don't use up the allowance | Alerts for approval / rejection / new reviews; claim a shop the team listed for you | **Add a shop** on a seller's behalf (launch), hand it over by Google email or a verified claim |
| Report a problem on any shop (closed, wrong number, wrong pin, fake…) | | **Reports & claims** queue; alerts for new applications, change requests, reports |
| Replies with photos and prices; shortlist, call or WhatsApp; phone number stays private | Notification bell (+ optional e-mail) for new requests and shortlists | Buyer passes appear in Payments |

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

### 4b. E-mail alerts (optional)
New requests and replies always show in the bell inside the site. To also e-mail them, create a free [Resend](https://resend.com) account (3,000 mails/month), verify your domain `sareeshub.in`, and add the secret `RESEND_API_KEY` (and optionally the variable `EMAIL_FROM`, e.g. `Sarees Hub <alerts@sareeshub.in>`) in Cloudflare.

### Already ran an older `setup.sql`?
Run the newer migration files in order in the SQL Editor, each once — they keep your data:
- [`20261107000004_custom_requests.sql`](supabase/migrations/20261107000004_custom_requests.sql) (custom requests)
- [`20261107000005_real_world.sql`](supabase/migrations/20261107000005_real_world.sql) (reports, claims, admin listings, alerts)

### 5. Keep-alive and CI (GitHub)
- Repository **Settings → Secrets and variables → Actions → Variables:** add `SITE_URL` = `https://yourdomain.in`. The *Keep Supabase awake* workflow then pings `/api/health` twice a week.
- `CI` runs type checks, the 47 database tests, and the build on every push.
- Optional `deploy.yml` deploys on push to `main` if you add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets plus the `PUBLIC_*` variables (skip it if you used Cloudflare's Git import).

### 6. After launch
- Sign in at `/login` with the admin Google account, then go to `/admin`.
- Submit `https://yourdomain.in/sitemap.xml` in [Google Search Console](https://search.google.com/search-console).
- Change plan prices any time in **Admin → Plans** (prices include GST; consult your CA about GST registration).

## How the business works

**Who pays:** sellers pay for visibility and custom-request leads (Pro ₹299/month, yearly plans). Buyers can pay small one-time passes for extra custom requests. Browsing, calling, WhatsApp, directions and reviews are free for buyers. No commission: buyers pay the shop directly, so Sarees Hub never handles saree money, returns or delivery.

**Why sellers upgrade:** top position on the map and search, a featured badge, more sarees and photos, and unlimited custom requests with a head start. Free sellers still get 3 requests a month, which shows them what they're missing.

**Launch plan (what makes or breaks it):**
1. **Fill one area first.** A map with 3 shops loses buyers. Pick one cluster (e.g. Dharmavaram + Anantapur + Hindupur) and use **Admin → + Add a shop** to list 50–100 shops and weavers you have called or visited. They show as “Listed by Sarees Hub”.
2. **Hand shops to owners.** Visit or call them, show their page, and type their Google email in the shop drawer (or they tap “Claim it” on the page and you verify by calling the listed number). Give early sellers 2–3 months of Pro free (**Grant plan**, amount 0) so they reply to custom requests.
3. **Then bring buyers** with WhatsApp groups, Instagram reels of shops, and Google (each shop and `/collections/…` page is built to rank for “pure pattu sarees near me”). Ask happy buyers to leave reviews.
4. **Start charging** once sellers are getting calls (the seller dashboard shows views, calls and WhatsApp taps).
5. **Expand** to the next weaving cluster (Kanchipuram, Pochampally, Gadwal…).

**Daily admin work (15–30 min):** approve new shops (call the number first), clear Reports & claims, glance at Custom requests for spam.

**Not built yet (later phases):** Telugu / Kannada / Tamil / Hindi pages; WhatsApp alerts to sellers (paid per message via the WhatsApp Business API, so only worth it once sellers pay); auto-hiding shops that never respond; GST invoices for plan payments (needed once you register for GST — Razorpay can generate them).

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
npm run test:db           # 47 database tests: security rules, approvals, plan limits, payments, reviews, tags, custom requests, reports, claims
```

`tests/e2e/run.py` drives Chrome through 31 real flows (reports, claims, admin listings, empty-town fallback, custom saree requests with plan-based routing, buyer passes and seller replies, map, search, reviews, seller registration on a phone with GPS pin and photo upload, admin approval, change requests, saree upload, Razorpay order → signature → activation → webhook). It runs against a local Postgres plus a mock of Supabase/Photon/Razorpay — see [`tests/README.md`](tests/README.md).

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
