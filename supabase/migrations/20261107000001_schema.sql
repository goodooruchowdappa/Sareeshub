-- Sarees Hub — core schema.
-- All reads/writes from the app go through the functions in 20261107000002_api.sql.
-- Tables have RLS enabled with no policies and no grants for anon/authenticated,
-- so the REST API cannot touch them directly (defence in depth).

-- ─────────────────────────────── Types ───────────────────────────────
do $$ begin
  create type public.shop_kind as enum
    ('shop', 'weaver', 'cooperative', 'manufacturer', 'wholesaler', 'showroom', 'boutique');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.shop_status as enum ('pending', 'approved', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tag_category as enum ('fabric', 'weave', 'work', 'occasion', 'style', 'other');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────── Helpers ───────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.slugify(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), ''), 'item')
$$;

-- Great-circle distance in km (no PostGIS needed; works worldwide).
create or replace function public.distance_km(lat1 double precision, lng1 double precision,
                                               lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe set search_path = '' as $$
  select 6371.0 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Turns free text into a safe prefix tsquery: "pure pat" -> 'pure':* & 'pat':*
create or replace function public.to_prefix_query(p text) returns tsquery
language sql immutable set search_path = '' as $$
  select case
    when coalesce(trim(p), '') = '' then null
    else nullif(array_to_string(array(
      select quote_literal(w) || ':*'
      from regexp_split_to_table(lower(p), '[^[:alnum:]]+') as w
      where length(w) > 0
      limit 8
    ), ' & '), '')::tsquery
  end
$$;

-- ─────────────────────────────── Users ───────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Emails listed here become admins automatically when they sign in.
create table if not exists public.admin_emails (
  email text primary key check (email = lower(email))
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ─────────────────────────────── Plans ───────────────────────────────
create table if not exists public.plans (
  code text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  name text not null,
  description text,
  price_inr integer not null default 0 check (price_inr >= 0),
  duration_days integer not null default 30 check (duration_days between 1 and 1100),
  max_products integer not null check (max_products >= 0),
  max_photos integer not null default 3 check (max_photos between 1 and 30),
  featured boolean not null default false,
  priority integer not null default 0,
  features text[] not null default '{}',
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────── Shops ───────────────────────────────
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  name text not null check (length(name) between 2 and 120),
  kind public.shop_kind not null default 'shop',
  tagline text check (length(tagline) <= 160),
  description text check (length(description) <= 3000),
  owner_name text check (length(owner_name) <= 120),
  phone text not null check (length(phone) between 6 and 20),
  whatsapp text check (length(whatsapp) <= 20),
  email text check (length(email) <= 160),
  website text check (length(website) <= 300),
  instagram text check (length(instagram) <= 120),
  hours text check (length(hours) <= 200),
  established_year integer check (established_year between 1800 and 2100),
  address_line text check (length(address_line) <= 300),
  landmark text check (length(landmark) <= 160),
  locality text check (length(locality) <= 120),
  city text not null check (length(city) between 1 and 120),
  district text check (length(district) <= 120),
  state text check (length(state) <= 120),
  country text not null default 'India',
  country_code text not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  postal_code text check (length(postal_code) <= 20),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  photos text[] not null default '{}',           -- storage paths in bucket "media"; photos[1] is the cover
  status public.shop_status not null default 'pending',
  review_note text check (length(review_note) <= 1000),  -- admin message to the seller
  pending_changes jsonb,                          -- name/kind/location edits waiting for admin review
  rating_avg numeric(2,1) not null default 0,
  rating_count integer not null default 0,
  search tsvector,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shops_status_idx on public.shops (status);
create index if not exists shops_owner_idx on public.shops (owner_id);
create index if not exists shops_geo_idx on public.shops (lat, lng) where status = 'approved';
create index if not exists shops_search_idx on public.shops using gin (search);
drop trigger if exists shops_touch on public.shops;
create trigger shops_touch before update on public.shops
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────── Tags ───────────────────────────────
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (length(name) between 2 and 40),
  category public.tag_category not null default 'other',
  is_default boolean not null default false,   -- curated list shown first in pickers
  hidden boolean not null default false,       -- admin can hide spam/duplicates
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_tags (
  shop_id uuid not null references public.shops(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (shop_id, tag_id)
);
create index if not exists shop_tags_tag_idx on public.shop_tags (tag_id);

-- ─────────────────────────────── Sarees ───────────────────────────────
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  slug text not null unique,
  title text not null check (length(title) between 3 and 140),
  description text check (length(description) <= 3000),
  price_inr integer check (price_inr between 1 and 10000000),   -- null = "price on request"
  mrp_inr integer check (mrp_inr between 1 and 10000000),
  colors text[] not null default '{}',
  length_m numeric(3,1) check (length_m between 1 and 12),
  blouse_included boolean not null default true,
  in_stock boolean not null default true,
  images text[] not null default '{}',
  active boolean not null default true,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_shop_idx on public.products (shop_id);
create index if not exists products_created_idx on public.products (created_at desc);
create index if not exists products_price_idx on public.products (price_inr);
create index if not exists products_search_idx on public.products using gin (search);
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create table if not exists public.product_tags (
  product_id uuid not null references public.products(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (product_id, tag_id)
);
create index if not exists product_tags_tag_idx on public.product_tags (tag_id);

-- ─────────────────────────────── Reviews ───────────────────────────────
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (length(comment) <= 1000),
  hidden boolean not null default false,
  hidden_reason text,
  seller_reply text check (length(seller_reply) <= 1000),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, user_id)
);
create index if not exists reviews_shop_idx on public.reviews (shop_id, created_at desc);
drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

create or replace function public.refresh_shop_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  _shop uuid := coalesce(new.shop_id, old.shop_id);
begin
  update public.shops s set
    rating_avg = coalesce((select round(avg(r.rating)::numeric, 1) from public.reviews r
                           where r.shop_id = _shop and not r.hidden), 0),
    rating_count = (select count(*) from public.reviews r where r.shop_id = _shop and not r.hidden)
  where s.id = _shop;
  if tg_op = 'UPDATE' and old.shop_id <> new.shop_id then
    update public.shops s set
      rating_avg = coalesce((select round(avg(r.rating)::numeric, 1) from public.reviews r
                             where r.shop_id = old.shop_id and not r.hidden), 0),
      rating_count = (select count(*) from public.reviews r where r.shop_id = old.shop_id and not r.hidden)
    where s.id = old.shop_id;
  end if;
  return null;
end $$;
drop trigger if exists reviews_rating on public.reviews;
create trigger reviews_rating after insert or update or delete on public.reviews
  for each row execute function public.refresh_shop_rating();

-- ─────────────────────────────── Buyers ───────────────────────────────
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

-- Daily lead counters shown on the seller dashboard.
create table if not exists public.shop_daily_stats (
  shop_id uuid not null references public.shops(id) on delete cascade,
  day date not null default current_date,
  views integer not null default 0,
  calls integer not null default 0,
  whatsapp integer not null default 0,
  directions integer not null default 0,
  primary key (shop_id, day)
);

-- ─────────────────────────────── Billing ───────────────────────────────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.plans(code),
  amount_paise integer not null check (amount_paise >= 0),
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  provider text not null default 'razorpay' check (provider in ('razorpay', 'manual')),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  method text,
  note text,
  error_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_shop_idx on public.payments (shop_id, created_at desc);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  plan_code text not null references public.plans(code),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists subscriptions_shop_idx on public.subscriptions (shop_id, ends_at desc);

-- ─────────────────────────────── Search vectors ───────────────────────────────
create or replace function public.refresh_shop_search(p_shop uuid) returns void
language sql security definer set search_path = '' as $$
  update public.shops s set search =
    setweight(to_tsvector('simple', coalesce(s.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(s.locality, '') || ' ' || coalesce(s.city, '') || ' ' ||
                                    coalesce(s.district, '') || ' ' || coalesce(s.state, '') || ' ' ||
                                    coalesce(s.country, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce((select string_agg(t.name, ' ') from public.shop_tags st
                                               join public.tags t on t.id = st.tag_id
                                               where st.shop_id = s.id), '')), 'B') ||
    setweight(to_tsvector('simple', replace(s.kind::text, '_', ' ') || ' ' || coalesce(s.tagline, '') || ' ' ||
                                    coalesce(s.description, '')), 'C')
  where s.id = p_shop
$$;

create or replace function public.refresh_product_search(p_product uuid) returns void
language sql security definer set search_path = '' as $$
  update public.products p set search =
    setweight(to_tsvector('simple', coalesce(p.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce((select string_agg(t.name, ' ') from public.product_tags pt
                                               join public.tags t on t.id = pt.tag_id
                                               where pt.product_id = p.id), '')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(p.colors, ' ')), 'B') ||
    setweight(to_tsvector('simple', coalesce(p.description, '')), 'C')
  where p.id = p_product
$$;

create or replace function public.shops_search_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_shop_search(new.id);
  return null;
end $$;
drop trigger if exists shops_search on public.shops;
create trigger shops_search after insert or update of name, kind, tagline, description, locality, city, district, state, country
  on public.shops for each row execute function public.shops_search_trigger();

create or replace function public.products_search_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_product_search(new.id);
  return null;
end $$;
drop trigger if exists products_search on public.products;
create trigger products_search after insert or update of title, description, colors
  on public.products for each row execute function public.products_search_trigger();

-- ─────────────────────────────── Lock down tables ───────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['profiles','admin_emails','user_roles','plans','shops','tags','shop_tags',
                           'products','product_tags','reviews','favorites','shop_daily_stats',
                           'payments','subscriptions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
