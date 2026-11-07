-- Sarees Hub — real-world fixes:
--  * Admin can list shops on a seller's behalf (to fill the map at launch); the real owner claims them.
--  * Buyers can report a wrong/closed/fake listing; owners can ask to claim a listing. Admin queue for both.
--  * In-site alerts: admins hear about new applications and reports; sellers hear about approval,
--    rejection, suspension, new reviews and claims.
--  * Custom requests: show the buyer how many sellers will receive it before sending, refuse if none,
--    and don't charge an allowance for requests nobody answered.
--  * Nearest shops when the visible map area is empty.

-- ─────────────────────────────── Columns ───────────────────────────────
alter table public.shops add column if not exists unclaimed boolean not null default false;
alter table public.shops add column if not exists claim_email text;
create index if not exists shops_claim_email_idx on public.shops (claim_email) where claim_email is not null;
alter table public.custom_requests add column if not exists closed_at timestamptz;

create table if not exists public.shop_reports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('closed', 'wrong_location', 'wrong_phone', 'fake', 'prices', 'behaviour', 'other', 'claim')),
  details text check (length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  admin_note text check (length(admin_note) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists shop_reports_one_open on public.shop_reports (shop_id, user_id, reason) where status = 'open';
create index if not exists shop_reports_status_idx on public.shop_reports (status, created_at desc);
alter table public.shop_reports enable row level security;
revoke all on table public.shop_reports from anon, authenticated;
grant all on table public.shop_reports to service_role;

-- ─────────────────────────────── Alerts ───────────────────────────────
create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select r.user_id, p_kind, p_title, p_body, p_link from public.user_roles r where r.role = 'admin'
$$;

create or replace function public.on_shop_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' and not public.is_admin() then
      perform public.notify_admins('shop_pending', 'New shop waiting for approval', new.name || ' · ' || new.city, '/admin?tab=pending');
    end if;
    return null;
  end if;
  if new.status is distinct from old.status and not new.unclaimed then
    if new.status = 'approved' and old.status in ('pending', 'rejected') then
      perform public.notify(new.owner_id, 'shop_approved', 'Your shop is live on Sarees Hub 🎉',
        new.name || ' is now on the map. Add your best sarees and share your shop link.', '/seller?shop=' || new.id);
    elsif new.status = 'rejected' then
      perform public.notify(new.owner_id, 'shop_rejected', 'Your shop needs a few changes',
        coalesce(new.review_note, 'Please check your details and resubmit.'), '/seller?shop=' || new.id || '&tab=details');
    elsif new.status = 'suspended' then
      perform public.notify(new.owner_id, 'shop_suspended', 'Your listing is hidden',
        coalesce(new.review_note, 'Please contact us.'), '/seller?shop=' || new.id);
    elsif new.status = 'pending' and old.status = 'rejected' then
      perform public.notify_admins('shop_pending', 'Shop resubmitted for approval', new.name || ' · ' || new.city, '/admin?tab=pending');
    end if;
  end if;
  if new.pending_changes is not null and old.pending_changes is null then
    perform public.notify_admins('shop_changes', 'Shop change request', new.name, '/admin?tab=changes');
  end if;
  return null;
end $$;
drop trigger if exists shops_notify on public.shops;
create trigger shops_notify after insert or update of status, pending_changes on public.shops
  for each row execute function public.on_shop_change();

create or replace function public.on_review_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare _s public.shops;
begin
  select * into _s from public.shops where id = new.shop_id;
  if not _s.unclaimed then
    perform public.notify(_s.owner_id, 'review_new', 'New ' || new.rating || '★ review for ' || _s.name,
      left(coalesce(new.comment, ''), 120), '/seller?shop=' || _s.id || '&tab=reviews');
  end if;
  return null;
end $$;
drop trigger if exists reviews_notify on public.reviews;
create trigger reviews_notify after insert on public.reviews for each row execute function public.on_review_insert();

-- ─────────────────────────────── Admin-listed shops & claims ───────────────────────────────
-- Admin lists a shop it has verified by phone/visit. It goes live at once, marked "Listed by Sarees Hub".
-- If the owner's Google email is known it is handed over the next time they sign in.
create or replace function public.admin_create_shop(p jsonb, p_claim_email text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare _r jsonb;
begin
  perform public.require_admin();
  _r := public.create_shop(p);
  update public.shops set status = 'approved', approved_at = now(), unclaimed = true,
    claim_email = lower(public.nz(p_claim_email))
  where id = (_r ->> 'id')::uuid;
  perform public.admin_claim_now((_r ->> 'id')::uuid);
  return _r || jsonb_build_object('status', 'approved');
end $$;

-- Hand over an unclaimed shop whose claim_email matches an existing account.
create or replace function public.admin_claim_now(p_shop uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare _uid uuid; _s public.shops;
begin
  select * into _s from public.shops where id = p_shop;
  if _s.claim_email is null then return false; end if;
  select id into _uid from public.profiles where email = _s.claim_email;
  if _uid is null then select id into _uid from auth.users where lower(email) = _s.claim_email; end if;
  if _uid is null then return false; end if;
  update public.shops set owner_id = _uid, unclaimed = false, claim_email = null where id = p_shop;
  perform public.notify(_uid, 'shop_claimed', _s.name || ' is now yours to manage',
    'Update photos, timings and sarees from your seller dashboard.', '/seller?shop=' || p_shop);
  return true;
end $$;

create or replace function public.admin_transfer_shop(p_shop uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare _done boolean;
begin
  perform public.require_admin();
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the owner''s Google email.'; end if;
  update public.shops set claim_email = lower(trim(p_email)), unclaimed = true where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
  _done := public.admin_claim_now(p_shop);
  update public.shop_reports set status = 'resolved', resolved_at = now(),
    admin_note = coalesce(admin_note, 'Transferred to ' || lower(trim(p_email)))
  where shop_id = p_shop and reason = 'claim' and status = 'open'
    and user_id in (select id from public.profiles where email = lower(trim(p_email)));
  return jsonb_build_object('transferred', _done, 'waiting_for_sign_in', not _done);
end $$;

-- ─────────────────────────────── Reports ───────────────────────────────
create or replace function public.report_shop(p_shop uuid, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare _uid uuid := public.require_user(); _s public.shops;
begin
  perform public.me();
  select * into _s from public.shops where id = p_shop and status = 'approved';
  if not found then raise exception 'Shop not found.'; end if;
  if p_reason not in ('closed', 'wrong_location', 'wrong_phone', 'fake', 'prices', 'behaviour', 'other', 'claim') then
    raise exception 'Choose what is wrong.';
  end if;
  if p_reason = 'claim' and _s.owner_id = _uid and not _s.unclaimed then raise exception 'This shop is already yours.'; end if;
  if p_reason in ('other', 'behaviour', 'fake') and length(coalesce(public.nz(p_details), '')) < 5 then
    raise exception 'Please add a few words so our team can check.';
  end if;
  if (select count(*) from public.shop_reports where user_id = _uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have sent many reports today. Please try again tomorrow.';
  end if;
  insert into public.shop_reports (shop_id, user_id, reason, details) values (p_shop, _uid, p_reason, left(public.nz(p_details), 1000))
  on conflict (shop_id, user_id, reason) where status = 'open' do update set details = excluded.details, created_at = now();
  perform public.notify_admins(case when p_reason = 'claim' then 'shop_claim' else 'shop_report' end,
    case when p_reason = 'claim' then 'Someone wants to claim ' || _s.name else 'Report: ' || _s.name end,
    replace(p_reason, '_', ' ') || coalesce(' — ' || left(public.nz(p_details), 100), ''), '/admin?tab=reports');
end $$;

create or replace function public.admin_reports(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status, 'admin_note', r.admin_note,
      'created_at', r.created_at, 'reporter', pr.email, 'reporter_name', pr.full_name,
      'shop', jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'city', s.city, 'phone', s.phone,
                                 'status', s.status, 'unclaimed', s.unclaimed, 'owner_email', ow.email),
      'same_shop_open', (select count(*) from public.shop_reports x where x.shop_id = r.shop_id and x.status = 'open'))
      order by r.created_at desc)
    from public.shop_reports r join public.shops s on s.id = r.shop_id
    left join public.profiles pr on pr.id = r.user_id left join public.profiles ow on ow.id = s.owner_id
    where p_status is null or r.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_resolve_report(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_status not in ('open', 'resolved', 'dismissed') then raise exception 'Unknown status.'; end if;
  update public.shop_reports set status = p_status, admin_note = public.nz(p_note),
    resolved_at = case when p_status = 'open' then null else now() end where id = p_id;
  if not found then raise exception 'Report not found.'; end if;
end $$;

-- me(): hand over shops listed for this email on sign-in.
create or replace function public.claim_my_shops() returns integer
language plpgsql security definer set search_path = '' as $$
declare _email text := lower(auth.jwt() ->> 'email'); _id uuid; _n integer := 0;
begin
  if auth.uid() is null or _email is null then return 0; end if;
  for _id in select id from public.shops where claim_email = _email loop
    if public.admin_claim_now(_id) then _n := _n + 1; end if;
  end loop;
  return _n;
end $$;

-- Wrap me() so claims happen on every sign-in without repeating its body.
alter function public.me() rename to me_base;
create or replace function public.me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare _r jsonb;
begin
  _r := public.me_base();   -- creates the profile first
  if public.claim_my_shops() > 0 then _r := public.me_base(); end if;
  return _r;
end $$;

-- get_shop(): add "listed by Sarees Hub" flag.
alter function public.get_shop(text) rename to get_shop_base;
create or replace function public.get_shop(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare _r jsonb := public.get_shop_base(p_slug);
begin
  if _r is null then return null; end if;
  return jsonb_set(_r, '{shop,unclaimed}', to_jsonb(coalesce((select unclaimed from public.shops where slug = p_slug), false)));
end $$;

-- ─────────────────────────────── Nearest shops ───────────────────────────────
create or replace function public.nearest_shops(p_lat double precision, p_lng double precision,
                                                p_kind text default null, p_tag text default null, p_limit integer default 6)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.card order by x.d), '[]'::jsonb) from (
    select public.shop_card(s, p_lat, p_lng) as card, public.distance_km(p_lat, p_lng, s.lat, s.lng) as d
    from public.shops s
    where s.status = 'approved'
      and (p_kind is null or s.kind::text = p_kind)
      and (p_tag is null or exists (select 1 from public.shop_tags st join public.tags t on t.id = st.tag_id
                                    where st.shop_id = s.id and t.slug = p_tag))
    order by d limit least(greatest(p_limit, 1), 20)) x
$$;

-- ─────────────────────────────── Custom requests: reach & fair allowance ───────────────────────────────
-- How many sellers would receive a request here (approved, in range, plan allows requests).
create or replace function public.request_reach(p_lat double precision, p_lng double precision, p_radius_km integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (
    select s.id, public.distance_km(p_lat, p_lng, s.lat, s.lng) as d, (public.shop_plan(s.id)).lead_quota as q
    from public.shops s where s.status = 'approved' and s.owner_id is distinct from auth.uid() and not s.unclaimed
  )
  select jsonb_build_object(
    'sellers', (select count(*) from c where coalesce(q, -1) <> 0 and (p_radius_km is null or d <= p_radius_km)),
    'instant', (select count(*) from c where q is null and (p_radius_km is null or d <= p_radius_km)),
    'nearest_km', (select round(min(d)::numeric, 1) from c where coalesce(q, -1) <> 0))
$$;

-- Shops listed by admin (not yet claimed) don't receive requests: nobody there would answer.
create or replace function public.request_visible_to_shop(r public.custom_requests, s public.shops) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.status = 'open' and r.expires_at > now() and s.status = 'approved' and not s.unclaimed and r.user_id <> s.owner_id
    and (r.radius_km is null or public.distance_km(r.lat, r.lng, s.lat, s.lng) <= r.radius_km)
    and coalesce((public.shop_plan(s.id)).lead_quota, -1) <> 0
    and ((public.shop_plan(s.id)).lead_quota is null
         or r.created_at <= now() - make_interval(hours => public.setting_int('head_start_hours', 2))
         or exists (select 1 from public.request_unlocks u where u.request_id = r.id and u.shop_id = s.id))
$$;

-- Requests count against the allowance unless nobody replied and the buyer gave sellers a fair chance
-- (expired, or closed after 3+ days). Removed (spam) requests always count.
create or replace function public.request_counts(r public.custom_requests) returns boolean
language sql stable set search_path = '' as $$
  select not (r.response_count = 0 and r.status <> 'hidden'
              and ((r.status = 'open' and r.expires_at <= now())
                   or (r.status = 'closed' and r.closed_at >= r.created_at + interval '3 days')))
$$;

create or replace function public.buyer_status(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _pl public.plans := public.buyer_plan(p_user);
  _since timestamptz;
  _ends timestamptz;
  _used integer;
  _refunded integer;
begin
  if _pl.code = 'buyer_free' or _pl.code is null then
    _since := now() - make_interval(days => coalesce(_pl.duration_days, 30));
  else
    select min(starts_at), max(ends_at) into _since, _ends from public.user_subscriptions
    where user_id = p_user and plan_code = _pl.code and ends_at > now();
  end if;
  select count(*) filter (where public.request_counts(r)), count(*) filter (where not public.request_counts(r))
  into _used, _refunded from public.custom_requests r where r.user_id = p_user and r.created_at >= _since;
  return jsonb_build_object('plan_code', _pl.code, 'plan_name', _pl.name, 'quota', _pl.request_quota,
    'used', _used, 'refunded', _refunded,
    'remaining', case when _pl.request_quota is null then null else greatest(_pl.request_quota - _used, 0) end,
    'ends_at', _ends);
end $$;

create or replace function public.close_request(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_user();
  update public.custom_requests set status = 'closed', closed_reason = left(public.nz(p_reason), 300), closed_at = now()
  where id = p_id and user_id = auth.uid() and status = 'open';
  if not found then raise exception 'Request not found or already closed.'; end if;
end $$;

-- Refuse requests that no seller would receive (the buyer would wait for nothing).
alter function public.create_request(jsonb) rename to create_request_base;
create or replace function public.create_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare _reach jsonb;
begin
  perform public.require_user();
  if p ->> 'lat' is not null and p ->> 'lng' is not null then
    _reach := public.request_reach((p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
                                   nullif(p ->> 'radius_km', '')::integer);
    if (_reach ->> 'sellers')::integer = 0 then
      raise exception 'No sellers take custom requests within this distance yet%. Choose a larger distance or “Anywhere”.',
        coalesce(' (nearest is ' || (_reach ->> 'nearest_km') || ' km away)', '');
    end if;
  end if;
  return public.create_request_base(p);
end $$;

alter function public.admin_overview() rename to admin_overview_base;
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return public.admin_overview_base() || jsonb_build_object(
    'open_reports', (select count(*) from public.shop_reports where status = 'open'),
    'unclaimed', (select count(*) from public.shops where unclaimed and status = 'approved'));
end $$;

-- ─────────────────────────────── Grants ───────────────────────────────
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
             'notify_admins','on_shop_change','on_review_insert','admin_create_shop','admin_claim_now','admin_transfer_shop',
             'report_shop','admin_reports','admin_resolve_report','claim_my_shops','me','me_base','get_shop','get_shop_base',
             'nearest_shops','request_reach','request_counts','buyer_status','close_request','create_request','create_request_base','admin_overview','admin_overview_base'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.get_shop(text), public.nearest_shops(double precision, double precision, text, text, integer)
  to anon, authenticated, service_role;
grant execute on function public.me(), public.report_shop(uuid, text, text), public.request_reach(double precision, double precision, integer),
  public.close_request(uuid, text), public.create_request(jsonb), public.admin_create_shop(jsonb, text),
  public.admin_transfer_shop(uuid, text), public.admin_reports(text), public.admin_overview(), public.admin_resolve_report(uuid, text, text)
  to authenticated, service_role;
