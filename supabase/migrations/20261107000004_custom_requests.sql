-- Sarees Hub — custom saree requests (buyer → nearby sellers), buyer plans, notifications.
--
-- How it works
--  * A signed-in buyer posts a request (reference photos, saree type tags, budget, colours, date, location).
--    How many requests they can post depends on their buyer plan (free allowance or a paid pass).
--  * The request is routed only to approved shops within the buyer's distance, and only to sellers
--    whose plan includes custom requests. Unlimited-plan sellers are notified at once and get a
--    head start; limited-plan sellers (e.g. Free: 3 per 30 days) see it after the head start and
--    spend one of their monthly unlocks to read the full request and reply.
--  * Replies (photos, price, message) are capped per request so buyers aren't flooded.
--  * The buyer's phone number is never shared; buyers contact sellers from the replies.
--  * Admins moderate requests/replies and tune plan allowances and the rules in Settings.

-- ─────────────────────────────── Plans: audience + allowances ───────────────────────────────
alter table public.plans add column if not exists audience text not null default 'seller'
  check (audience in ('seller', 'buyer'));
alter table public.plans add column if not exists lead_quota integer check (lead_quota >= 0);     -- seller: request unlocks per 30 days, null = unlimited
alter table public.plans add column if not exists request_quota integer check (request_quota >= 0); -- buyer: requests per plan period, null = unlimited

update public.plans set lead_quota = 3,
  features = array_append(array_remove(features, 'Custom saree requests: 3 per month'), 'Custom saree requests: 3 per month')
  where code = 'free' and lead_quota is null and audience = 'seller';
update public.plans set lead_quota = null,
  features = array_append(array_remove(features, 'Unlimited custom saree requests + 2-hour head start'), 'Unlimited custom saree requests + 2-hour head start')
  where code in ('pro', 'pro_year', 'premium_year');

insert into public.plans (code, name, description, price_inr, duration_days, max_products, max_photos, featured,
                          priority, features, sort_order, audience, request_quota)
values
  ('buyer_free', 'Free', 'Try it: one custom saree request every 30 days.', 0, 30, 0, 1, false, 0,
   array['1 custom request every 30 days', 'Replies from verified nearby sellers', 'Your phone number stays private'], 0, 'buyer', 1),
  ('buyer_pass', 'Request Pass', 'For a wedding or festival season.', 49, 30, 0, 1, false, 10,
   array['5 custom requests in 30 days', 'Up to 4 reference photos each', 'Your phone number stays private'], 1, 'buyer', 5),
  ('buyer_plus', 'Request Plus', 'For boutiques, stylists and families planning many events.', 149, 90, 0, 1, false, 20,
   array['Unlimited custom requests for 90 days', 'Up to 4 reference photos each', 'Your phone number stays private'], 2, 'buyer', null)
on conflict (code) do nothing;

-- ─────────────────────────────── Settings ───────────────────────────────
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('max_responses_per_request', '10'),
  ('request_expiry_days', '30'),
  ('head_start_hours', '2'),
  ('max_notified_sellers', '40'),
  ('default_radius_km', '50')
on conflict (key) do nothing;

create or replace function public.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = p_key), p_default)
$$;

-- ─────────────────────────────── Tables ───────────────────────────────
alter table public.payments alter column shop_id drop not null;

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.plans(code),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists user_subscriptions_user_idx on public.user_subscriptions (user_id, ends_at desc);

create table if not exists public.custom_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 3 and 120),
  description text check (length(description) <= 2000),
  min_price integer check (min_price between 0 and 10000000),
  max_price integer check (max_price between 0 and 10000000),
  colors text[] not null default '{}',
  images text[] not null default '{}',
  quantity integer not null default 1 check (quantity between 1 and 500),
  needed_by date,
  city text not null check (length(city) between 1 and 120),
  state text,
  country text not null default 'India',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_km integer check (radius_km between 1 and 3000),     -- null = any seller, anywhere
  status text not null default 'open' check (status in ('open', 'closed', 'hidden')),
  closed_reason text check (length(closed_reason) <= 300),
  response_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  check (max_price is null or min_price is null or max_price >= min_price)
);
create index if not exists custom_requests_open_idx on public.custom_requests (status, expires_at);
create index if not exists custom_requests_user_idx on public.custom_requests (user_id, created_at desc);

create table if not exists public.request_tags (
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (request_id, tag_id)
);

