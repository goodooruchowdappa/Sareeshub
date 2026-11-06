-- Sarees Hub — API layer.
-- Every function the browser/server may call lives here. Each one checks who is calling
-- (auth.uid(), is_admin()) itself; tables are not reachable through the REST API.
-- Grants are set explicitly at the bottom of this file.

-- ─────────────────────────────── Auth helpers ───────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
$$;

create or replace function public.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'Please sign in to continue.' using errcode = '42501';
  end if;
  return _uid;
end $$;

create or replace function public.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare _uid uuid := public.require_user();
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this.' using errcode = '42501';
  end if;
  return _uid;
end $$;

create or replace function public.nz(p text) returns text
language sql immutable set search_path = '' as $$ select nullif(trim(p), '') $$;

-- Storage paths uploaded by the current user always start with "<uid>/".
create or replace function public.check_media_paths(p_paths text[], p_max integer) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  _uid text := auth.uid()::text;
  _p text;
  _out text[] := '{}';
begin
  if p_paths is null then return '{}'; end if;
  if coalesce(array_length(p_paths, 1), 0) > p_max then
    raise exception 'You can add up to % photos.', p_max;
  end if;
  foreach _p in array p_paths loop
    if _p is null or _p = '' then continue; end if;
    if not public.is_admin() and (left(_p, length(_uid) + 1) <> _uid || '/' ) then
      raise exception 'Invalid photo reference.';
    end if;
    if _p !~ '^[0-9a-f-]{36}/[A-Za-z0-9/_.-]{1,200}$' or _p like '%..%' then
      raise exception 'Invalid photo reference.';
    end if;
    if not (_p = any(_out)) then _out := _out || _p; end if;
  end loop;
  return _out;
end $$;

-- ─────────────────────────────── Plans ───────────────────────────────
-- Active plan for a shop: highest-priority running subscription, else the free plan.
create or replace function public.shop_plan(p_shop uuid) returns public.plans
language sql stable security definer set search_path = '' as $$
  select pl.* from public.plans pl
  where pl.code = coalesce((
    select s.plan_code from public.subscriptions s
    join public.plans p2 on p2.code = s.plan_code
    where s.shop_id = p_shop and s.starts_at <= now() and s.ends_at > now()
    order by p2.priority desc, s.ends_at desc
    limit 1), 'free')
$$;

create or replace function public.shop_plan_ends(p_shop uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(s.ends_at) from public.subscriptions s
  where s.shop_id = p_shop and s.ends_at > now()
    and s.plan_code = (public.shop_plan(p_shop)).code
$$;

create or replace function public.grant_subscription(p_shop uuid, p_plan text, p_days integer, p_payment uuid)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  _start timestamptz;
  _end timestamptz;
begin
  -- Buying the same plan again extends it; a different plan starts now.
  select max(s.ends_at) into _start from public.subscriptions s
  where s.shop_id = p_shop and s.plan_code = p_plan and s.ends_at > now();
  _start := greatest(coalesce(_start, now()), now());
  _end := _start + make_interval(days => p_days);
  insert into public.subscriptions (shop_id, plan_code, starts_at, ends_at, payment_id)
  values (p_shop, p_plan, _start, _end, p_payment);
  return _end;
end $$;

-- ─────────────────────────────── JSON shapes ───────────────────────────────
create or replace function public.reviewer_name(p_full text, p_email text) returns text
language sql immutable set search_path = '' as $$
  select case
    when public.nz(p_full) is null then coalesce(split_part(p_email, '@', 1), 'Customer')
    when position(' ' in trim(p_full)) = 0 then trim(p_full)
    else split_part(trim(p_full), ' ', 1) || ' ' ||
         left(reverse(split_part(reverse(trim(p_full)), ' ', 1)), 1) || '.'
  end
$$;

create or replace function public.shop_card(s public.shops, p_lat double precision default null,
                                             p_lng double precision default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'name', s.name, 'kind', s.kind, 'tagline', s.tagline,
    'locality', s.locality, 'city', s.city, 'state', s.state, 'country', s.country,
    'lat', s.lat, 'lng', s.lng, 'cover', s.photos[1],
    'rating_avg', s.rating_avg, 'rating_count', s.rating_count,
    'phone', s.phone, 'whatsapp', s.whatsapp, 'hours', s.hours,
    'featured', coalesce(pl.featured, false), 'priority', coalesce(pl.priority, 0),
    'distance_km', case when p_lat is null or p_lng is null then null
                        else round(public.distance_km(p_lat, p_lng, s.lat, s.lng)::numeric, 1) end,
    'tags', coalesce((select jsonb_agg(t.name order by t.is_default desc, t.name)
                      from (select t.name, t.is_default from public.shop_tags st
                            join public.tags t on t.id = st.tag_id
                            where st.shop_id = s.id and not t.hidden
                            order by t.is_default desc, t.name limit 4) t), '[]'::jsonb)
  )
  from (select (public.shop_plan(s.id)).*) pl
$$;

create or replace function public.product_card(p public.products) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'price_inr', p.price_inr, 'mrp_inr', p.mrp_inr,
    'image', p.images[1], 'in_stock', p.in_stock, 'colors', p.colors, 'updated_at', p.updated_at,
    'shop', jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'city', s.city,
                               'state', s.state, 'lat', s.lat, 'lng', s.lng,
                               'rating_avg', s.rating_avg, 'rating_count', s.rating_count),
    'tags', coalesce((select jsonb_agg(x.name) from (
                        select t.name from public.product_tags pt join public.tags t on t.id = pt.tag_id
                        where pt.product_id = p.id and not t.hidden
                        order by t.is_default desc, t.name limit 3) x), '[]'::jsonb)
  )
  from public.shops s where s.id = p.shop_id
$$;

create or replace function public.tag_list(p_tag_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name,
                                               'category', t.category, 'is_default', t.is_default)
                            order by t.category, t.is_default desc, t.name), '[]'::jsonb)
  from public.tags t where t.id = any(p_tag_ids) and not t.hidden
$$;

-- Validates and normalises tag ids sent by the client.
create or replace function public.clean_tag_ids(p jsonb, p_max integer) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare _ids uuid[];
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '{}'; end if;
  select coalesce(array_agg(distinct t.id), '{}') into _ids
  from jsonb_array_elements_text(p) e(v)
  join public.tags t on t.id::text = e.v and not t.hidden;
  if coalesce(array_length(_ids, 1), 0) > p_max then
    raise exception 'Choose up to % tags.', p_max;
  end if;
  return _ids;
end $$;

-- ─────────────────────────────── Public reads ───────────────────────────────
create or replace function public.get_home() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'featured', coalesce((
      select jsonb_agg(x.card order by x.prio desc, x.rc desc, x.ap desc)
      from (
        select public.shop_card(s) as card, (public.shop_plan(s.id)).priority as prio,
               s.rating_count as rc, s.approved_at as ap
        from public.shops s where s.status = 'approved'
        order by prio desc, s.rating_count desc, s.approved_at desc
        limit 8) x), '[]'::jsonb),
    'latest', coalesce((
      select jsonb_agg(x.card order by x.created_at desc)
      from (select public.product_card(p) as card, p.created_at
            from public.products p join public.shops s on s.id = p.shop_id
            where p.active and s.status = 'approved'
            order by p.created_at desc limit 12) x), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'category', x.category, 'count', x.n)
                       order by x.n desc, x.is_default desc, x.name)
      from (
        select t.slug, t.name, t.category, t.is_default,
               (select count(*) from public.product_tags pt join public.products p on p.id = pt.product_id
                  join public.shops s on s.id = p.shop_id
                  where pt.tag_id = t.id and p.active and s.status = 'approved') +
               (select count(*) from public.shop_tags st join public.shops s on s.id = st.shop_id
                  where st.tag_id = t.id and s.status = 'approved') as n
        from public.tags t where not t.hidden
        order by n desc, t.is_default desc, t.name limit 18) x
      where x.n > 0 or x.is_default), '[]'::jsonb),
    'stats', jsonb_build_object(
      'shops', (select count(*) from public.shops where status = 'approved'),
      'weavers', (select count(*) from public.shops where status = 'approved' and kind in ('weaver', 'cooperative')),
      'sarees', (select count(*) from public.products p join public.shops s on s.id = p.shop_id
                 where p.active and s.status = 'approved'),
      'cities', (select count(distinct lower(city)) from public.shops where status = 'approved'))
  )
