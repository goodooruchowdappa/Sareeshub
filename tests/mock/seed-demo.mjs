// Seeds a few approved demo shops and sarees (with generated photos) for local testing & screenshots.
import pg from "pg";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MEDIA = join(root, "tests/.tmp/media/seed");
mkdirSync(MEDIA, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function img(name, [a, b, c], w = 900, h = 1200) {
  const stripes = Array.from({ length: 40 }, (_, i) => `<rect x="0" y="${h - 160 + (i % 8) * 18}" width="${w}" height="${i % 2 ? 6 : 10}" fill="${i % 2 ? c : b}"/>`).join("");
  const motifs = Array.from({ length: 30 }, (_, i) => `<circle cx="${(i * 137) % w}" cy="${(i * 211) % (h - 200)}" r="${10 + (i % 4) * 4}" fill="${c}" opacity=".55"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${motifs}<path d="M0 ${h * 0.35} Q ${w / 2} ${h * 0.2} ${w} ${h * 0.45} L ${w} ${h * 0.5} Q ${w / 2} ${h * 0.27} 0 ${h * 0.41} Z" fill="${c}" opacity=".8"/>${stripes}</svg>`;
  const buf = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
  writeFileSync(join(MEDIA, `${name}.webp`), buf);
  writeFileSync(join(MEDIA, `${name}.webp.type`), "image/webp");
  return `seed/${name}.webp`;
}
async function shopImg(name, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="#f3eadb"/><rect x="120" y="260" width="960" height="560" fill="${color}"/><rect x="120" y="200" width="960" height="110" fill="#c8962e"/><rect x="200" y="380" width="250" height="440" fill="#fbf6ee"/><rect x="520" y="380" width="480" height="260" fill="#fbf6ee" opacity=".85"/>${[0,1,2,3,4,5].map(i=>`<rect x="${540+i*76}" y="400" width="56" height="220" fill="${["#a63446","#2f6b4f","#c8962e","#5f1721","#1f4e79","#e8c97b"][i]}"/>`).join("")}</svg>`;
  writeFileSync(join(MEDIA, `${name}.webp`), await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer());
  writeFileSync(join(MEDIA, `${name}.webp.type`), "image/webp");
  return `seed/${name}.webp`;
}

const owner = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('demo-seller@example.com', '{"full_name":"Ravi Kumar"}') on conflict (email) do update set email = excluded.email returning id`)).rows[0].id;
const tag = async (slug) => (await db.query("select id from public.tags where slug = $1", [slug])).rows[0]?.id;

const shops = [
  { name: "Sri Lakshmi Pattu Sarees", kind: "shop", city: "Dharmavaram", state: "Andhra Pradesh", locality: "Gandhi Bazaar", lat: 14.4139, lng: 77.7196, color: "#7a1f2b", tags: ["pure-pattu", "dharmavaram", "bridal", "pure-zari"], tagline: "Pure Dharmavaram pattu straight from our looms since 1985", plan: "pro" },
  { name: "Ravi Handloom Weavers", kind: "weaver", city: "Dharmavaram", state: "Andhra Pradesh", locality: "Kothapeta", lat: 14.4201, lng: 77.7262, color: "#2f6b4f", tags: ["handloom", "pure-pattu", "custom-orders"], tagline: "Weaver family — custom bridal orders in 3 weeks" },
  { name: "Kanchi Silk Weavers Co-op Society", kind: "cooperative", city: "Kanchipuram", state: "Tamil Nadu", locality: "Gandhi Road", lat: 12.8371, lng: 79.7008, color: "#5f1721", tags: ["kanchipuram", "pure-silk", "silk-mark-certified", "korvai"], tagline: "Silk Mark certified Kanchipuram silks" },
  { name: "Pochampally Ikat House", kind: "manufacturer", city: "Pochampally", state: "Telangana", lat: 17.3476, lng: 78.8191, color: "#1f4e79", tags: ["pochampally-ikat", "silk-cotton", "handloom"], tagline: "Double ikat silks and cottons, wholesale & retail" },
  { name: "Banaras Brocade Emporium", kind: "showroom", city: "Varanasi", state: "Uttar Pradesh", lat: 25.3109, lng: 83.0107, color: "#8e2a3b", tags: ["banarasi", "wedding", "pure-zari"], tagline: "Katan silk Banarasi brocades" },
  { name: "Saree Studio London", kind: "boutique", city: "Leicester", state: "England", country: "United Kingdom", country_code: "GB", lat: 52.6295, lng: -1.1219, color: "#401017", tags: ["kanchipuram", "party-wear", "semi-pattu"], tagline: "South Indian silks in the UK" },
];
const palettes = [["#7a1f2b", "#a63446", "#e8c97b"], ["#1f4e79", "#2f6b4f", "#c8962e"], ["#8e2a3b", "#c8962e", "#fbf6ee"], ["#2f6b4f", "#7f5b15", "#e8c97b"], ["#5f1721", "#401017", "#c8962e"], ["#a63446", "#f5dde0", "#c8962e"]];
const titles = [
  ["Maroon pure pattu with gold zari border", 14500, 18000, ["pure-pattu", "pure-zari", "bridal"]],
  ["Peacock blue soft silk with contrast pallu", 6800, 8200, ["soft-silk", "festive"]],
  ["Semi pattu daily wear with temple border", 1850, 2400, ["semi-pattu", "daily-wear", "temple-border"]],
  ["Bottle green silk cotton with butta", 3200, null, ["silk-cotton", "office-wear"]],
  ["Red bridal pattu with korvai border", 28500, 32000, ["pure-pattu", "bridal", "korvai", "pure-zari"]],
  ["Mustard tested-zari festive saree", 4900, 5600, ["tested-zari", "festive"]],
];
let n = 0;
for (const [i, s] of shops.entries()) {
  const photos = [await shopImg(`shop-${i}`, s.color), await img(`shop-${i}-b`, palettes[i % 6], 1200, 900)];
  const slug = `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${s.city.toLowerCase()}`;
  const r = await db.query(
    `insert into public.shops (owner_id, slug, name, kind, tagline, description, phone, whatsapp, hours, established_year, address_line, locality, city, state, country, country_code, lat, lng, photos, status, approved_at, owner_name)
     values ($1,$2,$3,$4,$5,$6,'+91 98480 1234' || $7::text,'98480 1234' || $7::text,'Mon–Sat 10 AM – 9 PM',1985 + $7::int,'12, Main Road',$8,$9,$10,$11,$12,$13,$14,$15,'approved', now() - make_interval(days => $7::int), 'Ravi Kumar')
     on conflict (slug) do update set name = excluded.name returning id`,
    [owner, slug, s.name, s.kind, s.tagline, `${s.tagline}. Visit us for the latest collection. Wholesale enquiries welcome.`, i, s.locality ?? null, s.city, s.state, s.country ?? "India", s.country_code ?? "IN", s.lat, s.lng, photos],
  );
  const id = r.rows[0].id;
  for (const t of s.tags) { const tid = await tag(t); if (tid) await db.query("insert into public.shop_tags values ($1,$2) on conflict do nothing", [id, tid]); }
  await db.query("select public.refresh_shop_search($1)", [id]);
  if (s.plan) await db.query("insert into public.subscriptions (shop_id, plan_code, ends_at) values ($1, $2, now() + interval '30 days')", [id, s.plan]);
  for (let k = 0; k < (i < 3 ? 6 : 3); k++) {
    const [title, price, mrp, tags] = titles[(k + i) % titles.length];
    const pimg = [await img(`p-${n}`, palettes[(k + i) % 6]), await img(`p-${n}-b`, palettes[(k + i + 2) % 6])];
    const pr = await db.query(
      `insert into public.products (shop_id, slug, title, description, price_inr, mrp_inr, colors, length_m, images)
       values ($1, $2, $3, $4, $5, $6, $7, 6.3, $8) on conflict (slug) do update set title = excluded.title returning id`,
      [id, `demo-${n}`, title, `${title}. Comes with matching blouse piece. Dry clean recommended.`, price, mrp, ["Maroon", "Gold"], pimg],
    );
    for (const t of [...tags, s.tags[1]]) { const tid = await tag(t); if (tid) await db.query("insert into public.product_tags values ($1,$2) on conflict do nothing", [pr.rows[0].id, tid]); }
    await db.query("select public.refresh_product_search($1)", [pr.rows[0].id]);
    n++;
  }
}
// a couple of reviews
const buyers = [];
for (const [e, nm] of [["priya@example.com", "Priya Sharma"], ["anil@example.com", "Anil Reddy"]]) {
  buyers.push((await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) on conflict (email) do update set email = excluded.email returning id`, [e, { full_name: nm }])).rows[0].id);
}
const first = (await db.query("select id from public.shops order by created_at limit 1")).rows[0].id;
await db.query(`insert into public.reviews (shop_id, user_id, rating, comment, seller_reply, replied_at) values ($1,$2,5,'Genuine pure pattu, fair price. They showed us 50+ sarees patiently.', 'Thank you Priya garu! Visit again for Sankranti collection.', now()), ($1,$3,4,'Good collection. Parking is a little difficult.', null, null) on conflict do nothing`, [first, buyers[0], buyers[1]]);
// one pending application for the admin queue
await db.query(`insert into public.shops (owner_id, slug, name, kind, phone, city, state, lat, lng, photos, status, tagline)
  values ($1, 'new-weaver-gadwal', 'Gadwal Sico Weavers', 'weaver', '+91 90000 22222', 'Gadwal', 'Telangana', 16.2350, 77.7956, $2, 'pending', 'Gadwal sico and pure silk') on conflict do nothing`, [owner, [await shopImg("shop-pending", "#7f5b15")]]);
console.log(`seeded ${shops.length} shops, ${n} sarees`);
await db.end();