create table if not exists public.request_unlocks (
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (request_id, shop_id)
);
create index if not exists request_unlocks_shop_idx on public.request_unlocks (shop_id, unlocked_at desc);

create table if not exists public.request_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  message text not null check (length(message) between 2 and 1000),
  price_inr integer check (price_inr between 1 and 10000000),
  ready_in_days integer check (ready_in_days between 0 and 365),
  images text[] not null default '{}',
  status text not null default 'sent' check (status in ('sent', 'shortlisted', 'declined')),
  hidden boolean not null default false,
  seen_by_buyer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, shop_id)
);
drop trigger if exists request_responses_touch on public.request_responses;
create trigger request_responses_touch before update on public.request_responses
  for each row execute function public.touch_updated_at();

create or replace function public.refresh_response_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare _r uuid := coalesce(new.request_id, old.request_id);
begin
  update public.custom_requests set response_count =
    (select count(*) from public.request_responses where request_id = _r and not hidden)
  where id = _r;
  return null;
end $$;
drop trigger if exists request_responses_count on public.request_responses;
create trigger request_responses_count after insert or update of hidden or delete on public.request_responses
  for each row execute function public.refresh_response_count();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_email_idx on public.notifications (created_at) where emailed_at is null;

do $$
declare t text;
begin
  foreach t in array array['app_settings','user_subscriptions','custom_requests','request_tags','request_unlocks',
                           'request_responses','notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- ─────────────────────────────── Helpers ───────────────────────────────
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link)
$$;

create or replace function public.buyer_plan(p_user uuid) returns public.plans
language sql stable security definer set search_path = '' as $$
  select pl.* from public.plans pl
  where pl.code = coalesce((
    select s.plan_code from public.user_subscriptions s join public.plans p2 on p2.code = s.plan_code
    where s.user_id = p_user and s.starts_at <= now() and s.ends_at > now()
    order by p2.priority desc, s.ends_at desc limit 1), 'buyer_free')
$$;