$$;

-- Map + list search. Pass a bounding box (map viewport) or a centre + radius.
create or replace function public.search_shops(
  p_q text default null,
  p_kind text default null,
  p_tag text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km double precision default null,
  p_min_lat double precision default null,
  p_min_lng double precision default null,
  p_max_lat double precision default null,
  p_max_lng double precision default null,
  p_limit integer default 300
) returns jsonb
language sql stable security definer set search_path = '' as $$
  with q as (select public.to_prefix_query(p_q) as tsq, public.nz(p_q) as raw),
  hits as (
    select s as shop, s.name, s.rating_avg,
           (public.shop_plan(s.id)).priority as prio,
           case when p_lat is null or p_lng is null then null
                else public.distance_km(p_lat, p_lng, s.lat, s.lng) end as dist
    from public.shops s, q
    where s.status = 'approved'
      and (p_kind is null or s.kind::text = p_kind)
      and (p_tag is null or exists (
            select 1 from public.shop_tags st join public.tags t on t.id = st.tag_id
            where st.shop_id = s.id and t.slug = p_tag)
          or exists (
            select 1 from public.products p join public.product_tags pt on pt.product_id = p.id
            join public.tags t on t.id = pt.tag_id
            where p.shop_id = s.id and p.active and t.slug = p_tag))
      and (q.raw is null or s.search @@ q.tsq or s.name ilike '%' || q.raw || '%'
           or exists (select 1 from public.products p where p.shop_id = s.id and p.active and p.search @@ q.tsq))
      and (p_min_lat is null or s.lat between p_min_lat and p_max_lat)
      and (p_min_lng is null or (case when p_min_lng <= p_max_lng
                                      then s.lng between p_min_lng and p_max_lng
                                      else s.lng >= p_min_lng or s.lng <= p_max_lng end))
      and (p_radius_km is null or p_lat is null
           or public.distance_km(p_lat, p_lng, s.lat, s.lng) <= p_radius_km)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'items', coalesce((
      select jsonb_agg(public.shop_card(h.shop, p_lat, p_lng)
                       order by h.prio desc, h.dist nulls last, h.rating_avg desc, h.name)
      from (select * from hits order by prio desc, dist nulls last, rating_avg desc, name
            limit least(greatest(coalesce(p_limit, 300), 1), 500)) h), '[]'::jsonb)
  )
$$;

create or replace function public.get_shop(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _s public.shops;
  _uid uuid := auth.uid();
  _pl public.plans;
begin
  select * into _s from public.shops where slug = p_slug;
  if not found then return null; end if;
  if _s.status <> 'approved' and _s.owner_id is distinct from _uid and not public.is_admin() then
    return null;
  end if;
  _pl := public.shop_plan(_s.id);
  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', _s.id, 'slug', _s.slug, 'name', _s.name, 'kind', _s.kind, 'tagline', _s.tagline,
      'description', _s.description, 'owner_name', _s.owner_name, 'phone', _s.phone,
      'whatsapp', _s.whatsapp, 'email', _s.email, 'website', _s.website, 'instagram', _s.instagram,
      'hours', _s.hours, 'established_year', _s.established_year, 'address_line', _s.address_line,
      'landmark', _s.landmark, 'locality', _s.locality, 'city', _s.city, 'district', _s.district,
      'state', _s.state, 'country', _s.country, 'country_code', _s.country_code,
      'postal_code', _s.postal_code, 'lat', _s.lat, 'lng', _s.lng, 'photos', to_jsonb(_s.photos),
      'status', _s.status, 'rating_avg', _s.rating_avg, 'rating_count', _s.rating_count,
      'approved_at', _s.approved_at, 'updated_at', _s.updated_at,
      'featured', coalesce(_pl.featured, false), 'plan_name', _pl.name,
      'tags', public.tag_list(array(select tag_id from public.shop_tags where shop_id = _s.id))),
    'products', coalesce((select jsonb_agg(public.product_card(p) order by p.created_at desc)
                          from public.products p where p.shop_id = _s.id and p.active), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'rating', r.rating, 'comment', r.comment, 'created_at', r.created_at,
               'author', public.reviewer_name(pr.full_name, pr.email), 'avatar', pr.avatar_url,
               'seller_reply', r.seller_reply, 'replied_at', r.replied_at)
             order by r.created_at desc)
      from (select * from public.reviews where shop_id = _s.id and not hidden
            order by created_at desc limit 50) r
      left join public.profiles pr on pr.id = r.user_id), '[]'::jsonb),
    'rating_breakdown', (select jsonb_object_agg(g, (select count(*) from public.reviews r
                                                      where r.shop_id = _s.id and not r.hidden and r.rating = g))
                         from generate_series(1, 5) g),
    'nearby', coalesce((
      select jsonb_agg(x.card order by x.d)
      from (select public.shop_card(n, _s.lat, _s.lng) as card, public.distance_km(_s.lat, _s.lng, n.lat, n.lng) as d
            from public.shops n where n.status = 'approved' and n.id <> _s.id
              and n.lat between _s.lat - 1 and _s.lat + 1 and n.lng between _s.lng - 1 and _s.lng + 1
            order by d limit 6) x), '[]'::jsonb)
  );
end $$;

create or replace function public.search_products(
  p_q text default null,
  p_tags text[] default null,
  p_min_price integer default null,
  p_max_price integer default null,
  p_shop_kind text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_km double precision default null,
  p_sort text default 'relevance',
  p_in_stock boolean default null,
  p_shop text default null,
  p_limit integer default 24,
  p_offset integer default 0
) returns jsonb
language sql stable security definer set search_path = '' as $$
  with q as (select public.to_prefix_query(p_q) as tsq, public.nz(p_q) as raw),
  hits as (
    select p as prod, p.price_inr, p.created_at,
           case when q.tsq is null then 0 else ts_rank(p.search, q.tsq) end as rank,
           case when p_lat is null or p_lng is null then null
                else public.distance_km(p_lat, p_lng, s.lat, s.lng) end as dist
    from public.products p
    join public.shops s on s.id = p.shop_id, q
    where p.active and s.status = 'approved'
      and (q.raw is null or p.search @@ q.tsq or p.title ilike '%' || q.raw || '%' or s.search @@ q.tsq)
      and (p_tags is null or cardinality(p_tags) = 0 or (
            select count(distinct t.slug) from public.product_tags pt join public.tags t on t.id = pt.tag_id
            where pt.product_id = p.id and t.slug = any(p_tags)) = cardinality(p_tags))
      and (p_min_price is null or p.price_inr >= p_min_price)
      and (p_max_price is null or p.price_inr <= p_max_price)
      and (p_shop_kind is null or s.kind::text = p_shop_kind)
      and (p_in_stock is null or p.in_stock = p_in_stock)
      and (p_shop is null or s.slug = p_shop)
      and (p_radius_km is null or p_lat is null
           or public.distance_km(p_lat, p_lng, s.lat, s.lng) <= p_radius_km)
  ),
  page as (
    select * from hits
    order by
      case when p_sort = 'price_asc' then coalesce(price_inr, 2147483647) end asc,
      case when p_sort = 'price_desc' then coalesce(price_inr, -1) end desc,
      case when p_sort = 'nearest' then dist end asc nulls last,
      case when p_sort = 'newest' then created_at end desc,
      rank desc, created_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'items', coalesce((select jsonb_agg(public.product_card(pg.prod)
                                        || jsonb_build_object('distance_km', round(pg.dist::numeric, 1)))
                       from page pg), '[]'::jsonb)
  )
