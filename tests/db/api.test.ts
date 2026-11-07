// Database API tests — run against a local Postgres that emulates Supabase (see tests/README.md).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb } from "./setup-db.mjs";

let db: pg.Client;
type Who = { id: string; email: string } | null | "service";

const ADMIN = { id: "", email: "goodooruchowdappa@gmail.com" };
const SELLER = { id: "", email: "seller@example.com" };
const SELLER2 = { id: "", email: "seller2@example.com" };
const BUYER = { id: "", email: "buyer@example.com" };

async function call<T = any>(who: Who, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  const claims =
    who && who !== "service"
      ? { sub: who.id, email: who.email, role: "authenticated", user_metadata: { full_name: who.email.split("@")[0] + " Kumar" } }
      : { role };
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const res = await db.query(sql, names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
    }));
    await db.query("commit");
    return res.rows[0].r as T;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

async function asRole(who: Who, sql: string, params: unknown[] = []) {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    if (who && who !== "service")
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who.id, role })]);
    const r = await db.query(sql, params);
    await db.query("commit");
    return r;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

const media = (u: { id: string }, n = "a") => `${u.id}/shop-${n}.webp`;
let tagIds: Record<string, string> = {};
let shopId = "";
let shopSlug = "";

beforeAll(async () => {
  const url = await createTestDb("sarees_test");
  db = new pg.Client({ connectionString: url });
  await db.connect();
  for (const u of [ADMIN, SELLER, SELLER2, BUYER]) {
    const r = await db.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [u.email, { full_name: u.email.split("@")[0] + " Kumar" }],
    );
    u.id = r.rows[0].id;
  }
  const tags = await db.query(`select id, slug from public.tags`);
  tagIds = Object.fromEntries(tags.rows.map((t) => [t.slug, t.id]));
}, 60_000);

afterAll(async () => {
  await db?.end();
});