-- Allowance for the current period: paid passes count from when they started, the free allowance is rolling.
create or replace function public.buyer_status(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _pl public.plans := public.buyer_plan(p_user);
  _since timestamptz;
  _ends timestamptz;
  _used integer;
begin
  if _pl.code = 'buyer_free' or _pl.code is null then
    _since := now() - make_interval(days => coalesce(_pl.duration_days, 30));
  else
    select min(starts_at), max(ends_at) into _since, _ends from public.user_subscriptions
    where user_id = p_user and plan_code = _pl.code and ends_at > now();
  end if;
  select count(*) into _used from public.custom_requests where user_id = p_user and created_at >= _since;
  return jsonb_build_object('plan_code', _pl.code, 'plan_name', _pl.name, 'quota', _pl.request_quota,
    'used', _used, 'remaining', case when _pl.request_quota is null then null else greatest(_pl.request_quota - _used, 0) end,
    'ends_at', _ends);
end $$;

create or replace function public.shop_lead_status(p_shop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('quota', pl.lead_quota, 'plan_name', pl.name,
    'used', (select count(*) from public.request_unlocks u where u.shop_id = p_shop and u.unlocked_at > now() - interval '30 days'),
    'head_start_hours', public.setting_int('head_start_hours', 2))
  from (select (public.shop_plan(p_shop)).*) pl
$$;

-- Can this shop see this request right now?
create or replace function public.request_visible_to_shop(r public.custom_requests, s public.shops) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.status = 'open' and r.expires_at > now() and s.status = 'approved' and r.user_id <> s.owner_id
    and (r.radius_km is null or public.distance_km(r.lat, r.lng, s.lat, s.lng) <= r.radius_km)
    and coalesce((public.shop_plan(s.id)).lead_quota, -1) <> 0
    and ((public.shop_plan(s.id)).lead_quota is null
         or r.created_at <= now() - make_interval(hours => public.setting_int('head_start_hours', 2))
         or exists (select 1 from public.request_unlocks u where u.request_id = r.id and u.shop_id = s.id))
$$;

create or replace function public.request_tag_list(p_request uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.tag_list(array(select tag_id from public.request_tags where request_id = p_request))
$$;

-- ─────────────────────────────── Buyers ───────────────────────────────
create or replace function public.my_buyer_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.buyer_status(public.require_user())
$$;

create or replace function public.create_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _st jsonb;
  _id uuid := gen_random_uuid();
  _images text[];
  _tags uuid[];
  _r public.custom_requests;
  _min integer := nullif(p ->> 'min_price', '')::integer;
  _max integer := nullif(p ->> 'max_price', '')::integer;
  _radius integer := nullif(p ->> 'radius_km', '')::integer;
  _owner uuid;
begin
  perform public.me();
  _st := public.buyer_status(_uid);
  if (_st ->> 'quota') is not null and (_st ->> 'remaining')::integer <= 0 then
    raise exception 'You have used your % custom request allowance. Choose a plan to send more.', _st ->> 'plan_name'
      using errcode = 'P0002';
  end if;
  if length(coalesce(public.nz(p ->> 'title'), '')) < 3 then raise exception 'Describe the saree you want in a few words.'; end if;
  if p ->> 'lat' is null or p ->> 'lng' is null or public.nz(p ->> 'city') is null then
    raise exception 'Choose your city or use your location so we can find sellers near you.';
  end if;
  if _min is not null and _max is not null and _max < _min then raise exception 'The maximum price must be more than the minimum.'; end if;
  if nullif(p ->> 'needed_by', '')::date < current_date then raise exception 'The date needed cannot be in the past.'; end if;
  if (select count(*) from public.custom_requests where user_id = _uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You have sent several requests just now. Please wait a little before sending more.';
  end if;
  _images := public.check_media_paths(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'))), 4);
  _tags := public.clean_tag_ids(p -> 'tag_ids', 10);
  if coalesce(array_length(_tags, 1), 0) = 0 and coalesce(array_length(_images, 1), 0) = 0 and public.nz(p ->> 'description') is null then
    raise exception 'Add a reference photo, a few tags or a description so sellers understand what you want.';
  end if;

  insert into public.custom_requests (id, user_id, title, description, min_price, max_price, colors, images, quantity,
    needed_by, city, state, country, lat, lng, radius_km, expires_at)
  values (_id, _uid, trim(p ->> 'title'), public.nz(p ->> 'description'), _min, _max,
    array(select distinct left(trim(c), 30) from jsonb_array_elements_text(coalesce(p -> 'colors', '[]')) c where trim(c) <> '' limit 6),
    _images, coalesce(nullif(p ->> 'quantity', '')::integer, 1), nullif(p ->> 'needed_by', '')::date,
    trim(p ->> 'city'), public.nz(p ->> 'state'), coalesce(public.nz(p ->> 'country'), 'India'),
    (p ->> 'lat')::double precision, (p ->> 'lng')::double precision, _radius,
    now() + make_interval(days => public.setting_int('request_expiry_days', 30)))
  returning * into _r;
  insert into public.request_tags (request_id, tag_id) select _id, unnest(_tags);

  -- Notify unlimited-plan sellers who can see it right away (highest plan first, then nearest).
  for _owner in
    select distinct on (x.owner_id) x.owner_id from (
      select s.owner_id, (public.shop_plan(s.id)).priority as prio, public.distance_km(_r.lat, _r.lng, s.lat, s.lng) as d
      from public.shops s
      where public.request_visible_to_shop(_r, s) and (public.shop_plan(s.id)).lead_quota is null
      order by prio desc, d
      limit public.setting_int('max_notified_sellers', 40)) x
  loop
    perform public.notify(_owner, 'request_new', 'New custom saree request near you',
      _r.title || coalesce(' · ' || _r.city, ''), '/seller?tab=requests');
  end loop;

  return jsonb_build_object('id', _id, 'status', public.buyer_status(_uid));
end $$;

create or replace function public.my_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare _uid uuid := public.require_user();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'title', r.title, 'status', case when r.status = 'open' and r.expires_at <= now() then 'expired' else r.status end,
      'city', r.city, 'min_price', r.min_price, 'max_price', r.max_price, 'image', r.images[1], 'created_at', r.created_at,
      'expires_at', r.expires_at, 'needed_by', r.needed_by, 'responses', r.response_count,
      'unseen', (select count(*) from public.request_responses x where x.request_id = r.id and not x.hidden and not x.seen_by_buyer),
      'tags', public.request_tag_list(r.id)) order by r.created_at desc)
    from public.custom_requests r where r.user_id = _uid), '[]'::jsonb);
end $$;

create or replace function public.get_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _r public.custom_requests;
  _admin boolean := public.is_admin();
begin
  perform public.require_user();
  select * into _r from public.custom_requests where id = p_id;
  if not found or (_r.user_id <> auth.uid() and not _admin) then raise exception 'Request not found.'; end if;
  if _r.user_id = auth.uid() then
    update public.request_responses set seen_by_buyer = true where request_id = p_id and not seen_by_buyer;
  end if;
  return jsonb_build_object(
    'request', to_jsonb(_r) - 'user_id' || jsonb_build_object('tags', public.request_tag_list(_r.id),
       'status', case when _r.status = 'open' and _r.expires_at <= now() then 'expired' else _r.status end),
    'responses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'message', x.message, 'price_inr', x.price_inr, 'ready_in_days', x.ready_in_days,
        'images', to_jsonb(x.images), 'status', x.status, 'hidden', x.hidden, 'created_at', x.created_at, 'updated_at', x.updated_at,
        'shop', public.shop_card(s, _r.lat, _r.lng) || jsonb_build_object('country_code', s.country_code))
        order by (x.status = 'shortlisted') desc, x.created_at)
      from public.request_responses x join public.shops s on s.id = x.shop_id
      where x.request_id = p_id and (not x.hidden or _admin)), '[]'::jsonb)
  );