$$;

create or replace function public.get_product(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _p public.products;
  _s public.shops;
  _tag_ids uuid[];
begin
  select * into _p from public.products where slug = p_slug;
  if not found then return null; end if;
  select * into _s from public.shops where id = _p.shop_id;
  if (_s.status <> 'approved' or not _p.active)
     and _s.owner_id is distinct from auth.uid() and not public.is_admin() then
    return null;
  end if;
  _tag_ids := array(select tag_id from public.product_tags where product_id = _p.id);
  return jsonb_build_object(
    'product', jsonb_build_object(
      'id', _p.id, 'slug', _p.slug, 'title', _p.title, 'description', _p.description,
      'price_inr', _p.price_inr, 'mrp_inr', _p.mrp_inr, 'colors', to_jsonb(_p.colors),
      'length_m', _p.length_m, 'blouse_included', _p.blouse_included, 'in_stock', _p.in_stock,
      'images', to_jsonb(_p.images), 'active', _p.active, 'created_at', _p.created_at,
      'updated_at', _p.updated_at, 'tags', public.tag_list(_tag_ids)),
    'shop', public.shop_card(_s) || jsonb_build_object('address_line', _s.address_line,
              'landmark', _s.landmark, 'status', _s.status),
    'more_from_shop', coalesce((select jsonb_agg(x.card order by x.created_at desc)
                                from (select public.product_card(p) as card, p.created_at from public.products p
                                      where p.shop_id = _s.id and p.active and p.id <> _p.id
                                      order by p.created_at desc limit 8) x), '[]'::jsonb),
    'similar', coalesce((
      select jsonb_agg(public.product_card(p3) order by x.shared desc, p3.created_at desc)
      from (select p2.id, count(*) as shared from public.products p2
            join public.product_tags pt on pt.product_id = p2.id and pt.tag_id = any(_tag_ids)
            join public.shops s2 on s2.id = p2.shop_id and s2.status = 'approved'
            where p2.active and p2.shop_id <> _s.id
            group by p2.id order by shared desc limit 8) x
      join public.products p3 on p3.id = x.id), '[]'::jsonb)
  );
end $$;

create or replace function public.list_tags(p_category text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'slug', x.slug, 'name', x.name,
                                               'category', x.category, 'is_default', x.is_default, 'count', x.n)
                            order by x.is_default desc, x.n desc, x.name), '[]'::jsonb)
  from (
    select t.*, (select count(*) from public.product_tags pt where pt.tag_id = t.id) +
                (select count(*) from public.shop_tags st where st.tag_id = t.id) as n
    from public.tags t
    where not t.hidden and (p_category is null or t.category::text = p_category)
  ) x
$$;

create or replace function public.get_tag(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'category', t.category,
    'shops', (select count(distinct s.id) from public.shops s
              where s.status = 'approved' and (
                exists (select 1 from public.shop_tags st where st.shop_id = s.id and st.tag_id = t.id) or
                exists (select 1 from public.products p join public.product_tags pt on pt.product_id = p.id
                        where p.shop_id = s.id and p.active and pt.tag_id = t.id))),
    'sarees', (select count(*) from public.products p join public.product_tags pt on pt.product_id = p.id
               join public.shops s on s.id = p.shop_id
               where pt.tag_id = t.id and p.active and s.status = 'approved'))
  from public.tags t where t.slug = p_slug and not t.hidden
$$;

create or replace function public.sitemap_entries() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'shops', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'updated_at', updated_at))
                       from public.shops where status = 'approved'), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('slug', p.slug, 'updated_at', p.updated_at))
                          from public.products p join public.shops s on s.id = p.shop_id
                          where p.active and s.status = 'approved'), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('slug', t.slug))
                      from public.tags t where not t.hidden and exists (
                        select 1 from public.product_tags pt where pt.tag_id = t.id)), '[]'::jsonb)
  )
$$;

create or replace function public.track_shop_event(p_shop uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('view', 'call', 'whatsapp', 'directions') then return; end if;
  if not exists (select 1 from public.shops where id = p_shop and status = 'approved') then return; end if;
  -- Owners looking at their own shop don't count.
  if exists (select 1 from public.shops where id = p_shop and owner_id = auth.uid()) then return; end if;
  insert into public.shop_daily_stats as d (shop_id, day, views, calls, whatsapp, directions)
  values (p_shop, current_date,
          (p_kind = 'view')::int, (p_kind = 'call')::int, (p_kind = 'whatsapp')::int, (p_kind = 'directions')::int)
  on conflict (shop_id, day) do update set
    views = d.views + excluded.views, calls = d.calls + excluded.calls,
    whatsapp = d.whatsapp + excluded.whatsapp, directions = d.directions + excluded.directions;
end $$;

create or replace function public.list_plans() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(p) - 'updated_at' order by p.sort_order, p.price_inr), '[]'::jsonb)
  from public.plans p where p.active
$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'shops', (select count(*) from public.shops), 'at', now())
$$;

-- ─────────────────────────────── Signed-in users ───────────────────────────────
create or replace function public.me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _claims jsonb := auth.jwt();
  _meta jsonb := coalesce(_claims -> 'user_metadata', '{}'::jsonb);
begin
  -- Keep the profile in sync with the Google account.
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
    'shops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name,
                                                           'status', s.status) order by s.created_at)
                       from public.shops s where s.owner_id = _uid), '[]'::jsonb)
  );
end $$;