describe("access control", () => {
  it("bootstraps the configured admin", async () => {
    const me = await call(ADMIN, "me");
    expect(me.is_admin).toBe(true);
    expect((await call(BUYER, "me")).is_admin).toBe(false);
  });

  it("blocks direct table access for anon and signed-in users", async () => {
    await expect(asRole(null, "select * from public.shops")).rejects.toThrow(/permission denied/);
    await expect(asRole(BUYER, "select * from public.payments")).rejects.toThrow(/permission denied/);
    await expect(asRole(BUYER, "update public.reviews set hidden = false")).rejects.toThrow(/permission denied/);
  });

  it("keeps admin and payment functions away from the wrong callers", async () => {
    await expect(call(null, "me")).rejects.toThrow(/permission denied/);
    await expect(call(BUYER, "admin_overview")).rejects.toThrow(/Only admins/);
    await expect(
      call(BUYER, "payment_mark_paid", { p_order_id: "x", p_payment_id: "y", p_amount_paise: 1 }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("seller onboarding", () => {
  const base = () => ({
    name: "Sri Lakshmi Silks",
    kind: "shop",
    phone: "+91 98480 12345",
    whatsapp: "9848012345",
    city: "Dharmavaram",
    state: "Andhra Pradesh",
    locality: "Gandhi Nagar",
    lat: 14.4144,
    lng: 77.7206,
    photos: [media(SELLER)],
    tag_ids: [tagIds["pure-pattu"], tagIds["dharmavaram"]],
  });

  it("rejects photos uploaded by someone else", async () => {
    await expect(call(SELLER, "create_shop", { p: { ...base(), photos: [media(BUYER)] } })).rejects.toThrow(
      /Invalid photo/,
    );
  });

  it("requires location and a valid phone", async () => {
    await expect(call(SELLER, "create_shop", { p: { ...base(), phone: "abc" } })).rejects.toThrow(/phone/);
    const { lat, lng, ...noPin } = base();
    void lat;
    void lng;
    await expect(call(SELLER, "create_shop", { p: noPin })).rejects.toThrow(/required/);
  });

  it("creates a pending shop that buyers cannot see yet", async () => {
    const r = await call(SELLER, "create_shop", { p: base() });
    shopId = r.id;
    shopSlug = r.slug;
    expect(r.status).toBe("pending");
    expect(r.slug).toMatch(/^sri-lakshmi-silks-dharmavaram-/);
    expect(await call(null, "get_shop", { p_slug: shopSlug })).toBeNull();
    expect((await call(SELLER, "get_shop", { p_slug: shopSlug })).shop.name).toBe("Sri Lakshmi Silks");
    expect((await call(null, "search_shops", {})).total).toBe(0);
  });

  it("lets the admin reject with a note, and an edit resubmits", async () => {
    await expect(call(ADMIN, "admin_set_shop_status", { p_shop: shopId, p_status: "rejected" })).rejects.toThrow(
      /note/,
    );
    await call(ADMIN, "admin_set_shop_status", { p_shop: shopId, p_status: "rejected", p_note: "Add a shop photo" });
    const r = await call(SELLER, "update_shop", { p_shop: shopId, p: { photos: [media(SELLER), media(SELLER, "b")] } });
    expect(r.status).toBe("pending");
  });

  it("approval puts the shop on the map with search, tag and box filters", async () => {
    await call(ADMIN, "admin_set_shop_status", { p_shop: shopId, p_status: "approved" });
    const all = await call(null, "search_shops", { p_lat: 14.68, p_lng: 77.6 });
    expect(all.total).toBe(1);
    expect(all.items[0].distance_km).toBeGreaterThan(20);
    expect(all.items[0].tags).toContain("Pure Pattu");
    expect((await call(null, "search_shops", { p_q: "lakshmi" })).total).toBe(1);
    expect((await call(null, "search_shops", { p_q: "dharma" })).total).toBe(1);
    expect((await call(null, "search_shops", { p_q: "banarasi" })).total).toBe(0);
    expect((await call(null, "search_shops", { p_tag: "pure-pattu" })).total).toBe(1);
    expect((await call(null, "search_shops", { p_kind: "weaver" })).total).toBe(0);
    const box = { p_min_lat: 14, p_min_lng: 77, p_max_lat: 15, p_max_lng: 78 };
    expect((await call(null, "search_shops", box)).total).toBe(1);
    expect((await call(null, "search_shops", { ...box, p_min_lat: 20, p_max_lat: 21 })).total).toBe(0);
    expect((await call(null, "get_shop", { p_slug: shopSlug })).shop.status).toBe("approved");
  });

  it("applies contact edits instantly but sends renames and big moves for review", async () => {
    const r = await call(SELLER, "update_shop", {
      p_shop: shopId,
      p: { phone: "+91 90000 11111", name: "Sri Lakshmi Silk House", lat: 14.4145, lng: 77.7207 },
    });
    expect(r.status).toBe("approved");
    expect(r.pending_changes).toEqual({ name: "Sri Lakshmi Silk House" });
    let s = (await call(null, "get_shop", { p_slug: shopSlug })).shop;
    expect(s.phone).toBe("+91 90000 11111");
    expect(s.name).toBe("Sri Lakshmi Silks");
    expect(s.lat).toBeCloseTo(14.4145, 4); // small pin fix is instant

    await call(SELLER, "update_shop", { p_shop: shopId, p: { lat: 14.5, lng: 77.8 } });
    expect((await call(SELLER, "my_shop", { p_shop: shopId })).shop.pending_changes.lat).toBe(14.5);
    await call(ADMIN, "admin_review_changes", { p_shop: shopId, p_approve: true });
    s = (await call(null, "get_shop", { p_slug: shopSlug })).shop;
    expect(s.name).toBe("Sri Lakshmi Silk House");
    expect(s.lat).toBe(14.5);
  });

  it("does not let other sellers edit the shop", async () => {
    await expect(call(SELLER2, "update_shop", { p_shop: shopId, p: { phone: "9999999999" } })).rejects.toThrow(
      /Shop not found/,
    );
    await expect(call(SELLER2, "my_shop", { p_shop: shopId })).rejects.toThrow(/Shop not found/);
  });
});

describe("tags", () => {
  it("reuses an existing tag instead of duplicating it", async () => {
    const r = await call(SELLER, "create_tag", { p_name: "  pure   PATTU ", p_category: "fabric" });
    expect(r.created).toBe(false);
    expect(r.id).toBe(tagIds["pure-pattu"]);
  });

  it("creates custom tags and lets admins merge duplicates", async () => {
    const a = await call(SELLER, "create_tag", { p_name: "Gadwal Pattu", p_category: "weave" });
    expect(a.created).toBe(true);
    const b = await call(SELLER2, "create_tag", { p_name: "Gadwal Silk", p_category: "weave" });
    tagIds["gadwal-pattu"] = a.id;
    tagIds["gadwal-silk"] = b.id;
    await call(SELLER, "update_shop", {
      p_shop: shopId,
      p: { tag_ids: [tagIds["pure-pattu"], tagIds["dharmavaram"], b.id] },
    });
    await call(ADMIN, "admin_merge_tags", { p_from: b.id, p_into: a.id });
    const tags = (await call(SELLER, "my_shop", { p_shop: shopId })).tags.map((t: any) => t.slug);
    expect(tags).toContain("gadwal-pattu");
    expect(tags).not.toContain("gadwal-silk");
    await expect(call(BUYER, "admin_merge_tags", { p_from: a.id, p_into: tagIds["cotton"] })).rejects.toThrow(
      /Only admins/,
    );
  });
});

describe("sarees catalogue", () => {
  const saree = (n: number, extra: Record<string, unknown> = {}) => ({
    title: `Pure Pattu Dharmavaram Saree ${n}`,
    price_inr: 5000 + n * 1000,
    mrp_inr: 7000 + n * 1000,
    colors: ["Maroon", "Gold"],
    images: [`${SELLER.id}/saree-${n}.webp`],
    tag_ids: [tagIds["pure-pattu"], tagIds["dharmavaram"], tagIds["bridal"]],
    ...extra,
  });

  it("validates price and photos", async () => {
    await expect(call(SELLER, "save_product", { p_shop: shopId, p: saree(0, { images: [] }) })).rejects.toThrow(
      /photo/,
    );
    await expect(
      call(SELLER, "save_product", { p_shop: shopId, p: saree(0, { price_inr: 9000, mrp_inr: 8000 }) }),
    ).rejects.toThrow(/MRP/);
  });

  it("enforces the free plan limit of 15 sarees", async () => {
    for (let i = 1; i <= 15; i++) await call(SELLER, "save_product", { p_shop: shopId, p: saree(i) });
    await expect(call(SELLER, "save_product", { p_shop: shopId, p: saree(16) })).rejects.toThrow(
      /Free plan allows 15/,
    );
  });

  it("searches by tags (all must match), price and text", async () => {
    const all = await call(null, "search_products", { p_tags: ["pure-pattu", "bridal"] });
    expect(all.total).toBe(15);
    expect((await call(null, "search_products", { p_tags: ["pure-pattu", "cotton"] })).total).toBe(0);
    const priced = await call(null, "search_products", { p_min_price: 10000, p_max_price: 12000, p_sort: "price_asc" });
    expect(priced.items.map((x: any) => x.price_inr)).toEqual([10000, 11000, 12000]);
    expect((await call(null, "search_products", { p_q: "dharmav" })).total).toBe(15);
    const page = await call(null, "search_products", { p_limit: 5, p_offset: 10, p_sort: "newest" });
    expect(page.items).toHaveLength(5);
  });

  it("returns a saree page with shop and similar sarees", async () => {
    const first = (await call(null, "search_products", { p_limit: 1 })).items[0];
    const d = await call(null, "get_product", { p_slug: first.slug });
    expect(d.product.tags.map((t: any) => t.slug)).toContain("pure-pattu");
    expect(d.shop.slug).toBe(shopSlug);
    expect(d.more_from_shop.length).toBeGreaterThan(0);
  });
});

describe("reviews", () => {
  it("stops owners reviewing themselves", async () => {
    await expect(call(SELLER, "upsert_review", { p_shop: shopId, p_rating: 5, p_comment: "Best!" })).rejects.toThrow(
      /own shop/,
    );
  });

  it("updates the rating, and hidden reviews stay hidden", async () => {
    await call(BUYER, "upsert_review", { p_shop: shopId, p_rating: 4, p_comment: "Good collection" });
    await call(SELLER2, "upsert_review", { p_shop: shopId, p_rating: 2, p_comment: "Rude staff" });
    let s = (await call(null, "get_shop", { p_slug: shopSlug })).shop;
    expect(s.rating_count).toBe(2);
    expect(Number(s.rating_avg)).toBe(3);

    const reviews = await call(ADMIN, "admin_reviews", {});
    const bad = reviews.items.find((r: any) => r.rating === 2);
    await call(ADMIN, "admin_set_review_hidden", { p_review: bad.id, p_hidden: true, p_reason: "abusive" });
    s = (await call(null, "get_shop", { p_slug: shopSlug })).shop;
    expect(s.rating_count).toBe(1);
    expect(Number(s.rating_avg)).toBe(4);

    await call(SELLER2, "upsert_review", { p_shop: shopId, p_rating: 1, p_comment: "edited" });
    expect((await call(SELLER2, "my_review", { p_shop: shopId })).hidden).toBe(true);
    expect((await call(null, "get_shop", { p_slug: shopSlug })).reviews).toHaveLength(1);
  });

  it("lets the seller reply", async () => {
    const r = (await call(SELLER, "my_shop", { p_shop: shopId })).reviews.find((x: any) => !x.hidden);
    await call(SELLER, "reply_review", { p_review: r.id, p_reply: "Thank you, visit again!" });
    expect((await call(null, "get_shop", { p_slug: shopSlug })).reviews[0].seller_reply).toMatch(/Thank you/);
    await expect(call(BUYER, "reply_review", { p_review: r.id, p_reply: "hack" })).rejects.toThrow(/not found/);
  });
});

describe("plans and payments", () => {
  it("only lets the owner of an approved shop buy", async () => {
    await expect(
      call("service", "payment_prepare", { p_user: BUYER.id, p_shop: shopId, p_plan: "pro" }),
    ).rejects.toThrow(/Shop not found/);
    const p = await call("service", "payment_prepare", { p_user: SELLER.id, p_shop: shopId, p_plan: "pro" });
    expect(p.amount_paise).toBe(29900);
    await expect(
      call("service", "payment_prepare", { p_user: SELLER.id, p_shop: shopId, p_plan: "free" }),
    ).rejects.toThrow(/cannot be bought/);
  });

  it("activates the plan once, rejects wrong amounts, and raises limits", async () => {
    await call("service", "payment_record_order", {
      p_user: SELLER.id, p_shop: shopId, p_plan: "pro", p_amount_paise: 29900, p_order_id: "order_TEST1",
    });
    await expect(
      call("service", "payment_mark_paid", { p_order_id: "order_TEST1", p_payment_id: "pay_1", p_amount_paise: 100 }),
    ).rejects.toThrow(/mismatch/);
    const ok = await call("service", "payment_mark_paid", {
      p_order_id: "order_TEST1", p_payment_id: "pay_1", p_amount_paise: 29900, p_method: "upi",
    });
    expect(ok.already).toBe(false);
    const again = await call("service", "payment_mark_paid", {
      p_order_id: "order_TEST1", p_payment_id: "pay_1", p_amount_paise: 29900,
    });
    expect(again.already).toBe(true);
    const mine = await call(SELLER, "my_shop", { p_shop: shopId });
    expect(mine.plan.code).toBe("pro");
    expect(mine.usage.max_products).toBe(150);
    expect(mine.payments[0].status).toBe("paid");
    // limit raised
    await call(SELLER, "save_product", {
      p_shop: shopId,
      p: { title: "Semi Pattu Saree", price_inr: 1500, images: [`${SELLER.id}/x.webp`] },
    });
    // a second Pro purchase extends from the current end date
    await call("service", "payment_record_order", {
      p_user: SELLER.id, p_shop: shopId, p_plan: "pro", p_amount_paise: 29900, p_order_id: "order_TEST2",
    });
    const r2 = await call("service", "payment_mark_paid", {
      p_order_id: "order_TEST2", p_payment_id: "pay_2", p_amount_paise: 29900,
    });
    const days = (new Date(r2.ends_at).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(59);
  });

  it("puts paid shops first and marks them featured", async () => {
    await call(SELLER2, "create_shop", {
      p: { name: "Kanchi Weavers Co-op", kind: "cooperative", phone: "9876543210", city: "Kanchipuram",
           lat: 12.8342, lng: 79.7036, photos: [] },
    });
    const s2 = (await call(ADMIN, "admin_shops", { p_status: "pending" })).items[0];
    await call(ADMIN, "admin_set_shop_status", { p_shop: s2.id, p_status: "approved" });
    const res = await call(null, "search_shops", {});
    expect(res.items[0].featured).toBe(true);
    expect(res.items[1].featured).toBe(false);
    expect((await call(null, "get_home")).featured[0].id).toBe(shopId);
  });

  it("records failed payments without activating anything", async () => {
    await call("service", "payment_record_order", {
      p_user: SELLER.id, p_shop: shopId, p_plan: "premium_year", p_amount_paise: 599900, p_order_id: "order_FAIL",
    });
    await call("service", "payment_mark_failed", { p_order_id: "order_FAIL", p_payment_id: "pay_f", p_reason: "bank declined" });
    expect((await call(SELLER, "my_shop", { p_shop: shopId })).plan.code).toBe("pro");
  });

  it("lets admins record offline payments", async () => {
    const shops = await call(ADMIN, "admin_shops", { p_q: "Kanchi" });
    const r = await call(ADMIN, "admin_grant_plan", { p_shop: shops.items[0].id, p_plan: "premium_year", p_days: 365, p_amount_inr: 5999, p_note: "UPI ref 1234" });
    expect(r.ends_at).toBeTruthy();
    const ov = await call(ADMIN, "admin_overview");
    expect(Number(ov.revenue_total_paise)).toBe(29900 * 2 + 599900);
  });
});

describe("leads, favourites, storage", () => {
  it("counts buyer actions but not the owner's", async () => {
    await call(null, "track_shop_event", { p_shop: shopId, p_kind: "call" });
    await call(BUYER, "track_shop_event", { p_shop: shopId, p_kind: "whatsapp" });
    await call(SELLER, "track_shop_event", { p_shop: shopId, p_kind: "call" });
    await call(null, "track_shop_event", { p_shop: shopId, p_kind: "bogus" });
    const st = (await call(SELLER, "my_shop", { p_shop: shopId })).stats.last30;
    expect(st.calls).toBe(1);
    expect(st.whatsapp).toBe(1);
  });

  it("toggles favourites", async () => {
    expect(await call(BUYER, "toggle_favorite", { p_shop: shopId })).toBe(true);
    expect((await call(BUYER, "my_activity")).favorites).toHaveLength(1);
    expect(await call(BUYER, "toggle_favorite", { p_shop: shopId })).toBe(false);
  });

  it("only allows uploads into the user's own folder", async () => {
    await asRole(SELLER, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${SELLER.id}/ok.webp`]);
    await expect(
      asRole(SELLER, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${BUYER.id}/x.webp`]),
    ).rejects.toThrow(/row-level security/);
  });

  it("protects admin team changes", async () => {
    await expect(call(ADMIN, "admin_set_admin", { p_email: ADMIN.email, p_admin: false })).rejects.toThrow(/own admin/);
    await call(ADMIN, "admin_set_admin", { p_email: BUYER.email, p_admin: true });
    expect((await call(BUYER, "me")).is_admin).toBe(true);
    await call(ADMIN, "admin_set_admin", { p_email: BUYER.email, p_admin: false });
    expect((await call(BUYER, "me")).is_admin).toBe(false);
  });

  it("builds the sitemap and tag pages", async () => {
    const sm = await call(null, "sitemap_entries");
    expect(sm.shops).toHaveLength(2);
    expect(sm.products.length).toBe(16);
    expect((await call(null, "get_tag", { p_slug: "pure-pattu" })).sarees).toBe(15);
  });
});

describe("custom saree requests", () => {
  const FREE = { id: "", email: "freeseller@example.com" };
  let freeShop = "";
  let reqId = "";
  const req = (over: Record<string, unknown> = {}) => ({
    title: "Pure pattu bridal saree in maroon",
    description: "Like the photo, with a broad zari border",
    min_price: 8000, max_price: 15000, colors: ["Maroon", "Gold"],
    images: [`${BUYER.id}/req-1.webp`], tag_ids: [tagIds["pure-pattu"]],
    city: "Dharmavaram", state: "Andhra Pradesh", lat: 14.42, lng: 77.71, radius_km: 50, ...over,
  });

  beforeAll(async () => {
    const r = await db.query(`insert into auth.users (email) values ($1) returning id`, [FREE.email]);
    FREE.id = r.rows[0].id;
    const s = await call(FREE, "create_shop", {
      p: { name: "Ravi Handlooms", kind: "weaver", phone: "9440012345", city: "Dharmavaram", lat: 14.43, lng: 77.73, photos: [] },
    });
    freeShop = s.id;
    await call(ADMIN, "admin_set_shop_status", { p_shop: freeShop, p_status: "approved" });
  });

  it("needs a signed-in buyer, a location and something to go on", async () => {
    await expect(call(null, "create_request", { p: req() })).rejects.toThrow(/permission denied/);
    await expect(call(BUYER, "create_request", { p: req({ lat: null, city: "" }) })).rejects.toThrow(/city/);
    await expect(call(BUYER, "create_request", { p: req({ images: [`${SELLER.id}/x.webp`] }) })).rejects.toThrow(/Invalid photo/);
    await expect(call(BUYER, "create_request", { p: req({ min_price: 9000, max_price: 100 }) })).rejects.toThrow(/maximum/);
    await expect(
      call(BUYER, "create_request", { p: req({ images: [], tag_ids: [], description: "" }) }),
    ).rejects.toThrow(/reference photo/);
  });

  it("uses the free allowance, then asks for a plan", async () => {
    expect((await call(BUYER, "my_buyer_status")).remaining).toBe(1);
    const r = await call(BUYER, "create_request", { p: req() });
    reqId = r.id;
    expect(r.status.remaining).toBe(0);
    await expect(call(BUYER, "create_request", { p: req({ title: "Another one" }) })).rejects.toThrow(/Choose a plan/);
  });

  it("notifies only nearby unlimited-plan sellers straight away", async () => {
    const n1 = await call(SELLER, "my_notifications");
    expect(n1.items.some((n: any) => n.kind === "request_new")).toBe(true);
    expect((await call(SELLER, "me")).unread).toBeGreaterThan(0);
    // Kanchipuram (~280 km) is outside the 50 km radius, free plan seller gets no ping
    expect((await call(SELLER2, "my_notifications")).items.filter((n: any) => n.kind === "request_new")).toHaveLength(0);
    expect((await call(FREE, "my_notifications")).items).toHaveLength(0);
  });

  it("gives paid sellers a head start; free sellers see it later as a teaser", async () => {
    const paid = await call(SELLER, "seller_requests", { p_shop: shopId });
    expect(paid.status.quota).toBeNull();
    expect(paid.items).toHaveLength(1);
    expect(paid.items[0].description).toBeUndefined(); // locked until opened
    expect((await call(FREE, "seller_requests", { p_shop: freeShop })).items).toHaveLength(0);
    const kanchiShop = (await call(ADMIN, "admin_shops", { p_q: "Kanchi" })).items[0].id;
    expect((await call(SELLER2, "seller_requests", { p_shop: kanchiShop })).items).toHaveLength(0);
    await db.query(`update public.custom_requests set created_at = now() - interval '3 hours'`);
    const free = await call(FREE, "seller_requests", { p_shop: freeShop });
    expect(free.items).toHaveLength(1);
    expect(free.status).toMatchObject({ quota: 3, used: 0 });
    await expect(call(BUYER, "seller_requests", { p_shop: freeShop })).rejects.toThrow(/Shop not found/);
  });

  it("caps free sellers at 3 unlocks a month", async () => {
    // give the buyer an unlimited pass via a Razorpay order (no shop involved)
    const prep = await call("service", "payment_prepare", { p_user: BUYER.id, p_shop: null, p_plan: "buyer_plus" });
    expect(prep).toMatchObject({ amount_paise: 14900, audience: "buyer" });
    await call("service", "payment_record_order", {
      p_user: BUYER.id, p_shop: null, p_plan: "buyer_plus", p_amount_paise: 14900, p_order_id: "order_BUYER1",
    });
    const paid = await call("service", "payment_mark_paid", { p_order_id: "order_BUYER1", p_payment_id: "pay_b1", p_amount_paise: 14900 });
    expect(paid.already).toBe(false);
    const st = await call(BUYER, "my_buyer_status");
    expect(st).toMatchObject({ plan_code: "buyer_plus", quota: null });
    expect((await call(BUYER, "my_buyer_payments"))[0].status).toBe("paid");
    for (let i = 2; i <= 4; i++) await call(BUYER, "create_request", { p: req({ title: `Request number ${i}` }) });
    await db.query(`update public.custom_requests set created_at = now() - interval '3 hours'`);
    const list = (await call(FREE, "seller_requests", { p_shop: freeShop })).items;
    expect(list).toHaveLength(4);
    for (const it of list.slice(0, 3)) await call(FREE, "unlock_request", { p_shop: freeShop, p_request: it.id });
    await expect(call(FREE, "unlock_request", { p_shop: freeShop, p_request: list[3].id })).rejects.toThrow(/Upgrade/);
    // re-opening one already unlocked is free
    await call(FREE, "unlock_request", { p_shop: freeShop, p_request: list[0].id });
    const after = await call(FREE, "seller_requests", { p_shop: freeShop });
    expect(after.status.used).toBe(3);
    expect(after.items.find((x: any) => x.unlocked).description).toBeTruthy();
  });

  it("lets admins change the free allowance", async () => {
    const plans = await call(ADMIN, "admin_plans");
    const free = plans.find((p: any) => p.code === "free");
    await call(ADMIN, "admin_save_plan", { p: { ...free, lead_quota: 0 } });
    expect((await call(FREE, "seller_requests", { p_shop: freeShop })).items.filter((x: any) => !x.unlocked)).toHaveLength(0);
    await call(ADMIN, "admin_save_plan", { p: { ...free, lead_quota: 3 } });
    expect((await call(null, "list_plans", { p_audience: "buyer" })).map((p: any) => p.code)).toEqual([
      "buyer_free", "buyer_pass", "buyer_plus",
    ]);
  });

  it("sends replies with photos and price to the buyer only", async () => {
    await expect(
      call(SELLER, "respond_request", { p_shop: shopId, p_request: reqId, p: { message: "We have it" } }),
    ).rejects.toThrow(/Open the request/);
    await call(SELLER, "unlock_request", { p_shop: shopId, p_request: reqId });
    await expect(
      call(SELLER, "respond_request", { p_shop: shopId, p_request: reqId, p: { message: "Hi", images: [`${BUYER.id}/a.webp`] } }),
    ).rejects.toThrow(/Invalid photo/);
    await call(SELLER, "respond_request", {
      p_shop: shopId, p_request: reqId,
      p: { message: "We can weave this in 3 weeks", price_inr: 12500, ready_in_days: 21, images: [`${SELLER.id}/reply-1.webp`] },
    });
    const n = await call(BUYER, "my_notifications");
    expect(n.items[0]).toMatchObject({ kind: "response_new", link: `/account/requests?id=${reqId}` });
    const mine = await call(BUYER, "my_requests");
    expect(mine.find((r: any) => r.id === reqId)).toMatchObject({ responses: 1, unseen: 1 });
    const full = await call(BUYER, "get_request", { p_id: reqId });
    expect(full.responses[0]).toMatchObject({ price_inr: 12500, ready_in_days: 21 });
    expect(full.responses[0].shop.phone).toBeTruthy();
    expect(full.request.user_id).toBeUndefined();
    await expect(call(SELLER2, "get_request", { p_id: reqId })).rejects.toThrow(/not found/);
    expect((await call(BUYER, "my_requests")).find((r: any) => r.id === reqId).unseen).toBe(0);
  });

  it("lets the buyer shortlist and close, and the seller hears about it", async () => {
    const full = await call(BUYER, "get_request", { p_id: reqId });
    await call(BUYER, "set_response_status", { p_response: full.responses[0].id, p_status: "shortlisted" });
    expect((await call(SELLER, "my_notifications")).items[0].kind).toBe("response_shortlisted");
    await expect(call(SELLER, "set_response_status", { p_response: full.responses[0].id, p_status: "declined" })).rejects.toThrow(/not found/);
    await call(BUYER, "close_request", { p_id: reqId, p_reason: "Found my saree" });
    await expect(
      call(SELLER, "respond_request", { p_shop: shopId, p_request: reqId, p: { message: "Update" } }),
    ).rejects.toThrow(/closed/);
    await call(BUYER, "mark_notifications_read");
    expect((await call(BUYER, "me")).unread).toBe(0);
  });

  it("caps replies per request and lets admins moderate", async () => {
    await call(ADMIN, "admin_save_settings", { p: { max_responses_per_request: 1 } });
    const open = (await call(FREE, "seller_requests", { p_shop: freeShop })).items.find((x: any) => x.unlocked);
    await call(SELLER, "unlock_request", { p_shop: shopId, p_request: open.id });
    await call(SELLER, "respond_request", { p_shop: shopId, p_request: open.id, p: { message: "Available now" } });
    await expect(
      call(FREE, "respond_request", { p_shop: freeShop, p_request: open.id, p: { message: "Me too" } }),
    ).rejects.toThrow(/enough replies/);
    await expect(call(ADMIN, "admin_save_settings", { p: { nope: 1 } })).rejects.toThrow(/Unknown setting/);
    await call(ADMIN, "admin_save_settings", { p: { max_responses_per_request: 10 } });
    const list = await call(ADMIN, "admin_requests", {});
    expect(list.total).toBe(4);
    const r = await call(ADMIN, "get_request", { p_id: open.id });
    await call(ADMIN, "admin_set_response_hidden", { p_id: r.responses[0].id, p_hidden: true });
    expect((await call(BUYER, "get_request", { p_id: open.id })).responses).toHaveLength(0);
    await call(ADMIN, "admin_set_request_status", { p_id: open.id, p_status: "hidden", p_note: "Spam" });
    expect((await call(SELLER, "seller_requests", { p_shop: shopId })).items.find((x: any) => x.id === open.id)).toBeUndefined();
    await expect(call(BUYER, "admin_requests", {})).rejects.toThrow(/Only admins/);
    const ov = await call(ADMIN, "admin_overview");
    expect(ov.paid_buyers).toBe(1);
    expect((await call(ADMIN, "admin_payments", {})).items.some((p: any) => p.shop_name === "Buyer plan")).toBe(true);
  });

  it("keeps the new tables private", async () => {
    await expect(asRole(BUYER, "select * from public.custom_requests")).rejects.toThrow(/permission denied/);
    await expect(asRole(SELLER, "select * from public.notifications")).rejects.toThrow(/permission denied/);
    await expect(call(BUYER, "notifications_to_email")).rejects.toThrow(/permission denied/);
    const mail = await call("service", "notifications_to_email", {});
    expect(Array.isArray(mail)).toBe(true);
  });
});