end $$;

create or replace function public.set_response_status(p_response uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  _x public.request_responses;
  _r public.custom_requests;
  _owner uuid;
begin
  perform public.require_user();
  if p_status not in ('sent', 'shortlisted', 'declined') then raise exception 'Unknown status.'; end if;
  select * into _x from public.request_responses where id = p_response;
  select * into _r from public.custom_requests where id = _x.request_id;
  if _r.id is null or _r.user_id <> auth.uid() then raise exception 'Reply not found.'; end if;
  update public.request_responses set status = p_status where id = p_response;
  if p_status = 'shortlisted' and _x.status <> 'shortlisted' then
    select owner_id into _owner from public.shops where id = _x.shop_id;
    perform public.notify(_owner, 'response_shortlisted', 'A buyer shortlisted your reply',
      _r.title || ' — expect a call or WhatsApp soon.', '/seller?tab=requests');
  end if;
end $$;

create or replace function public.close_request(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_user();
  update public.custom_requests set status = 'closed', closed_reason = left(public.nz(p_reason), 300)
  where id = p_id and user_id = auth.uid() and status = 'open';
  if not found then raise exception 'Request not found or already closed.'; end if;
end $$;

-- ─────────────────────────────── Sellers ───────────────────────────────
create or replace function public.seller_requests(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _s public.shops := public.owned_shop(p_shop);
  _max integer := public.setting_int('max_responses_per_request', 10);
begin
  return jsonb_build_object(
    'status', public.shop_lead_status(p_shop) || jsonb_build_object('shop_approved', _s.status = 'approved',
       'max_responses', _max),
    'items', coalesce((select jsonb_agg(item order by sort_key desc) from (
      select r.created_at as sort_key,
        jsonb_build_object(
          'id', r.id, 'title', r.title, 'min_price', r.min_price, 'max_price', r.max_price, 'city', r.city,
          'state', r.state, 'needed_by', r.needed_by, 'quantity', r.quantity, 'created_at', r.created_at,
          'expires_at', r.expires_at, 'image', r.images[1], 'image_count', coalesce(array_length(r.images, 1), 0),
          'distance_km', round(public.distance_km(r.lat, r.lng, _s.lat, _s.lng)::numeric, 1),
          'responses', r.response_count, 'full', r.response_count >= _max,
          'tags', public.request_tag_list(r.id),
          'unlocked', u.request_id is not null,
          'my_response', (select to_jsonb(x) - 'seen_by_buyer' from public.request_responses x where x.request_id = r.id and x.shop_id = p_shop)
        ) || case when u.request_id is null then '{}'::jsonb else jsonb_build_object(
          'description', r.description, 'images', to_jsonb(r.images), 'colors', to_jsonb(r.colors),
          'radius_km', r.radius_km,
          'buyer', (select public.reviewer_name(pr.full_name, pr.email) from public.profiles pr where pr.id = r.user_id)) end as item
      from public.custom_requests r
      left join public.request_unlocks u on u.request_id = r.id and u.shop_id = p_shop
      where public.request_visible_to_shop(r, _s) or (u.request_id is not null and r.status <> 'hidden')
      order by r.created_at desc limit 100) q), '[]'::jsonb)
  );
end $$;

create or replace function public.unlock_request(p_shop uuid, p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  _s public.shops := public.owned_shop(p_shop);
  _r public.custom_requests;
  _st jsonb := public.shop_lead_status(p_shop);
begin
  if exists (select 1 from public.request_unlocks where request_id = p_request and shop_id = p_shop) then return; end if;
  select * into _r from public.custom_requests where id = p_request;
  if not found or not public.request_visible_to_shop(_r, _s) then raise exception 'This request is no longer available.'; end if;
  if (_st ->> 'quota') is not null and (_st ->> 'used')::integer >= (_st ->> 'quota')::integer then
    raise exception 'You have opened % custom requests in the last 30 days — the limit on the % plan. Upgrade for unlimited requests.',
      _st ->> 'quota', _st ->> 'plan_name' using errcode = 'P0002';
  end if;
  insert into public.request_unlocks (request_id, shop_id) values (p_request, p_shop);
end $$;

create or replace function public.respond_request(p_shop uuid, p_request uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _s public.shops := public.owned_shop(p_shop);
  _r public.custom_requests;
  _existing public.request_responses;
  _images text[];
  _id uuid;
begin
  if not exists (select 1 from public.request_unlocks where request_id = p_request and shop_id = p_shop) then
    raise exception 'Open the request before replying.';
  end if;
  select * into _r from public.custom_requests where id = p_request;
  if _r.status <> 'open' or _r.expires_at <= now() then raise exception 'This request is closed.'; end if;
  if length(coalesce(public.nz(p ->> 'message'), '')) < 2 then raise exception 'Write a short message to the buyer.'; end if;
  _images := public.check_media_paths(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'))), 4);
  select * into _existing from public.request_responses where request_id = p_request and shop_id = p_shop;
  if _existing.id is null then
    if _r.response_count >= public.setting_int('max_responses_per_request', 10) then
      raise exception 'This buyer already has enough replies. Watch for the next request!';
    end if;
    insert into public.request_responses (request_id, shop_id, message, price_inr, ready_in_days, images)
    values (p_request, p_shop, trim(p ->> 'message'), nullif(p ->> 'price_inr', '')::integer,
            nullif(p ->> 'ready_in_days', '')::integer, _images)
    returning id into _id;
    perform public.notify(_r.user_id, 'response_new', _s.name || ' replied to your request',
      left(trim(p ->> 'message'), 120), '/account/requests?id=' || _r.id);
  else
    update public.request_responses set message = trim(p ->> 'message'), price_inr = nullif(p ->> 'price_inr', '')::integer,
      ready_in_days = nullif(p ->> 'ready_in_days', '')::integer, images = _images, seen_by_buyer = false
    where id = _existing.id returning id into _id;
  end if;
  return jsonb_build_object('id', _id);
end $$;

-- ─────────────────────────────── Notifications ───────────────────────────────
create or replace function public.my_notifications(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare _uid uuid := public.require_user();
begin
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = _uid and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                 'link', n.link, 'read', n.read_at is not null, 'created_at', n.created_at) order by n.created_at desc)
               from (select * from public.notifications where user_id = _uid order by created_at desc
                     limit least(greatest(p_limit, 1), 100)) n), '[]'::jsonb));
end $$;

create or replace function public.mark_notifications_read() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set read_at = now() where user_id = public.require_user() and read_at is null;
end $$;

-- Server-only: notifications waiting to be emailed (used by /api/notify when an email provider is set).
create or replace function public.notifications_to_email(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare _out jsonb;
begin
  with picked as (
    select n.id from public.notifications n
    where n.emailed_at is null and n.read_at is null and n.created_at > now() - interval '2 days'
    order by n.created_at limit p_limit for update skip locked
  ), upd as (
    update public.notifications n set emailed_at = now() from picked where n.id = picked.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('email', pr.email, 'name', pr.full_name, 'title', u.title,
                                               'body', u.body, 'link', u.link)), '[]'::jsonb)
  into _out from upd u join public.profiles pr on pr.id = u.user_id where pr.email is not null;
  return _out;
end $$;

-- ─────────────────────────────── Admin ───────────────────────────────
create or replace function public.admin_requests(p_status text default null, p_q text default null,
                                                  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    with rows as (
      select r.*, pr.email, case when r.status = 'open' and r.expires_at <= now() then 'expired' else r.status end as eff
      from public.custom_requests r left join public.profiles pr on pr.id = r.user_id
      where (public.nz(p_q) is null or r.title ilike '%' || p_q || '%' or r.city ilike '%' || p_q || '%' or pr.email ilike '%' || p_q || '%')
    ), f as (select * from rows where p_status is null or eff = p_status)
    select jsonb_build_object('total', (select count(*) from f),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.eff, 'city', x.city,
          'email', x.email, 'min_price', x.min_price, 'max_price', x.max_price, 'image', x.images[1],
          'responses', x.response_count, 'created_at', x.created_at, 'radius_km', x.radius_km,
          'unlocks', (select count(*) from public.request_unlocks u where u.request_id = x.id)) order by x.created_at desc)
        from (select * from f order by created_at desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]'::jsonb))
  );
end $$;

create or replace function public.admin_set_request_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare _r public.custom_requests;
begin
  perform public.require_admin();
  if p_status not in ('open', 'closed', 'hidden') then raise exception 'Unknown status.'; end if;
  update public.custom_requests set status = p_status, closed_reason = coalesce(public.nz(p_note), closed_reason),
    expires_at = case when p_status = 'open' and expires_at <= now()
                      then now() + make_interval(days => public.setting_int('request_expiry_days', 30)) else expires_at end
  where id = p_id returning * into _r;
  if not found then raise exception 'Request not found.'; end if;
  if p_status = 'hidden' then
    perform public.notify(_r.user_id, 'request_hidden', 'Your custom request was removed',
      coalesce(public.nz(p_note), 'It did not meet our guidelines.'), '/account/requests?id=' || _r.id);
  end if;
end $$;

create or replace function public.admin_set_response_hidden(p_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.request_responses set hidden = p_hidden where id = p_id;
  if not found then raise exception 'Reply not found.'; end if;
end $$;

create or replace function public.admin_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (select jsonb_object_agg(key, value) from public.app_settings);
end $$;

create or replace function public.admin_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare _k text; _v integer;
begin
  perform public.require_admin();
  for _k in select jsonb_object_keys(p) loop
    if _k not in ('max_responses_per_request', 'request_expiry_days', 'head_start_hours', 'max_notified_sellers', 'default_radius_km') then
      raise exception 'Unknown setting %', _k;
    end if;
    _v := (p ->> _k)::integer;
    if _v < 0 or _v > 1000 then raise exception 'Value for % must be between 0 and 1000.', _k; end if;
    if _k in ('max_responses_per_request', 'request_expiry_days', 'max_notified_sellers', 'default_radius_km') and _v < 1 then
      raise exception 'Value for % must be at least 1.', _k;
    end if;
    insert into public.app_settings (key, value, updated_at) values (_k, to_jsonb(_v), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end loop;
end $$;

create or replace function public.admin_save_plan(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if (p ->> 'code') in ('free', 'buyer_free') and coalesce((p ->> 'price_inr')::integer, 0) <> 0 then
    raise exception 'Free plans must stay at ₹0.';
  end if;
  if coalesce(p ->> 'audience', 'seller') not in ('seller', 'buyer') then raise exception 'Unknown plan type.'; end if;
  insert into public.plans as pl (code, name, description, price_inr, duration_days, max_products, max_photos,
                                  featured, priority, features, active, sort_order, audience, lead_quota, request_quota, updated_at)
  values (p ->> 'code', p ->> 'name', public.nz(p ->> 'description'), (p ->> 'price_inr')::integer,
          (p ->> 'duration_days')::integer, coalesce((p ->> 'max_products')::integer, 0), greatest(coalesce((p ->> 'max_photos')::integer, 1), 1),
          coalesce((p ->> 'featured')::boolean, false), coalesce((p ->> 'priority')::integer, 0),
          array(select jsonb_array_elements_text(coalesce(p -> 'features', '[]'))),
          coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::integer, 0),
          coalesce(p ->> 'audience', 'seller'), nullif(p ->> 'lead_quota', '')::integer, nullif(p ->> 'request_quota', '')::integer, now())
  on conflict (code) do update set
    name = excluded.name, description = excluded.description, price_inr = excluded.price_inr,
    duration_days = excluded.duration_days, max_products = excluded.max_products,
    max_photos = excluded.max_photos, featured = excluded.featured, priority = excluded.priority,
    features = excluded.features, active = case when pl.code in ('free', 'buyer_free') then true else excluded.active end,
    sort_order = excluded.sort_order, lead_quota = excluded.lead_quota, request_quota = excluded.request_quota,
    updated_at = now();
end $$;

-- ─────────────────────────────── Updated existing functions ───────────────────────────────
drop function if exists public.list_plans();
create or replace function public.list_plans(p_audience text default 'seller') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(p) - 'updated_at' order by p.sort_order, p.price_inr), '[]'::jsonb)
  from public.plans p where p.active and p.audience = coalesce(p_audience, 'seller')
$$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'pending', (select count(*) from public.shops where status = 'pending'),
    'changes', (select count(*) from public.shops where pending_changes is not null),
    'approved', (select count(*) from public.shops where status = 'approved'),
    'rejected', (select count(*) from public.shops where status = 'rejected'),
    'suspended', (select count(*) from public.shops where status = 'suspended'),
    'products', (select count(*) from public.products),
    'reviews', (select count(*) from public.reviews),
    'hidden_reviews', (select count(*) from public.reviews where hidden),
    'users', (select count(*) from public.profiles),
    'paid_shops', (select count(distinct shop_id) from public.subscriptions where ends_at > now() and plan_code <> 'free'),
    'paid_buyers', (select count(distinct user_id) from public.user_subscriptions where ends_at > now()),
    'open_requests', (select count(*) from public.custom_requests where status = 'open' and expires_at > now()),
    'requests_30d', (select count(*) from public.custom_requests where created_at > now() - interval '30 days'),
    'responses_30d', (select count(*) from public.request_responses where created_at > now() - interval '30 days'),
    'revenue_30d_paise', (select coalesce(sum(amount_paise), 0) from public.payments
                          where status = 'paid' and paid_at > now() - interval '30 days'),
    'revenue_total_paise', (select coalesce(sum(amount_paise), 0) from public.payments where status = 'paid'),
    'leads_30d', (select coalesce(sum(calls + whatsapp + directions), 0) from public.shop_daily_stats
                  where day > current_date - 30)
  );