create or replace function public.update_profile(p_full_name text, p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare _uid uuid := public.require_user();
begin
  if length(coalesce(p_full_name, '')) > 120 or length(coalesce(p_phone, '')) > 20 then
    raise exception 'Name or phone is too long.';
  end if;
  update public.profiles set full_name = public.nz(p_full_name), phone = public.nz(p_phone),
    updated_at = now() where id = _uid;
end $$;

create or replace function public.my_review(p_shop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'rating', r.rating, 'comment', r.comment, 'hidden', r.hidden,
                            'created_at', r.created_at, 'updated_at', r.updated_at)
  from public.reviews r where r.shop_id = p_shop and r.user_id = auth.uid()
$$;

create or replace function public.upsert_review(p_shop uuid, p_rating integer, p_comment text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _s public.shops;
begin
  select * into _s from public.shops where id = p_shop;
  if not found or _s.status <> 'approved' then raise exception 'This shop is not accepting reviews.'; end if;
  if _s.owner_id = _uid then raise exception 'You cannot review your own shop.'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5 stars.'; end if;
  if length(coalesce(p_comment, '')) > 1000 then raise exception 'Keep the review under 1000 characters.'; end if;
  -- Make sure the profile exists so the review shows a name.
  perform public.me();
  -- "hidden" is admin-controlled and deliberately not touched here.
  insert into public.reviews as r (shop_id, user_id, rating, comment)
  values (p_shop, _uid, p_rating, public.nz(p_comment))
  on conflict (shop_id, user_id) do update set rating = excluded.rating, comment = excluded.comment;
  return public.my_review(p_shop);
end $$;

create or replace function public.delete_my_review(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare _uid uuid := public.require_user();
begin
  delete from public.reviews where shop_id = p_shop and user_id = _uid;
end $$;

create or replace function public.toggle_favorite(p_shop uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare _uid uuid := public.require_user();
begin
  if exists (select 1 from public.favorites where user_id = _uid and shop_id = p_shop) then
    delete from public.favorites where user_id = _uid and shop_id = p_shop;
    return false;
  end if;
  if not exists (select 1 from public.shops where id = p_shop and status = 'approved') then
    raise exception 'Shop not found.';
  end if;
  insert into public.favorites (user_id, shop_id) values (_uid, p_shop);
  return true;
end $$;

create or replace function public.is_favorite(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.favorites where user_id = auth.uid() and shop_id = p_shop)
$$;

create or replace function public.my_activity() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare _uid uuid := public.require_user();
begin
  return jsonb_build_object(
    'favorites', coalesce((select jsonb_agg(public.shop_card(s) order by f.created_at desc)
                           from public.favorites f join public.shops s on s.id = f.shop_id
                           where f.user_id = _uid and s.status = 'approved'), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'comment', r.comment,
                                  'hidden', r.hidden, 'created_at', r.created_at, 'seller_reply', r.seller_reply,
                                  'shop', jsonb_build_object('slug', s.slug, 'name', s.name, 'city', s.city))
                                order by r.created_at desc)
                         from public.reviews r join public.shops s on s.id = r.shop_id
                         where r.user_id = _uid), '[]'::jsonb)
  );
end $$;

-- ─────────────────────────────── Tags ───────────────────────────────
create or replace function public.create_tag(p_name text, p_category text default 'other') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  _slug text := public.slugify(p_name);
  _t public.tags;
begin
  if length(_name) < 2 or length(_name) > 40 then raise exception 'Tag names must be 2–40 characters.'; end if;
  if _name !~ '[[:alpha:]]' then raise exception 'Tag names must contain letters.'; end if;
  select * into _t from public.tags where slug = _slug;
  if found then
    if _t.hidden then raise exception 'That tag is not available. Pick another name.'; end if;
    return jsonb_build_object('id', _t.id, 'slug', _t.slug, 'name', _t.name, 'category', _t.category,
                              'is_default', _t.is_default, 'created', false);
  end if;
  if (select count(*) from public.tags where created_by = _uid and created_at > now() - interval '1 day') >= 30
     and not public.is_admin() then
    raise exception 'You have created many tags today. Please try again tomorrow.';
  end if;
  insert into public.tags (slug, name, category, created_by)
  values (_slug, _name,
          case when p_category in ('fabric','weave','work','occasion','style','other')
               then p_category::public.tag_category else 'other' end,
          _uid)
  returning * into _t;
  return jsonb_build_object('id', _t.id, 'slug', _t.slug, 'name', _t.name, 'category', _t.category,
                            'is_default', false, 'created', true);
end $$;

-- ─────────────────────────────── Sellers ───────────────────────────────
create or replace function public.shop_fields_valid(p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p ? 'name' and length(coalesce(public.nz(p ->> 'name'), '')) < 2 then
    raise exception 'Enter the shop name.';
  end if;
  if p ? 'phone' and coalesce(p ->> 'phone', '') !~ '^\+?[0-9 ()-]{6,20}$' then
    raise exception 'Enter a valid phone number.';
  end if;
  if public.nz(p ->> 'whatsapp') is not null and (p ->> 'whatsapp') !~ '^\+?[0-9 ()-]{6,20}$' then
    raise exception 'Enter a valid WhatsApp number.';
  end if;
  if public.nz(p ->> 'email') is not null and (p ->> 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if p ? 'lat' and (p ->> 'lat' is null or (p ->> 'lat')::double precision not between -90 and 90
                    or (p ->> 'lng')::double precision not between -180 and 180) then
    raise exception 'Drop the pin on your shop location.';
  end if;
  if p ? 'city' and public.nz(p ->> 'city') is null then
    raise exception 'Enter the city or town.';
  end if;
  if p ? 'kind' and (p ->> 'kind') not in ('shop','weaver','cooperative','manufacturer','wholesaler','showroom','boutique') then
    raise exception 'Choose a business type.';
  end if;
end $$;

create or replace function public.clean_url(p text) returns text
language sql immutable set search_path = '' as $$
  select case when public.nz(p) is null then null
              when p ~* '^https?://' then trim(p)
              else 'https://' || trim(p) end
$$;

create or replace function public.create_shop(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _id uuid := gen_random_uuid();
  _slug text;
  _free public.plans;
  _photos text[];
  _tags uuid[];
begin
  perform public.me();
  if (select count(*) from public.shops where owner_id = _uid) >= 5 and not public.is_admin() then
    raise exception 'You can register up to 5 shops. Contact support for more.';
  end if;
  if not (p ? 'name' and p ? 'phone' and p ? 'lat' and p ? 'lng' and p ? 'city') then
    raise exception 'Shop name, phone, city and map location are required.';
  end if;
  perform public.shop_fields_valid(p);
  select * into _free from public.plans where code = 'free';
  _photos := public.check_media_paths(array(select jsonb_array_elements_text(coalesce(p -> 'photos', '[]'))),
                                      coalesce(_free.max_photos, 3));
  _tags := public.clean_tag_ids(p -> 'tag_ids', 20);
  _slug := left(public.slugify(p ->> 'name'), 50) || '-' || left(public.slugify(p ->> 'city'), 30) || '-' || left(replace(_id::text, '-', ''), 5);

  insert into public.shops (id, owner_id, slug, name, kind, tagline, description, owner_name, phone, whatsapp,
    email, website, instagram, hours, established_year, address_line, landmark, locality, city, district,
    state, country, country_code, postal_code, lat, lng, photos, status)
  values (_id, _uid, _slug, trim(p ->> 'name'), coalesce(p ->> 'kind', 'shop')::public.shop_kind,
    public.nz(p ->> 'tagline'), public.nz(p ->> 'description'), public.nz(p ->> 'owner_name'),
    trim(p ->> 'phone'), public.nz(p ->> 'whatsapp'), lower(public.nz(p ->> 'email')),
    public.clean_url(p ->> 'website'), public.nz(ltrim(p ->> 'instagram', '@')), public.nz(p ->> 'hours'),
    nullif(p ->> 'established_year', '')::integer, public.nz(p ->> 'address_line'), public.nz(p ->> 'landmark'),
    public.nz(p ->> 'locality'), trim(p ->> 'city'), public.nz(p ->> 'district'), public.nz(p ->> 'state'),
    coalesce(public.nz(p ->> 'country'), 'India'), upper(coalesce(public.nz(p ->> 'country_code'), 'IN')),
    public.nz(p ->> 'postal_code'), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
    _photos, 'pending');

  insert into public.shop_tags (shop_id, tag_id) select _id, unnest(_tags);
  perform public.refresh_shop_search(_id);
  return jsonb_build_object('id', _id, 'slug', _slug, 'status', 'pending');
end $$;

create or replace function public.owned_shop(p_shop uuid) returns public.shops
language plpgsql stable security definer set search_path = '' as $$
declare
  _s public.shops;
begin
  select * into _s from public.shops where id = p_shop;
  if not found or (_s.owner_id <> auth.uid() and not public.is_admin()) then
    raise exception 'Shop not found.' using errcode = '42501';
  end if;
  return _s;
end $$;

-- Contact details, photos, hours and tags update instantly. Name, business type and
-- location of an approved shop go to the admin as a change request (small pin fixes are instant).
create or replace function public.update_shop(p_shop uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _s public.shops := public.owned_shop(p_shop);
  _pl public.plans := public.shop_plan(p_shop);
  _review jsonb := '{}'::jsonb;
  _k text;
  _photos text[];
  _moved double precision;
begin
  perform public.shop_fields_valid(p);
  if p ? 'photos' then
    _photos := public.check_media_paths(array(select jsonb_array_elements_text(coalesce(p -> 'photos', '[]'))),
                                        coalesce(_pl.max_photos, 3));
  end if;

  update public.shops set
    tagline = case when p ? 'tagline' then public.nz(p ->> 'tagline') else tagline end,
    description = case when p ? 'description' then public.nz(p ->> 'description') else description end,
    owner_name = case when p ? 'owner_name' then public.nz(p ->> 'owner_name') else owner_name end,
    phone = case when p ? 'phone' then trim(p ->> 'phone') else phone end,
    whatsapp = case when p ? 'whatsapp' then public.nz(p ->> 'whatsapp') else whatsapp end,
    email = case when p ? 'email' then lower(public.nz(p ->> 'email')) else email end,
    website = case when p ? 'website' then public.clean_url(p ->> 'website') else website end,
    instagram = case when p ? 'instagram' then public.nz(ltrim(p ->> 'instagram', '@')) else instagram end,
    hours = case when p ? 'hours' then public.nz(p ->> 'hours') else hours end,
    established_year = case when p ? 'established_year' then nullif(p ->> 'established_year', '')::integer else established_year end,
    address_line = case when p ? 'address_line' then public.nz(p ->> 'address_line') else address_line end,
    landmark = case when p ? 'landmark' then public.nz(p ->> 'landmark') else landmark end,
    postal_code = case when p ? 'postal_code' then public.nz(p ->> 'postal_code') else postal_code end,
    photos = coalesce(_photos, photos)
  where id = p_shop;

  if p ? 'tag_ids' then
    delete from public.shop_tags where shop_id = p_shop;
    insert into public.shop_tags (shop_id, tag_id) select p_shop, unnest(public.clean_tag_ids(p -> 'tag_ids', 20));
  end if;

  -- Fields that change what buyers see on the map.
  foreach _k in array array['name','kind','locality','city','district','state','country','country_code'] loop
    if p ? _k and public.nz(p ->> _k) is distinct from public.nz(to_jsonb(_s) ->> _k) then
      _review := _review || jsonb_build_object(_k, public.nz(p ->> _k));
    end if;
  end loop;
  if p ? 'lat' and p ? 'lng' then
    _moved := public.distance_km(_s.lat, _s.lng, (p ->> 'lat')::double precision, (p ->> 'lng')::double precision);
    if _moved > 0.3 then
      _review := _review || jsonb_build_object('lat', (p ->> 'lat')::double precision, 'lng', (p ->> 'lng')::double precision);
    elsif _moved > 0 then
      update public.shops set lat = (p ->> 'lat')::double precision, lng = (p ->> 'lng')::double precision where id = p_shop;
    end if;
  end if;

  if _review <> '{}'::jsonb then
    if _s.status in ('pending', 'rejected') then
      -- Not live yet: apply directly.
      update public.shops set
        name = coalesce(_review ->> 'name', name),
        kind = coalesce((_review ->> 'kind')::public.shop_kind, kind),
        locality = case when _review ? 'locality' then _review ->> 'locality' else locality end,
        city = coalesce(_review ->> 'city', city),
        district = case when _review ? 'district' then _review ->> 'district' else district end,
        state = case when _review ? 'state' then _review ->> 'state' else state end,
        country = coalesce(_review ->> 'country', country),
        country_code = coalesce(upper(_review ->> 'country_code'), country_code),
        lat = coalesce((_review ->> 'lat')::double precision, lat),
        lng = coalesce((_review ->> 'lng')::double precision, lng)
      where id = p_shop;
    else
      update public.shops set pending_changes = coalesce(pending_changes, '{}'::jsonb) || _review where id = p_shop;
    end if;
  end if;

  -- A rejected application becomes pending again when the seller edits it.
  if _s.status = 'rejected' then
    update public.shops set status = 'pending', submitted_at = now() where id = p_shop;
  end if;

  perform public.refresh_shop_search(p_shop);
  return jsonb_build_object('status', (select status from public.shops where id = p_shop),
                            'pending_changes', (select pending_changes from public.shops where id = p_shop));
end $$;

create or replace function public.cancel_shop_changes(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.owned_shop(p_shop);
  update public.shops set pending_changes = null where id = p_shop;
end $$;

create or replace function public.my_shop(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _s public.shops := public.owned_shop(p_shop);
  _pl public.plans := public.shop_plan(p_shop);
begin
  return jsonb_build_object(
    'shop', to_jsonb(_s) - 'search' - 'owner_id',
    'tags', public.tag_list(array(select tag_id from public.shop_tags where shop_id = p_shop)),
    'plan', to_jsonb(_pl) - 'updated_at',
    'plan_ends_at', public.shop_plan_ends(p_shop),
    'usage', jsonb_build_object(
      'products', (select count(*) from public.products where shop_id = p_shop),
      'max_products', _pl.max_products, 'max_photos', _pl.max_photos),
    'stats', jsonb_build_object(
      'last30', (select jsonb_build_object('views', coalesce(sum(views), 0), 'calls', coalesce(sum(calls), 0),
                                           'whatsapp', coalesce(sum(whatsapp), 0), 'directions', coalesce(sum(directions), 0))
                 from public.shop_daily_stats where shop_id = p_shop and day > current_date - 30),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('day', g::date,
                           'views', coalesce(d.views, 0), 'leads', coalesce(d.calls + d.whatsapp + d.directions, 0))
                           order by g)
                         from generate_series(current_date - 29, current_date, interval '1 day') g
                         left join public.shop_daily_stats d on d.shop_id = p_shop and d.day = g::date), '[]'::jsonb),
      'favorites', (select count(*) from public.favorites where shop_id = p_shop)),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', p.id, 'slug', p.slug, 'title', p.title, 'description', p.description,
                    'price_inr', p.price_inr, 'mrp_inr', p.mrp_inr, 'colors', to_jsonb(p.colors),
                    'length_m', p.length_m, 'blouse_included', p.blouse_included, 'in_stock', p.in_stock,
                    'images', to_jsonb(p.images), 'active', p.active, 'updated_at', p.updated_at,
                    'tags', public.tag_list(array(select tag_id from public.product_tags where product_id = p.id)))
                  order by p.created_at desc)
                  from public.products p where p.shop_id = p_shop), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', r.id, 'rating', r.rating, 'comment', r.comment, 'created_at', r.created_at,
                    'author', public.reviewer_name(pr.full_name, pr.email), 'seller_reply', r.seller_reply,
                    'hidden', r.hidden) order by r.created_at desc)
                  from public.reviews r left join public.profiles pr on pr.id = r.user_id
                  where r.shop_id = p_shop), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', pay.id, 'plan_code', pay.plan_code, 'amount_paise', pay.amount_paise,
                    'status', pay.status, 'provider', pay.provider, 'razorpay_payment_id', pay.razorpay_payment_id,
                    'razorpay_order_id', pay.razorpay_order_id, 'method', pay.method,
                    'created_at', pay.created_at, 'paid_at', pay.paid_at) order by pay.created_at desc)
                  from public.payments pay where pay.shop_id = p_shop and pay.status <> 'created'), '[]'::jsonb),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('plan_code', s.plan_code,
                    'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.ends_at desc)
                  from public.subscriptions s where s.shop_id = p_shop), '[]'::jsonb)
  );
