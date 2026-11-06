-- Sarees Hub — plans, default tags, admin bootstrap, photo storage.

-- ─────────────────────────────── Plans (prices include GST) ───────────────────────────────
insert into public.plans (code, name, description, price_inr, duration_days, max_products, max_photos,
                          featured, priority, features, sort_order)
values
  ('free', 'Free', 'Get on the map and start receiving calls.', 0, 365, 15, 3, false, 0,
   array['Shop pin on the map', 'Up to 15 sarees', '3 shop photos', 'Calls, WhatsApp & directions',
         'Customer reviews', 'Lead stats'], 0),
  ('pro', 'Pro', 'Stand out in your area.', 299, 30, 150, 10, true, 10,
   array['Featured badge & highlighted pin', 'Shown before free shops in search and on the map',
         'Up to 150 sarees', '10 shop photos', 'Home page spotlight rotation'], 1),
  ('pro_year', 'Pro — yearly', 'Pro for 12 months — 2 months free.', 2990, 365, 150, 10, true, 10,
   array['Everything in Pro', 'Pay once for the year (save ₹598)'], 2),
  ('premium_year', 'Premium — yearly', 'For showrooms and big weavers with large catalogues.', 5999, 365, 1000, 20, true, 20,
   array['Top placement in your area', 'Up to 1000 sarees', '20 shop photos', 'Home page spotlight priority',
         'Priority support'], 3)
on conflict (code) do nothing;

-- ─────────────────────────────── Default tags ───────────────────────────────
insert into public.tags (slug, name, category, is_default)
select public.slugify(v.name), v.name, v.category::public.tag_category, true
from (values
  -- Fabric
  ('Pure Pattu', 'fabric'), ('Semi Pattu', 'fabric'), ('Pure Silk', 'fabric'), ('Soft Silk', 'fabric'),
  ('Art Silk', 'fabric'), ('Silk Cotton', 'fabric'), ('Cotton', 'fabric'), ('Linen', 'fabric'),
  ('Tussar Silk', 'fabric'), ('Mysore Silk', 'fabric'), ('Raw Silk', 'fabric'), ('Organza', 'fabric'),
  ('Georgette', 'fabric'), ('Chiffon', 'fabric'), ('Crepe', 'fabric'),
  -- Weave / region
  ('Kanchipuram', 'weave'), ('Dharmavaram', 'weave'), ('Banarasi', 'weave'), ('Pochampally Ikat', 'weave'),
  ('Gadwal', 'weave'), ('Venkatagiri', 'weave'), ('Mangalagiri', 'weave'), ('Uppada', 'weave'),
  ('Narayanpet', 'weave'), ('Chettinad', 'weave'), ('Arani', 'weave'), ('Kasavu', 'weave'),
  ('Chanderi', 'weave'), ('Maheshwari', 'weave'), ('Paithani', 'weave'), ('Patola', 'weave'),
  ('Bandhani', 'weave'), ('Sambalpuri', 'weave'), ('Jamdani', 'weave'), ('Baluchari', 'weave'),
  ('Ilkal', 'weave'), ('Kota Doria', 'weave'), ('Bhagalpuri', 'weave'),
  -- Zari & work
  ('Pure Zari', 'work'), ('Tested Zari', 'work'), ('Half Fine Zari', 'work'), ('No Zari', 'work'),
  ('Embroidered', 'work'), ('Printed', 'work'), ('Hand Block Print', 'work'), ('Kalamkari', 'work'),
  ('Stone Work', 'work'), ('Temple Border', 'work'), ('Korvai', 'work'), ('Contrast Border', 'work'),
  -- Occasion
  ('Bridal', 'occasion'), ('Wedding', 'occasion'), ('Festive', 'occasion'), ('Party Wear', 'occasion'),
  ('Daily Wear', 'occasion'), ('Office Wear', 'occasion'),
  -- Style / trust
  ('Handloom', 'style'), ('Powerloom', 'style'), ('Silk Mark Certified', 'style'), ('Handloom Mark', 'style'),
  ('Light Weight', 'style'), ('Wholesale Available', 'style'), ('Retail', 'style'), ('Custom Orders', 'style')
) as v(name, category)
on conflict (slug) do nothing;

-- ─────────────────────────────── Admins ───────────────────────────────
-- People who sign in with these Google accounts become admins. Add more from Admin → Team.
insert into public.admin_emails (email) values ('goodooruchowdappa@gmail.com') on conflict do nothing;
insert into public.user_roles (user_id, role)
select u.id, 'admin' from auth.users u join public.admin_emails a on a.email = lower(u.email)
on conflict do nothing;
insert into public.profiles (id, email, full_name, avatar_url)
select u.id, lower(u.email), coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u on conflict (id) do nothing;

-- ─────────────────────────────── Photo storage ───────────────────────────────
-- Public bucket: shop and saree photos are meant to be seen. Uploads are compressed to WebP in the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists "media: users upload to own folder" on storage.objects;
create policy "media: users upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media: users update own files" on storage.objects;
create policy "media: users update own files" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media: users delete own files" on storage.objects;
create policy "media: users delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media: admins manage all" on storage.objects;
create policy "media: admins manage all" on storage.objects for all to authenticated
  using (bucket_id = 'media' and public.is_admin()) with check (bucket_id = 'media' and public.is_admin());