end $$;

create or replace function public.admin_payments(p_status text default null, p_limit integer default 50,
                                                  p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    with rows as (
      select pay.*, coalesce(s.name, 'Buyer plan') as shop_name, s.slug as shop_slug, pr.email
      from public.payments pay left join public.shops s on s.id = pay.shop_id
      left join public.profiles pr on pr.id = pay.user_id
      where (p_status is null or pay.status = p_status)
    )
    select jsonb_build_object('total', (select count(*) from rows),
      'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select * from rows order by created_at desc
              limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]'::jsonb))
  );
end $$;

create or replace function public.payment_prepare(p_user uuid, p_shop uuid, p_plan text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _s public.shops;
  _pl public.plans;
begin
  select * into _pl from public.plans where code = p_plan and active;
  if not found or _pl.price_inr <= 0 then raise exception 'This plan cannot be bought online.'; end if;
  if _pl.audience = 'buyer' then
    return jsonb_build_object('amount_paise', _pl.price_inr * 100, 'plan_name', _pl.name,
                              'duration_days', _pl.duration_days, 'shop_name', null, 'audience', 'buyer');
  end if;
  select * into _s from public.shops where id = p_shop;
  if not found or _s.owner_id <> p_user then raise exception 'Shop not found.'; end if;
  if _s.status <> 'approved' then raise exception 'Your shop must be approved before you can buy a plan.'; end if;
  return jsonb_build_object('amount_paise', _pl.price_inr * 100, 'plan_name', _pl.name,
                            'duration_days', _pl.duration_days, 'shop_name', _s.name, 'audience', 'seller');
end $$;

create or replace function public.payment_mark_paid(p_order_id text, p_payment_id text,
                                                     p_amount_paise integer, p_method text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _pay public.payments;
  _pl public.plans;
  _ends timestamptz;
  _start timestamptz;
begin
  select * into _pay from public.payments where razorpay_order_id = p_order_id for update;
  if not found then raise exception 'Unknown order %', p_order_id; end if;
  select * into _pl from public.plans where code = _pay.plan_code;
  if _pay.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'already', true, 'ends_at',
      case when _pl.audience = 'buyer'
           then (select max(ends_at) from public.user_subscriptions where user_id = _pay.user_id and plan_code = _pay.plan_code)
           else public.shop_plan_ends(_pay.shop_id) end);
  end if;
  if p_amount_paise is distinct from _pay.amount_paise then
    raise exception 'Amount mismatch for order %', p_order_id;
  end if;
  update public.payments set status = 'paid', razorpay_payment_id = p_payment_id, method = p_method,
    paid_at = now(), error_reason = null
  where id = _pay.id;
  if _pl.audience = 'buyer' then
    select max(ends_at) into _start from public.user_subscriptions
    where user_id = _pay.user_id and plan_code = _pay.plan_code and ends_at > now();
    _start := greatest(coalesce(_start, now()), now());
    _ends := _start + make_interval(days => _pl.duration_days);
    insert into public.user_subscriptions (user_id, plan_code, starts_at, ends_at, payment_id)
    values (_pay.user_id, _pay.plan_code, _start, _ends, _pay.id);
  else
    _ends := public.grant_subscription(_pay.shop_id, _pay.plan_code, _pl.duration_days, _pay.id);
  end if;
  return jsonb_build_object('status', 'paid', 'already', false, 'ends_at', _ends);
end $$;

create or replace function public.my_buyer_payments() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'plan_code', p.plan_code, 'amount_paise', p.amount_paise,
           'status', p.status, 'razorpay_payment_id', p.razorpay_payment_id, 'paid_at', p.paid_at, 'created_at', p.created_at)
           order by p.created_at desc), '[]'::jsonb)
  from public.payments p join public.plans pl on pl.code = p.plan_code
  where p.user_id = public.require_user() and pl.audience = 'buyer' and p.status <> 'created'