end $$;

create or replace function public.save_product(p_shop uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_user();
  _s public.shops := public.owned_shop(p_shop);
  _pl public.plans := public.shop_plan(p_shop);
  _id uuid := nullif(p ->> 'id', '')::uuid;
  _slug text;
  _images text[];
  _price integer := nullif(p ->> 'price_inr', '')::integer;
  _mrp integer := nullif(p ->> 'mrp_inr', '')::integer;
  _colors text[];
begin
  if length(coalesce(public.nz(p ->> 'title'), '')) < 3 then raise exception 'Give the saree a title.'; end if;
  if _mrp is not null and _price is not null and _mrp < _price then
    raise exception 'MRP cannot be lower than the selling price.';
  end if;
  _images := public.check_media_paths(array(select jsonb_array_elements_text(coalesce(p -> 'images', '[]'))), 6);
  if coalesce(array_length(_images, 1), 0) = 0 then raise exception 'Add at least one photo of the saree.'; end if;
  _colors := array(select distinct left(trim(c), 30) from jsonb_array_elements_text(coalesce(p -> 'colors', '[]')) c
                   where trim(c) <> '' limit 6);

  if _id is null then
    if (select count(*) from public.products where shop_id = p_shop) >= _pl.max_products then
      raise exception 'Your % plan allows % sarees. Upgrade your plan to add more.', _pl.name, _pl.max_products;
    end if;
    _id := gen_random_uuid();
    _slug := left(public.slugify(p ->> 'title'), 60) || '-' || left(replace(_id::text, '-', ''), 6);
    insert into public.products (id, shop_id, slug, title, description, price_inr, mrp_inr, colors, length_m,
                                 blouse_included, in_stock, images, active)
    values (_id, p_shop, _slug, trim(p ->> 'title'), public.nz(p ->> 'description'), _price, _mrp, _colors,
            nullif(p ->> 'length_m', '')::numeric, coalesce((p ->> 'blouse_included')::boolean, true),
            coalesce((p ->> 'in_stock')::boolean, true), _images, coalesce((p ->> 'active')::boolean, true));
  else
    if not exists (select 1 from public.products where id = _id and shop_id = p_shop) then
      raise exception 'Saree not found.';
    end if;
    update public.products set
      title = trim(p ->> 'title'), description = public.nz(p ->> 'description'),
      price_inr = _price, mrp_inr = _mrp, colors = _colors,
      length_m = nullif(p ->> 'length_m', '')::numeric,
      blouse_included = coalesce((p ->> 'blouse_included')::boolean, blouse_included),
      in_stock = coalesce((p ->> 'in_stock')::boolean, in_stock),
      images = _images, active = coalesce((p ->> 'active')::boolean, active)
    where id = _id
    returning slug into _slug;
  end if;

  if p ? 'tag_ids' then
    delete from public.product_tags where product_id = _id;
    insert into public.product_tags (product_id, tag_id) select _id, unnest(public.clean_tag_ids(p -> 'tag_ids', 15));
  end if;
  perform public.refresh_product_search(_id);
  return jsonb_build_object('id', _id, 'slug', _slug);
end $$;

create or replace function public.delete_product(p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare _shop uuid;
begin
  perform public.require_user();
  select shop_id into _shop from public.products where id = p_product;
  if _shop is null then raise exception 'Saree not found.'; end if;
  perform public.owned_shop(_shop);
  delete from public.products where id = p_product;
end $$;

create or replace function public.reply_review(p_review uuid, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
declare _shop uuid;
begin
  perform public.require_user();
  select shop_id into _shop from public.reviews where id = p_review;
  if _shop is null then raise exception 'Review not found.'; end if;
  perform public.owned_shop(_shop);
  if length(coalesce(p_reply, '')) > 1000 then raise exception 'Keep the reply under 1000 characters.'; end if;
  update public.reviews set seller_reply = public.nz(p_reply),
    replied_at = case when public.nz(p_reply) is null then null else now() end
  where id = p_review;
end $$;

-- ─────────────────────────────── Admin ───────────────────────────────
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
    'revenue_30d_paise', (select coalesce(sum(amount_paise), 0) from public.payments
                          where status = 'paid' and paid_at > now() - interval '30 days'),
    'revenue_total_paise', (select coalesce(sum(amount_paise), 0) from public.payments where status = 'paid'),
    'leads_30d', (select coalesce(sum(calls + whatsapp + directions), 0) from public.shop_daily_stats
                  where day > current_date - 30)
  );
end $$;

create or replace function public.admin_shops(p_status text default null, p_q text default null,
                                               p_changes boolean default false,
                                               p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    with rows as (
      select s.*, pr.email as owner_email, pr.full_name as owner_full_name
      from public.shops s left join public.profiles pr on pr.id = s.owner_id
      where (p_status is null or s.status::text = p_status)
        and (not coalesce(p_changes, false) or s.pending_changes is not null)
        and (public.nz(p_q) is null or s.name ilike '%' || p_q || '%' or s.city ilike '%' || p_q || '%'
             or pr.email ilike '%' || p_q || '%' or s.phone ilike '%' || p_q || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from rows),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'slug', r.slug, 'name', r.name, 'kind', r.kind, 'status', r.status,
          'city', r.city, 'state', r.state, 'country', r.country, 'phone', r.phone,
          'owner_email', r.owner_email, 'owner_name', coalesce(r.owner_name, r.owner_full_name),
          'cover', r.photos[1], 'submitted_at', r.submitted_at, 'approved_at', r.approved_at,
          'has_changes', r.pending_changes is not null, 'rating_avg', r.rating_avg,
          'rating_count', r.rating_count, 'plan', (public.shop_plan(r.id)).code,
          'products', (select count(*) from public.products p where p.shop_id = r.id))
        order by r.submitted_at desc)
        from (select * from rows order by submitted_at desc
              limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) r), '[]'::jsonb))
  );
