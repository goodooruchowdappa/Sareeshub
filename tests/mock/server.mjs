// Local stand-in for Supabase (REST rpc + auth/user + storage), Photon and Razorpay.
// It runs the REAL SQL functions against a local Postgres, switching roles exactly like
// PostgREST does, so end-to-end tests exercise the real security rules.
// Usage: node tests/mock/server.mjs  (needs DATABASE_URL to a db built by tests/db/setup-db.mjs)
import http from "node:http";
import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const JWT_SECRET = "local-jwt-secret";
const ANON = "local-anon-key";
const SERVICE = "local-service-key";
const RZP = { id: "rzp_test_local", secret: "local_rzp_secret", webhook: "local_webhook_secret" };
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MEDIA = join(root, "tests/.tmp/media");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });

const b64u = (b) => Buffer.from(b).toString("base64url");
export function signJwt(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verifyJwt(t) {
  const [h, p, s] = (t ?? "").split(".");
  if (!s) return null;
  const good = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  if (good !== s) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  return c.exp && c.exp * 1000 < Date.now() ? null : c;
}

function who(req) {
  const tok = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || req.headers.apikey;
  if (!tok || tok === ANON) return { role: "anon", claims: { role: "anon" } };
  if (tok === SERVICE) return { role: "service_role", claims: { role: "service_role" } };
  const c = verifyJwt(tok);
  return c ? { role: "authenticated", claims: c } : { error: "invalid JWT" };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, ...(isBuf ? {} : { "Content-Type": "application/json" }), ...headers });
  res.end(isBuf ? body : body === undefined ? "" : JSON.stringify(body));
}
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });

async function rpc(fn, args, ident) {
  const names = Object.keys(args);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${ident.role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(ident.claims)]);
    const r = await client.query(
      `select (public.${fn.replace(/[^a-z_]/g, "")}(${names.map((n, i) => `${n.replace(/[^a-z_]/g, "")} => $${i + 1}`).join(", ")}))::text as r`,
      names.map((n) => (args[n] !== null && typeof args[n] === "object" && !Array.isArray(args[n]) ? JSON.stringify(args[n]) : args[n])),
    );
    await client.query("commit");
    const t = r.rows[0].r;
    if (t == null || t === "") return null;
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Fake Razorpay state ──
const orders = new Map();
const payments = new Map();
const mails = [];
function rzpAuth(req) {
  return req.headers.authorization === `Basic ${Buffer.from(`${RZP.id}:${RZP.secret}`).toString("base64")}`;
}