$$;

-- me(): add unread notifications
create or replace function public.me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _claims jsonb := auth.jwt();
  _meta jsonb := coalesce(_claims -> 'user_metadata', '{}'::jsonb);
begin
  insert into public.profiles as p (id, email, full_name, avatar_url)
  values (_uid, lower(_claims ->> 'email'),
          coalesce(_meta ->> 'full_name', _meta ->> 'name'), coalesce(_meta ->> 'avatar_url', _meta ->> 'picture'))
  on conflict (id) do update set
    email = coalesce(excluded.email, p.email),
    full_name = coalesce(p.full_name, excluded.full_name),
    avatar_url = coalesce(excluded.avatar_url, p.avatar_url);
  if exists (select 1 from public.admin_emails a where a.email = lower(_claims ->> 'email')) then
    insert into public.user_roles (user_id, role) values (_uid, 'admin') on conflict do nothing;
  end if;
  return jsonb_build_object(
    'id', _uid,
    'email', (select email from public.profiles where id = _uid),
    'full_name', (select full_name from public.profiles where id = _uid),
    'avatar_url', (select avatar_url from public.profiles where id = _uid),
    'phone', (select phone from public.profiles where id = _uid),
    'is_admin', public.is_admin(),
    'unread', (select count(*) from public.notifications where user_id = _uid and read_at is null),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name,
                                                           'status', s.status) order by s.created_at)
                       from public.shops s where s.owner_id = _uid), '[]'::jsonb)
  );