end $$;

create or replace function public.admin_shop(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare _s public.shops;
begin
  perform public.require_admin();
  select * into _s from public.shops where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
  return public.my_shop(p_shop) || jsonb_build_object(
    'owner', (select jsonb_build_object('id', pr.id, 'email', pr.email, 'full_name', pr.full_name,
                                        'phone', pr.phone, 'created_at', pr.created_at,
                                        'other_shops', (select count(*) from public.shops x
                                                        where x.owner_id = pr.id and x.id <> p_shop))
              from public.profiles pr where pr.id = _s.owner_id));
end $$;

create or replace function public.admin_set_shop_status(p_shop uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_status not in ('pending', 'approved', 'rejected', 'suspended') then raise exception 'Unknown status.'; end if;
  if p_status in ('rejected', 'suspended') and public.nz(p_note) is null then
    raise exception 'Add a short note so the seller knows what to fix.';
  end if;
  update public.shops set
    status = p_status::public.shop_status,
    review_note = public.nz(p_note),
    approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else approved_at end
  where id = p_shop;
  if not found then raise exception 'Shop not found.'; end if;
end $$;

create or replace function public.admin_review_changes(p_shop uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare _c jsonb;
begin
  perform public.require_admin();
  select pending_changes into _c from public.shops where id = p_shop;
  if _c is null then raise exception 'No pending changes for this shop.'; end if;
  if p_approve then
    update public.shops set
      name = coalesce(_c ->> 'name', name),
      kind = coalesce((_c ->> 'kind')::public.shop_kind, kind),
      locality = case when _c ? 'locality' then _c ->> 'locality' else locality end,
      city = coalesce(_c ->> 'city', city),
      district = case when _c ? 'district' then _c ->> 'district' else district end,
      state = case when _c ? 'state' then _c ->> 'state' else state end,
      country = coalesce(_c ->> 'country', country),
      country_code = coalesce(upper(_c ->> 'country_code'), country_code),
      lat = coalesce((_c ->> 'lat')::double precision, lat),
      lng = coalesce((_c ->> 'lng')::double precision, lng),
      pending_changes = null, review_note = public.nz(p_note)
    where id = p_shop;
    perform public.refresh_shop_search(p_shop);
  else
    update public.shops set pending_changes = null,
      review_note = coalesce(public.nz(p_note), 'Your requested changes were not approved.')
    where id = p_shop;
  end if;
end $$;

create or replace function public.admin_update_shop(p_shop uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  perform public.shop_fields_valid(p);
  perform public.update_shop(p_shop, p - 'name' - 'kind' - 'locality' - 'city' - 'district' - 'state'
                                       - 'country' - 'country_code' - 'lat' - 'lng');
  update public.shops set
    name = coalesce(public.nz(p ->> 'name'), name),
    kind = coalesce((public.nz(p ->> 'kind'))::public.shop_kind, kind),
    locality = case when p ? 'locality' then public.nz(p ->> 'locality') else locality end,
    city = coalesce(public.nz(p ->> 'city'), city),
    district = case when p ? 'district' then public.nz(p ->> 'district') else district end,
    state = case when p ? 'state' then public.nz(p ->> 'state') else state end,
    country = coalesce(public.nz(p ->> 'country'), country),
    country_code = coalesce(upper(public.nz(p ->> 'country_code')), country_code),
    lat = coalesce((p ->> 'lat')::double precision, lat),
    lng = coalesce((p ->> 'lng')::double precision, lng)
  where id = p_shop;
  perform public.refresh_shop_search(p_shop);
end $$;

create or replace function public.admin_delete_shop(p_shop uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if exists (select 1 from public.payments where shop_id = p_shop and status = 'paid') then
    raise exception 'This shop has paid plans. Suspend it instead of deleting, to keep payment records.';
  end if;
  delete from public.shops where id = p_shop;
end $$;

create or replace function public.admin_reviews(p_hidden boolean default null, p_q text default null,
                                                 p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    with rows as (
      select r.*, s.name as shop_name, s.slug as shop_slug, pr.email, pr.full_name
      from public.reviews r join public.shops s on s.id = r.shop_id
      left join public.profiles pr on pr.id = r.user_id
      where (p_hidden is null or r.hidden = p_hidden)
        and (public.nz(p_q) is null or r.comment ilike '%' || p_q || '%' or s.name ilike '%' || p_q || '%')
    )
    select jsonb_build_object('total', (select count(*) from rows),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'rating', x.rating, 'comment', x.comment, 'hidden', x.hidden, 'hidden_reason', x.hidden_reason,
          'created_at', x.created_at, 'shop_name', x.shop_name, 'shop_slug', x.shop_slug,
          'author', coalesce(x.full_name, x.email), 'email', x.email, 'seller_reply', x.seller_reply)
          order by x.created_at desc)
        from (select * from rows order by created_at desc
              limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]'::jsonb))
  );
end $$;

create or replace function public.admin_set_review_hidden(p_review uuid, p_hidden boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.reviews set hidden = p_hidden, hidden_reason = case when p_hidden then public.nz(p_reason) end
  where id = p_review;
  if not found then raise exception 'Review not found.'; end if;
end $$;

create or replace function public.admin_tags() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name,
      'category', t.category, 'is_default', t.is_default, 'hidden', t.hidden, 'created_at', t.created_at,
      'created_by', pr.email,
      'products', (select count(*) from public.product_tags pt where pt.tag_id = t.id),
      'shops', (select count(*) from public.shop_tags st where st.tag_id = t.id))
      order by t.is_default desc, t.category, t.name)
    from public.tags t left join public.profiles pr on pr.id = t.created_by), '[]'::jsonb);
end $$;

create or replace function public.admin_save_tag(p_id uuid, p_name text, p_category text,
                                                  p_is_default boolean, p_hidden boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare _t public.tags;
begin
  perform public.require_admin();
  if length(trim(coalesce(p_name, ''))) not between 2 and 40 then raise exception 'Tag names must be 2–40 characters.'; end if;
  if p_category not in ('fabric','weave','work','occasion','style','other') then raise exception 'Unknown category.'; end if;
  if p_id is null then
    insert into public.tags (slug, name, category, is_default, hidden, created_by)
    values (public.slugify(p_name), trim(p_name), p_category::public.tag_category, coalesce(p_is_default, false),
            coalesce(p_hidden, false), auth.uid())
    returning * into _t;
  else
    update public.tags set name = trim(p_name), category = p_category::public.tag_category,
      is_default = coalesce(p_is_default, is_default), hidden = coalesce(p_hidden, hidden)
    where id = p_id returning * into _t;
    if not found then raise exception 'Tag not found.'; end if;
  end if;
  return to_jsonb(_t);
exception when unique_violation then
  raise exception 'A tag with that name already exists. Use merge instead.';
end $$;

-- Moves every use of one tag to another, then deletes the first (fixes duplicates like "Pattu" vs "Pure Pattu").
create or replace function public.admin_merge_tags(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare _shop uuid; _prod uuid;
begin
  perform public.require_admin();
  if p_from = p_into then raise exception 'Pick two different tags.'; end if;
  if not exists (select 1 from public.tags where id = p_into) then raise exception 'Tag not found.'; end if;
  insert into public.product_tags (product_id, tag_id)
    select product_id, p_into from public.product_tags where tag_id = p_from on conflict do nothing;
  insert into public.shop_tags (shop_id, tag_id)
    select shop_id, p_into from public.shop_tags where tag_id = p_from on conflict do nothing;
  for _prod in select product_id from public.product_tags where tag_id = p_from loop
    perform public.refresh_product_search(_prod);
  end loop;
  for _shop in select shop_id from public.shop_tags where tag_id = p_from loop
    perform public.refresh_shop_search(_shop);
  end loop;
  delete from public.tags where id = p_from;
end $$;

create or replace function public.admin_plans() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('active_shops',
            (select count(distinct s.shop_id) from public.subscriptions s where s.plan_code = p.code and s.ends_at > now()))
          order by p.sort_order, p.price_inr) from public.plans p), '[]'::jsonb);