// ── Places for the fake geocoder ──
const PLACES = [
  { name: "Dharmavaram", state: "Andhra Pradesh", country: "India", lat: 14.4144, lng: 77.7206 },
  { name: "Kanchipuram", state: "Tamil Nadu", country: "India", lat: 12.8342, lng: 79.7036 },
  { name: "Hyderabad", state: "Telangana", country: "India", lat: 17.385, lng: 78.4867 },
  { name: "Varanasi", state: "Uttar Pradesh", country: "India", lat: 25.3176, lng: 82.9739 },
  { name: "Pochampally", state: "Telangana", country: "India", lat: 17.3473, lng: 78.8185 },
  { name: "Leicester", state: "England", country: "United Kingdom", lat: 52.6369, lng: -1.1398 },
];
const feature = (p) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [p.lng, p.lat] },
  properties: { name: p.name, osm_value: "town", city: p.name, state: p.state, country: p.country, countrycode: p.country === "India" ? "IN" : "GB", osm_type: "N", osm_id: p.name.length },
});

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    if (req.method === "OPTIONS") return send(res, 204);
    try {
      // ── PostgREST rpc ──
      let m = path.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (m) {
        const ident = who(req);
        if (ident.error) return send(res, 401, { code: "PGRST301", message: "JWT expired" });
        const args = req.method === "GET" ? Object.fromEntries(url.searchParams) : JSON.parse((await readBody(req)).toString() || "{}");
        try {
          return send(res, 200, await rpc(m[1], args, ident));
        } catch (e) {
          return send(res, e.code === "42501" ? 403 : 400, { code: e.code, message: e.message, details: null, hint: null });
        }
      }
      // ── Auth ──
      if (path === "/auth/v1/user") {
        const c = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
        if (!c) return send(res, 401, { message: "invalid JWT" });
        return send(res, 200, { id: c.sub, email: c.email, aud: "authenticated", role: "authenticated", user_metadata: c.user_metadata, app_metadata: {} });
      }
      if (path === "/auth/v1/logout") return send(res, 204);
      // Test helper: create/sign in a user and return a Supabase session object.
      if (path === "/__test/session") {
        const email = url.searchParams.get("email");
        const name = url.searchParams.get("name") ?? email.split("@")[0];
        const r = await pool.query(
          `insert into auth.users (email, raw_user_meta_data) values ($1, $2)
           on conflict (email) do update set email = excluded.email returning id`,
          [email, { full_name: name, avatar_url: null }],
        );
        const now = Math.floor(Date.now() / 1000);
        const user = { id: r.rows[0].id, email, aud: "authenticated", role: "authenticated", user_metadata: { full_name: name }, app_metadata: { provider: "google" } };
        const access_token = signJwt({ sub: user.id, email, role: "authenticated", aud: "authenticated", user_metadata: user.user_metadata, exp: now + 86400, iat: now });
        return send(res, 200, { access_token, refresh_token: "r-" + user.id, expires_in: 86400, expires_at: now + 86400, token_type: "bearer", user });
      }
      // ── Storage ──
      m = path.match(/^\/storage\/v1\/object\/media\/(.+)$/);
      if (m && (req.method === "POST" || req.method === "PUT")) {
        const ident = who(req);
        const p = decodeURIComponent(m[1]);
        if (ident.role !== "authenticated" || !p.startsWith(`${ident.claims.sub}/`))
          return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
        const file = join(MEDIA, p);
        mkdirSync(dirname(file), { recursive: true });
        let body = await readBody(req);
        let type = req.headers["content-type"] ?? "application/octet-stream";
        const bm = type.match(/multipart\/form-data; boundary=(.+)$/);
        if (bm) {
          // supabase-js sends Blobs as multipart: keep only the file part (like Supabase Storage does)
          const sep = Buffer.from(`--${bm[1]}`);
          let at = body.indexOf(sep);
          while (at !== -1) {
            const headEnd = body.indexOf("\r\n\r\n", at);
            const next = body.indexOf(sep, headEnd);
            if (headEnd === -1 || next === -1) break;
            const head = body.subarray(at, headEnd).toString();
            const ct = head.match(/Content-Type: ([^\r\n]+)/i)?.[1];
            if (ct) {
              type = ct;
              body = body.subarray(headEnd + 4, next - 2);
              break;
            }
            at = next;
          }
        }
        writeFileSync(file, body);
        writeFileSync(file + ".type", type);
        return send(res, 200, { Key: `media/${p}`, Id: crypto.randomUUID() });
      }
      m = path.match(/^\/storage\/v1\/object\/public\/media\/(.+)$/);
      if (m) {
        const file = join(MEDIA, decodeURIComponent(m[1]));
        if (!existsSync(file)) return send(res, 404, { error: "not found" });
        return send(res, 200, readFileSync(file), { "Content-Type": readFileSync(file + ".type", "utf8") });
      }
      // ── Map style without remote tiles ──
      if (path === "/style.json")
        return send(res, 200, { version: 8, sources: {}, glyphs: `http://localhost:${PORT}/fonts/{fontstack}/{range}.pbf`, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e9e4d8" } }] });
      if (path.startsWith("/fonts/")) return send(res, 404, {});
      // ── Photon ──
      if (path === "/photon/api") {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        return send(res, 200, { type: "FeatureCollection", features: PLACES.filter((p) => p.name.toLowerCase().includes(q.slice(0, 4))).map(feature) });
      }
      if (path === "/photon/reverse") {
        const lat = Number(url.searchParams.get("lat"));
        const lng = Number(url.searchParams.get("lon"));
        const near = [...PLACES].sort((a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng))[0];
        const f = feature(near);
        f.properties = { ...f.properties, street: "Gandhi Bazaar Road", housenumber: "12", district: "Old Town", postcode: "515671", osm_value: "house", type: "house", name: undefined };
        return send(res, 200, { type: "FeatureCollection", features: [f] });
      }
      // ── Razorpay ──
      if (path.startsWith("/razorpay/v1/")) {
        if (!rzpAuth(req)) return send(res, 401, { error: { description: "Authentication failed" } });
        if (path === "/razorpay/v1/orders" && req.method === "POST") {
          const b = JSON.parse((await readBody(req)).toString());
          const o = { id: `order_${crypto.randomBytes(7).toString("hex")}`, amount: b.amount, currency: b.currency, receipt: b.receipt, notes: b.notes, status: "created" };
          orders.set(o.id, o);
          return send(res, 200, o);
        }
        m = path.match(/^\/razorpay\/v1\/payments\/([^/]+)(\/capture)?$/);
        if (m) {
          const p = payments.get(m[1]);
          if (!p) return send(res, 400, { error: { description: "The id provided does not exist" } });
          if (m[2]) p.status = "captured";
          return send(res, 200, p);
        }
      }
      // Test helper: simulate the buyer paying an order in the Razorpay window.
      if (path === "/__test/pay") {
        const o = orders.get(url.searchParams.get("order_id"));
        if (!o) return send(res, 404, { error: "no order" });
        const status = url.searchParams.get("status") ?? "captured";
        const p = { id: `pay_${crypto.randomBytes(7).toString("hex")}`, order_id: o.id, amount: o.amount, currency: o.currency, status, method: "upi" };
        payments.set(p.id, p);
        const signature = crypto.createHmac("sha256", RZP.secret).update(`${o.id}|${p.id}`).digest("hex");
        return send(res, 200, { razorpay_order_id: o.id, razorpay_payment_id: p.id, razorpay_signature: signature, payment: p });
      }
      // ── Resend (e-mail) ──
      if (path === "/resend/emails/batch" && req.method === "POST") {
        if (req.headers.authorization !== "Bearer local-resend-key") return send(res, 401, { message: "bad key" });
        const b = JSON.parse((await readBody(req)).toString());
        mails.push(...b);
        return send(res, 200, { data: b.map((_, i) => ({ id: `mail_${mails.length + i}` })) });
      }
      if (path === "/__test/mails") return send(res, 200, mails.map((m) => ({ to: m.to[0], subject: m.subject })));
      if (path === "/__test/stats") {
        const r = await pool.query("select coalesce(sum(calls),0)::int as calls, coalesce(sum(views),0)::int as views from public.shop_daily_stats");
        return send(res, 200, r.rows[0]);
      }
      if (path === "/__test/webhook-signature") {
        const body = (await readBody(req)).toString();
        return send(res, 200, { signature: crypto.createHmac("sha256", RZP.webhook).update(body).digest("hex") });
      }
      send(res, 404, { error: `mock: no route ${req.method} ${path}` });
    } catch (e) {
      console.error(e);
      send(res, 500, { message: e.message });
    }
  })
  .listen(PORT, () => console.log(`mock services on http://localhost:${PORT}`));