end $$;

-- ─────────────────────────────── Grants ───────────────────────────────
-- New functions default to EXECUTE for PUBLIC; lock them down, then grant explicitly.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
             'setting_int','refresh_response_count','notify','buyer_plan','buyer_status','shop_lead_status',
             'request_visible_to_shop','request_tag_list','my_buyer_status','create_request','my_requests','get_request',
             'set_response_status','close_request','seller_requests','unlock_request','respond_request','my_notifications',
             'mark_notifications_read','notifications_to_email','admin_requests','admin_set_request_status',
             'admin_set_response_hidden','admin_settings','admin_save_settings','list_plans','my_buyer_payments'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.list_plans(text) to anon, authenticated, service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'my_buyer_status()', 'create_request(jsonb)', 'my_requests()', 'get_request(uuid)', 'set_response_status(uuid,text)',
    'close_request(uuid,text)', 'seller_requests(uuid)', 'unlock_request(uuid,uuid)', 'respond_request(uuid,uuid,jsonb)',
    'my_notifications(integer)', 'mark_notifications_read()', 'my_buyer_payments()',
    'admin_requests(text,text,integer,integer)', 'admin_set_request_status(uuid,text,text)',
    'admin_set_response_hidden(uuid,boolean)', 'admin_settings()', 'admin_save_settings(jsonb)'
  ] loop
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  grant execute on function public.notifications_to_email(integer) to service_role;
end $$;