end $$;

create or replace function public.admin_save_plan(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if (p ->> 'code') = 'free' and coalesce((p ->> 'price_inr')::integer, 0) <> 0 then
    raise exception 'The free plan must stay at ₹0.';
  end if;
  insert into public.plans as pl (code, name, description, price_inr, duration_days, max_products, max_photos,
                                  featured, priority, features, active, sort_order, updated_at)
  values (p ->> 'code', p ->> 'name', public.nz(p ->> 'description'), (p ->> 'price_inr')::integer,
          (p ->> 'duration_days')::integer, (p ->> 'max_products')::integer, (p ->> 'max_photos')::integer,
          coalesce((p ->> 'featured')::boolean, false), coalesce((p ->> 'priority')::integer, 0),
          array(select jsonb_array_elements_text(coalesce(p -> 'features', '[]'))),
          coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::integer, 0), now())
  on conflict (code) do update set
    name = excluded.name, description = excluded.description, price_inr = excluded.price_inr,
    duration_days = excluded.duration_days, max_products = excluded.max_products,
    max_photos = excluded.max_photos, featured = excluded.featured, priority = excluded.priority,
    features = excluded.features, active = case when pl.code = 'free' then true else excluded.active end,
    sort_order = excluded.sort_order, updated_at = now();
end $$;

create or replace function public.admin_payments(p_status text default null, p_limit integer default 50,
                                                  p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    with rows as (
      select pay.*, s.name as shop_name, s.slug as shop_slug, pr.email
      from public.payments pay join public.shops s on s.id = pay.shop_id
      left join public.profiles pr on pr.id = pay.user_id
      where (p_status is null or pay.status = p_status)
    )
    select jsonb_build_object('total', (select count(*) from rows),
      'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select * from rows order by created_at desc
              limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]'::jsonb))
  );
end $$;

-- Record an offline (UPI / cash / bank) payment and switch the plan on.
create or replace function public.admin_grant_plan(p_shop uuid, p_plan text, p_days integer,
                                                    p_amount_inr integer default 0, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _uid uuid := public.require_admin();
  _pay uuid;
  _owner uuid;
  _ends timestamptz;
begin
  select owner_id into _owner from public.shops where id = p_shop;
  if _owner is null then raise exception 'Shop not found.'; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'Unknown plan.'; end if;
  if p_days is null or p_days not between 1 and 1100 then raise exception 'Days must be between 1 and 1100.'; end if;
  insert into public.payments (shop_id, user_id, plan_code, amount_paise, status, provider, note, paid_at, method)
  values (p_shop, _owner, p_plan, greatest(coalesce(p_amount_inr, 0), 0) * 100, 'paid', 'manual',
          coalesce(public.nz(p_note), 'Granted by admin'), now(), 'manual')
  returning id into _pay;
  _ends := public.grant_subscription(p_shop, p_plan, p_days, _pay);
  return jsonb_build_object('payment_id', _pay, 'ends_at', _ends);
end $$;

create or replace function public.admin_users(p_q text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'email', pr.email, 'full_name', pr.full_name,
      'phone', pr.phone, 'created_at', pr.created_at,
      'is_admin', exists (select 1 from public.user_roles r where r.user_id = pr.id and r.role = 'admin'),
      'shops', (select count(*) from public.shops s where s.owner_id = pr.id),
      'reviews', (select count(*) from public.reviews r where r.user_id = pr.id)) order by pr.created_at desc)
    from (select * from public.profiles pr
          where public.nz(p_q) is null or pr.email ilike '%' || p_q || '%' or pr.full_name ilike '%' || p_q || '%'
          order by pr.created_at desc limit least(greatest(p_limit, 1), 200)) pr), '[]'::jsonb);
end $$;

create or replace function public.admin_set_admin(p_email text, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  _me uuid := public.require_admin();
  _email text := lower(trim(p_email));
  _user uuid;
begin
  if _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email.'; end if;
  select id into _user from public.profiles where email = _email;
  if p_admin then
    insert into public.admin_emails (email) values (_email) on conflict do nothing;
    if _user is not null then
      insert into public.user_roles (user_id, role) values (_user, 'admin') on conflict do nothing;
    end if;
  else
    if _user = _me then raise exception 'You cannot remove your own admin access.'; end if;
    delete from public.admin_emails where email = _email;
    if _user is not null then delete from public.user_roles where user_id = _user and role = 'admin'; end if;
  end if;
end $$;

-- ─────────────────────────────── Payments (server only, service_role) ───────────────────────────────
create or replace function public.payment_prepare(p_user uuid, p_shop uuid, p_plan text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  _s public.shops;
  _pl public.plans;
begin
  select * into _s from public.shops where id = p_shop;
  if not found or _s.owner_id <> p_user then raise exception 'Shop not found.'; end if;
  if _s.status <> 'approved' then raise exception 'Your shop must be approved before you can buy a plan.'; end if;
  select * into _pl from public.plans where code = p_plan and active;
  if not found or _pl.price_inr <= 0 then raise exception 'This plan cannot be bought online.'; end if;
  return jsonb_build_object('amount_paise', _pl.price_inr * 100, 'plan_name', _pl.name,
                            'duration_days', _pl.duration_days, 'shop_name', _s.name);
end $$;

create or replace function public.payment_record_order(p_user uuid, p_shop uuid, p_plan text,
                                                        p_amount_paise integer, p_order_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare _id uuid;
begin
  insert into public.payments (shop_id, user_id, plan_code, amount_paise, razorpay_order_id)
  values (p_shop, p_user, p_plan, p_amount_paise, p_order_id)
  returning id into _id;
  return _id;
end $$;

-- Idempotent: safe to call from both the checkout callback and the webhook.
create or replace function public.payment_mark_paid(p_order_id text, p_payment_id text,
                                                     p_amount_paise integer, p_method text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _pay public.payments;
  _pl public.plans;
  _ends timestamptz;
begin
  select * into _pay from public.payments where razorpay_order_id = p_order_id for update;
  if not found then raise exception 'Unknown order %', p_order_id; end if;
  if _pay.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'already', true, 'ends_at', public.shop_plan_ends(_pay.shop_id));
  end if;
  if p_amount_paise is distinct from _pay.amount_paise then
    raise exception 'Amount mismatch for order %', p_order_id;
  end if;
  select * into _pl from public.plans where code = _pay.plan_code;
  update public.payments set status = 'paid', razorpay_payment_id = p_payment_id, method = p_method,
    paid_at = now(), error_reason = null
  where id = _pay.id;
  _ends := public.grant_subscription(_pay.shop_id, _pay.plan_code, _pl.duration_days, _pay.id);
  return jsonb_build_object('status', 'paid', 'already', false, 'ends_at', _ends);
end $$;

create or replace function public.payment_mark_failed(p_order_id text, p_payment_id text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payments set status = 'failed', error_reason = left(p_reason, 300),
    razorpay_payment_id = coalesce(razorpay_payment_id, p_payment_id)
  where razorpay_order_id = p_order_id and status = 'created';
end $$;

-- ─────────────────────────────── New users ───────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
          coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'))
  on conflict (id) do nothing;
  if exists (select 1 from public.admin_emails a where a.email = lower(new.email)) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin') on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created_sarees_hub on auth.users;
create trigger on_auth_user_created_sarees_hub after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────── Grants ───────────────────────────────
revoke all on all functions in schema public from public, anon, authenticated;

do $$
declare f text;
begin
  -- Anyone (signed in or not).
  foreach f in array array[
    'get_home()', 'search_shops(text,text,text,double precision,double precision,double precision,double precision,double precision,double precision,double precision,integer)',
    'get_shop(text)', 'search_products(text,text[],integer,integer,text,double precision,double precision,double precision,text,boolean,text,integer,integer)',
    'get_product(text)', 'list_tags(text)', 'get_tag(text)', 'sitemap_entries()', 'track_shop_event(uuid,text)',
    'list_plans()', 'health()', 'is_admin()'
  ] loop
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;

  -- Signed-in users (each function checks ownership/admin itself).
  foreach f in array array[
    'me()', 'update_profile(text,text)', 'my_review(uuid)', 'upsert_review(uuid,integer,text)',
    'delete_my_review(uuid)', 'toggle_favorite(uuid)', 'is_favorite(uuid)', 'my_activity()',
    'create_tag(text,text)', 'create_shop(jsonb)', 'update_shop(uuid,jsonb)', 'cancel_shop_changes(uuid)',
    'my_shop(uuid)', 'save_product(uuid,jsonb)', 'delete_product(uuid)', 'reply_review(uuid,text)',
    'admin_overview()', 'admin_shops(text,text,boolean,integer,integer)', 'admin_shop(uuid)',
    'admin_set_shop_status(uuid,text,text)', 'admin_review_changes(uuid,boolean,text)',
    'admin_update_shop(uuid,jsonb)', 'admin_delete_shop(uuid)', 'admin_reviews(boolean,text,integer,integer)',
    'admin_set_review_hidden(uuid,boolean,text)', 'admin_tags()', 'admin_save_tag(uuid,text,text,boolean,boolean)',
    'admin_merge_tags(uuid,uuid)', 'admin_plans()', 'admin_save_plan(jsonb)', 'admin_payments(text,integer,integer)',
    'admin_grant_plan(uuid,text,integer,integer,text)', 'admin_users(text,integer)', 'admin_set_admin(text,boolean)'
  ] loop
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Server only.
  foreach f in array array[
    'payment_prepare(uuid,uuid,text)', 'payment_record_order(uuid,uuid,text,integer,text)',
    'payment_mark_paid(text,text,integer,text)', 'payment_mark_failed(text,text,text)'
  ] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Helpers used inside the functions above (they run as the function owner, so callers need no grant),
-- except these two which are referenced by grant-holding SQL functions running as invoker.
grant execute on function public.nz(text), public.slugify(text), public.distance_km(double precision,double precision,double precision,double precision),
  public.to_prefix_query(text) to anon, authenticated, service_role;
