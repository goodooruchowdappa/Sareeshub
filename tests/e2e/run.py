"""End-to-end walkthrough in real Chrome against the local app + mock services.

Run (after starting tests/mock/server.mjs and `astro dev`):
    python3 tests/e2e/run.py
Screenshots go to tests/.tmp/shots/.
"""
import json, os, re, sys, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright, expect

APP = os.environ.get("APP_URL", "http://localhost:4321")
MOCK = os.environ.get("MOCK_URL", "http://localhost:54321")
SHOTS = os.path.join(os.path.dirname(__file__), "..", ".tmp", "shots")
os.makedirs(SHOTS, exist_ok=True)
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
results = []
OPEN_PAGES = []


def step(name):
    def wrap(fn):
        def run(*a, **k):
            try:
                fn(*a, **k)
                results.append((name, "PASS", ""))
                print(f"PASS  {name}")
            except Exception as e:  # keep going so we see every failure
                msg = str(e) or repr(e)
                results.append((name, "FAIL", msg[:300] + (" … " + msg[-700:] if len(msg) > 300 else "")))
                for i, pg in enumerate(OPEN_PAGES):
                    try:
                        pg.screenshot(path=os.path.join(SHOTS, f"fail-{len(results)}-{i}.png"))
                    except Exception:
                        pass
                print(f"FAIL  {name}: {results[-1][2]}")
        return run
    return wrap


def get(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def session(email, name):
    return get(f"{MOCK}/__test/session?email={email}&name={urllib.parse.quote(name)}")[1]


def login(page, sess):
    page.goto(f"{APP}/about")
    page.evaluate("s => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s))", sess)


def shot(page, name, full=True):
    page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=full)


def make_photo(path, color):
    import subprocess
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="100%" height="100%" fill="{color}"/><rect x="100" y="900" width="1400" height="120" fill="#c8962e"/></svg>'
    subprocess.run(["node", "-e", f"require('sharp')(Buffer.from(process.argv[1])).jpeg().toFile('{path}')", svg], check=True,
                   cwd=os.path.join(os.path.dirname(__file__), "..", ".."))


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 1366, "height": 900}, geolocation={"latitude": 14.4144, "longitude": 77.7206},
                              permissions=["geolocation"], locale="en-IN")
    page = ctx.new_page()
    OPEN_PAGES.append(page)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    @step("Home page renders with SEO tags and featured shops")
    def _():
        page.goto(APP + "/")
        expect(page.locator("h1")).to_contain_text("on one map")
        assert page.locator('link[rel="canonical"]').get_attribute("href") == "http://localhost:4321/"
        assert page.locator('meta[property="og:image"]').get_attribute("content").endswith("/og-default.png")
        ld = [json.loads(x) for x in page.locator('script[type="application/ld+json"]').all_text_contents()]
        assert any(d["@type"] == "WebSite" for d in ld)
        expect(page.locator("text=Sri Lakshmi Pattu Sarees").first).to_be_visible()
        shot(page, "01-home")
    _()

    @step("Map lists shops near me and filters by type and speciality")
    def _():
        page.goto(APP + "/map?near=1")
        page.wait_for_selector("text=/\\d+ places? in this area/", timeout=20000)
        expect(page.locator("aside >> text=Sri Lakshmi Pattu Sarees")).to_be_visible(timeout=15000)
        assert "Ravi Handloom Weavers" in page.locator("aside").inner_text()
        page.locator("aside button.chip", has_text="Weavers").click()
        page.wait_for_timeout(1200)
        txt = page.locator("aside ul").last.inner_text()
        assert "Ravi Handloom Weavers" in txt and "Sri Lakshmi Pattu" not in txt, txt[:300]
        page.locator("aside button.chip", has_text="All").first.click()
        page.select_option("aside select", "dharmavaram")
        page.wait_for_timeout(1200)
        assert "Sri Lakshmi" in page.locator("aside ul").last.inner_text()
        shot(page, "02-map", full=False)
    _()

    @step("Map place search jumps to another town")
    def _():
        page.select_option("aside select", "")
        box = page.get_by_placeholder("Shop, saree type, or area / city")
        box.fill("Kanchipuram")
        page.locator("text=📍 Kanchipuram").click()
        page.wait_for_url(re.compile(r"lat=12\.8"), timeout=10000)
        expect(page.locator("aside >> text=Kanchi Silk Weavers Co-op Society")).to_be_visible(timeout=10000)
        assert "lat=12.8" in page.url, page.url
    _()

    shop_url = None

    @step("Shop page: contact buttons, JSON-LD, reviews, nearby")
    def _():
        nonlocal_shop = page.goto(APP + "/map?lat=14.4144&lng=77.7206&z=13")
        page.locator("aside a", has_text="Sri Lakshmi Pattu Sarees").first.click()
        page.wait_for_url(re.compile(r"/shops/"))
        globals()["shop_url"] = page.url
        expect(page.locator("h1")).to_have_text("Sri Lakshmi Pattu Sarees")
        wa = page.locator("a[data-track=whatsapp]").first.get_attribute("href")
        assert wa.startswith("https://wa.me/919848012340?text="), wa
        assert page.locator("a[data-track=call]").first.get_attribute("href") == "tel:+919848012340"
        ld = [json.loads(x) for x in page.locator('script[type="application/ld+json"]').all_text_contents()]
        store = next(d for d in ld if d["@type"] == "ClothingStore")
        assert store["aggregateRating"]["reviewCount"] == 2 and store["geo"]["latitude"] == 14.4139
        expect(page.locator("text=Reply from Sri Lakshmi Pattu Sarees")).to_be_visible()
        expect(page.locator("text=More saree shops nearby")).to_be_visible()
        assert "★ Featured" in page.content()
        shot(page, "03-shop")
    _()

    @step("Lead tracking counts a call tap")
    def _():
        page.locator("a[data-track=call]").first.evaluate("""a => {
            a.addEventListener('click', e => e.preventDefault(), { once: true });  // don't actually dial
            a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }""")
        page.wait_for_timeout(800)
        st, res = get(f"{MOCK}/__test/stats")
        assert res["calls"] >= 1 and res["views"] >= 1, res
    _()

    @step("Sarees catalogue: tag filter, price sort, saree page")
    def _():
        page.goto(APP + "/sarees?tag=pure-pattu&sort=price_asc")
        prices = [int(re.sub(r"[^\d]", "", t)) for t in page.locator("section[aria-label=Results] h3 + p span[data-price]").all_text_contents() if re.search(r"\d", t)]
        assert prices == sorted(prices) and len(prices) > 3, f"prices {prices}"
        page.locator("section[aria-label=Results] a").first.click()
        page.wait_for_url(re.compile(r"/sarees/[^?/]+$"))
        ld = [json.loads(x) for x in page.locator('script[type="application/ld+json"]').all_text_contents()]
        prod = next(d for d in ld if d["@type"] == "Product")
        assert prod["offers"]["priceCurrency"] == "INR", prod
        wa = urllib.parse.unquote(page.locator("a[data-track=whatsapp]").first.get_attribute("href"))
        assert "Is it available" in wa, wa
        shot(page, "04-saree")
    _()

    @step("Buyer signs in (Google session) and posts a review that updates the rating")
    def _():
        buyer = session("meena@example.com", "Meena Iyer")
        login(page, buyer)
        page.goto(globals()["shop_url"] + "#reviews")
        page.get_by_role("button", name="Write a review").click()
        page.get_by_role("button", name="3 stars").click()
        page.fill("#rv-comment", "Nice collection, but prices were a bit high for semi pattu.")
        page.get_by_role("button", name="Post review").click()
        expect(page.locator("text=Your review is live")).to_be_visible()
        expect(page.locator("text=Nice collection, but prices")).to_be_visible()  # shown to the reviewer instantly
        page.goto(globals()["shop_url"] + "?fresh=1#reviews")  # public page after the edge cache refreshes
        expect(page.locator("li >> text=Nice collection, but prices")).to_be_visible()
        expect(page.locator("text=4.0 (3)").first).to_be_visible()
        page.get_by_role("button", name="Save", exact=True).click()
        expect(page.get_by_role("button", name="Saved")).to_be_visible()
        page.goto(APP + "/account")
        expect(page.locator("text=Saved shops")).to_be_visible()
        expect(page.locator("main >> text=Sri Lakshmi Pattu Sarees").first).to_be_visible()
    _()

    seller_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                     geolocation={"latitude": 14.4180, "longitude": 77.7230}, permissions=["geolocation"])
    sp = seller_ctx.new_page()
    OPEN_PAGES.append(sp)
    sp.on("pageerror", lambda e: errors.append(str(e)))

    @step("Seller registers on a phone: details, current-location pin, photo, custom tag")
    def _():
        login(sp, session("lakshmi.weaves@example.com", "Lakshmi Devi"))
        sp.goto(APP + "/seller/register")
        sp.fill("#f-name", "Lakshmi Pattu Weaving Centre")
        sp.locator("label", has_text="Handloom weaver").click()
        sp.fill("#f-phone", "+91 94400 55555")
        sp.fill("#f-tagline", "Pure pattu and semi pattu from our own looms")
        sp.get_by_role("button", name="📍 Use my current location").click()
        expect(sp.locator("text=✓ Pin set")).to_be_visible(timeout=15000)
        expect(sp.locator("#f-city")).to_have_value("Dharmavaram", timeout=8000)
        assert sp.locator("#f-pin").input_value() == "515671"
        photo = os.path.abspath(os.path.join(SHOTS, "..", "upload.jpg"))
        make_photo(photo, "#7a1f2b")
        sp.locator("input[type=file]").first.set_input_files(photo)
        expect(sp.locator("text=Cover")).to_be_visible(timeout=15000)
        sp.locator("button.chip", has_text="Pure Pattu").first.click()
        sp.locator("button.chip", has_text="Semi Pattu").first.click()
        sp.get_by_placeholder(re.compile("Search tags")).fill("Dharmavaram Pattu Kuchu")
        sp.get_by_role("button", name="Add tag").click()
        expect(sp.get_by_role("button", name="Remove Dharmavaram Pattu Kuchu")).to_be_visible()
        shot(sp, "05-register-mobile")
        sp.get_by_role("button", name="Submit for approval").click()
        sp.wait_for_url(re.compile(r"/seller\?shop=.*new=1"), timeout=15000)
        expect(sp.locator("text=Thanks! Your shop was submitted")).to_be_visible()
    _()

    @step("Pending shop is hidden from buyers")
    def _():
        st, res = get(f"{MOCK}/rest/v1/rpc/search_shops", "POST", {"p_q": "Lakshmi Pattu Weaving"})
        assert res["total"] == 0, res
    _()

    admin_ctx = browser.new_context(viewport={"width": 1366, "height": 900}, geolocation={"latitude": 14.4260, "longitude": 77.7140}, permissions=["geolocation"])
    ap = admin_ctx.new_page()
    OPEN_PAGES.append(ap)
    ap.on("pageerror", lambda e: errors.append(str(e)))

    @step("Non-admin is blocked from the admin portal")
    def _():
        page.goto(APP + "/admin")
        expect(page.locator("text=Admins only")).to_be_visible(timeout=10000)
    _()

    @step("Admin (your Google account) approves the new shop")
    def _():
        login(ap, session("goodooruchowdappa@gmail.com", "Sai"))
        ap.goto(APP + "/admin")
        expect(ap.locator("text=Admin overview")).to_be_visible(timeout=10000)
        shot(ap, "06-admin-overview")
        ap.get_by_role("button", name=re.compile("^Approvals")).click()
        ap.locator("button", has_text="Lakshmi Pattu Weaving Centre").click()
        expect(ap.locator("text=Check the pin on Google Maps")).to_be_visible()
        shot(ap, "07-admin-review")
        ap.get_by_role("button", name="✓ Approve").click()
        expect(ap.locator("text=Approved — now live on the map")).to_be_visible()
        st, res = get(f"{MOCK}/rest/v1/rpc/search_shops", "POST", {"p_q": "Lakshmi Pattu Weaving"})
        assert res["total"] == 1, res
    _()

    @step("Seller adds a saree with photos, tags and colours")
    def _():
        sp.goto(APP + "/seller?tab=sarees")
        sp.get_by_role("button", name="+ Add saree").first.click()
        photo = os.path.abspath(os.path.join(SHOTS, "..", "upload2.jpg"))
        make_photo(photo, "#1f4e79")
        sp.locator("input[type=file]").first.set_input_files(photo)
        expect(sp.locator("text=Cover")).to_be_visible(timeout=15000)
        sp.fill("#p-title", "Peacock blue pure pattu with zari butta")
        sp.fill("#p-price", "12500")
        sp.fill("#p-mrp", "14000")
        sp.locator("button.chip", has_text="Pure Pattu").first.click()
        sp.locator("button.chip", has_text="Bridal").first.click()
        sp.locator("button.chip", has_text="Peacock Blue").click()
        sp.get_by_role("button", name="Save", exact=True).click()
        expect(sp.locator("text=Peacock blue pure pattu with zari butta")).to_be_visible(timeout=10000)
        shot(sp, "08-seller-sarees-mobile")
        st, res = get(f"{MOCK}/rest/v1/rpc/search_products", "POST", {"p_q": "peacock blue pure pattu butta"})
        assert res["total"] >= 1 and res["items"][0]["price_inr"] == 12500, res
    _()

    @step("Seller renames shop → goes to admin as a change request")
    def _():
        sp.goto(APP + "/seller?tab=details")
        sp.fill("#f-name", "Lakshmi Pattu Weavers")
        sp.fill("#f-hours", "All days 9 AM – 9 PM")
        sp.get_by_role("button", name="Save changes").click()
        expect(sp.locator("text=Changes waiting for review")).to_be_visible(timeout=10000)
        ap.goto(APP + "/admin?tab=changes")
        ap.locator("button", has_text="Lakshmi Pattu Weaving Centre").click()
        ap.get_by_role("button", name="Approve changes").click()
        expect(ap.locator("text=Changes approved")).to_be_visible()
    _()

    @step("Razorpay: order → payment → signature verify → Pro plan active")
    def _():
        tok = json.loads(sp.evaluate("localStorage.getItem('sb-localhost-auth-token')"))["access_token"]
        shop_id = re.search(r"shop=([0-9a-f-]{36})", sp.url) or None
        me = get(f"{MOCK}/rest/v1/rpc/me", "POST", {}, {"Authorization": f"Bearer {tok}"})[1]
        sid = me["shops"][0]["id"]
        st, order = get(f"{APP}/api/pay/order", "POST", {"shop_id": sid, "plan_code": "pro"}, {"Authorization": f"Bearer {tok}"})
        assert st == 200 and order["amount"] == 29900, (st, order)
        st, bad = get(f"{APP}/api/pay/verify", "POST", {"razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_x", "razorpay_signature": "deadbeef"}, {"Authorization": f"Bearer {tok}"})
        assert st == 400, (st, bad)
        _, paid = get(f"{MOCK}/__test/pay?order_id={order['order_id']}")
        st, ok = get(f"{APP}/api/pay/verify", "POST", {k: paid[k] for k in ("razorpay_order_id", "razorpay_payment_id", "razorpay_signature")}, {"Authorization": f"Bearer {tok}"})
        assert st == 200 and ok["ends_at"], (st, ok)
        sp.goto(APP + "/seller?tab=plan")
        expect(sp.locator("text=Active until")).to_be_visible(timeout=10000)
        expect(sp.locator("td", has_text="₹299")).to_be_visible()
        shot(sp, "09-billing-mobile")
        # Webhook for the same payment is a no-op (idempotent)
        body = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {"id": paid["razorpay_payment_id"], "order_id": order["order_id"]}}}})
        sig = get(f"{MOCK}/__test/webhook-signature", "POST", json.loads(body))[1]["signature"]
        req = urllib.request.Request(f"{APP}/api/pay/webhook", data=body.encode(), method="POST", headers={"Content-Type": "application/json", "x-razorpay-signature": sig})
        with urllib.request.urlopen(req) as r:
            assert r.status == 200
        req = urllib.request.Request(f"{APP}/api/pay/webhook", data=body.encode(), method="POST", headers={"Content-Type": "application/json", "x-razorpay-signature": "0" * 64})
        try:
            urllib.request.urlopen(req)
            raise AssertionError("bad webhook signature accepted")
        except urllib.error.HTTPError as e:
            assert e.code == 401
        pays = get(f"{MOCK}/rest/v1/rpc/my_shop", "POST", {"p_shop": sid}, {"Authorization": f"Bearer {tok}"})[1]["payments"]
        assert len([x for x in pays if x["status"] == "paid"]) == 1, pays
    _()

    @step("Payment API rejects someone else's shop")
    def _():
        buyer_tok = session("meena@example.com", "Meena Iyer")["access_token"]
        sid = get(f"{MOCK}/rest/v1/rpc/search_shops", "POST", {"p_q": "Lakshmi Pattu Weavers"})[1]["items"][0]["id"]
        st, res = get(f"{APP}/api/pay/order", "POST", {"shop_id": sid, "plan_code": "pro"}, {"Authorization": f"Bearer {buyer_tok}"})
        assert st == 400 and "Shop not found" in res["error"], (st, res)
        st, res = get(f"{APP}/api/pay/order", "POST", {"shop_id": sid, "plan_code": "pro"})
        assert st == 401
    _()

    @step("Seller dashboard overview shows leads")
    def _():
        sp.goto(APP + "/seller")
        expect(sp.locator("text=Page views")).to_be_visible(timeout=10000)
        shot(sp, "10-seller-overview-mobile")
    _()

    @step("Mobile map and home look right")
    def _():
        m = seller_ctx.new_page()
        m.goto(APP + "/")
        shot(m, "11-home-mobile")
        m.goto(APP + "/map?lat=14.4144&lng=77.7206&z=13")
        m.wait_for_timeout(2500)
        shot(m, "12-map-mobile", full=False)
        m.get_by_role("button", name=re.compile("List")).click()
        expect(m.locator("aside >> text=Sri Lakshmi Pattu Sarees")).to_be_visible()
        shot(m, "13-map-list-mobile", full=False)
    _()

    @step("Sell page, policies and sitemap")
    def _():
        page.goto(APP + "/sell")
        expect(page.locator("text=₹299").first).to_be_visible()
        shot(page, "14-sell")
        for path in ["/terms", "/privacy", "/refund-policy", "/shipping-policy", "/contact"]:
            page.goto(APP + path)
            expect(page.locator("h1")).to_be_visible()
        page.goto(APP + "/sitemap.xml?fresh=1")
        assert "/shops/lakshmi-pattu-weaving-centre-dharmavaram-" in page.content(), page.content()[:500]
    _()

    # ───────────── Custom saree requests ─────────────
    RZP_STUB = """window.Razorpay = function (o) {
      this.on = function () {};
      this.open = function () {
        fetch('%s/__test/pay?order_id=' + o.order_id).then(function (r) { return r.json(); }).then(function (r) { o.handler(r); });
      };
    };""" % MOCK
    for c in (ctx, seller_ctx):
        c.route("https://checkout.razorpay.com/**", lambda route: route.fulfill(status=200, content_type="application/javascript", body=RZP_STUB))

    def rpc(tok, fn, args=None):
        return get(f"{MOCK}/rest/v1/rpc/{fn}", "POST", args or {}, {"Authorization": f"Bearer {tok}"})

    @step("Custom request: signing in is required first")
    def _():
        anon = browser.new_context()
        a = anon.new_page()
        a.goto(APP + "/requests")
        expect(a.locator("h1")).to_contain_text("Nearby weavers will reply")
        shot(a, "20-requests-landing")
        a.get_by_role("link", name="Request a custom saree").first.click()
        a.wait_for_url(re.compile(r"/login\?next=%2Frequests%2Fnew"))
        anon.close()
    _()

    @step("Buyer sends a custom request: photo, saree type, colour, budget, current location")
    def _():
        page.goto(APP + "/requests/new")
        expect(page.get_by_test_id("quota")).to_contain_text("1 of 1 request left", timeout=10000)
        page.fill("#rq-title", "Maroon pure pattu with broad gold zari border")
        photo = os.path.abspath(os.path.join(SHOTS, "..", "ref.jpg"))
        make_photo(photo, "#5f1721")
        page.locator("input[type=file]").first.set_input_files(photo)
        expect(page.locator("img[src*='/requests/']")).to_have_count(1, timeout=15000)
        page.get_by_role("button", name="Pure Pattu", exact=True).first.click()
        page.get_by_role("button", name="Maroon", exact=True).click()
        page.get_by_role("button", name="₹8k–20k").click()
        page.fill("#rq-desc", "For my sister's wedding in January. Blouse needed.")
        page.get_by_role("button", name="📍 Use my current location").click()
        expect(page.get_by_test_id("place-label")).to_contain_text("Dharmavaram", timeout=10000)
        expect(page.get_by_test_id("reach")).to_contain_text("Will reach", timeout=10000)
        shot(page, "21-request-form")
        page.get_by_role("button", name="Send request to sellers").click()
        page.wait_for_url(re.compile(r"/account/requests\?id="), timeout=15000)
        expect(page.locator("text=Request sent ✓")).to_be_visible()
        expect(page.locator("text=₹8,000 – ₹20,000")).to_be_visible()
        page.wait_for_timeout(800)
        mails = get(f"{MOCK}/__test/mails")[1]
        to = {m["to"] for m in mails}
        assert "lakshmi.weaves@example.com" in to and "demo-seller@example.com" in to, mails  # nearby Pro shops
        shot(page, "22-request-sent")
    _()

    @step("Free allowance used → buyer buys a Request Pass with Razorpay")
    def _():
        page.goto(APP + "/requests/new")
        expect(page.locator("text=You've used your Free allowance")).to_be_visible(timeout=10000)
        shot(page, "23-buyer-plans")
        page.locator("[data-plan=buyer_pass]").get_by_role("button").click()
        expect(page.locator("text=Payment successful")).to_be_visible(timeout=15000)
        expect(page.get_by_test_id("quota")).to_contain_text("5 of 5 requests left")
        tok = json.loads(page.evaluate("localStorage.getItem('sb-localhost-auth-token')"))["access_token"]
        st, order = get(f"{APP}/api/pay/order", "POST", {"plan_code": "pro"}, {"Authorization": f"Bearer {tok}"})
        assert st == 400, (st, order)  # seller plans still need a shop
    _()

    @step("Pro seller is notified, opens the request and replies with photo and price")
    def _():
        sp.goto(APP + "/seller")
        expect(sp.get_by_test_id("bell")).to_have_attribute("aria-label", re.compile("unread"), timeout=10000)
        sp.get_by_test_id("bell").click()
        expect(sp.locator("text=New custom saree request near you").first).to_be_visible()
        sp.goto(APP + "/seller?tab=requests")
        card = sp.get_by_test_id("seller-request").first
        expect(card).to_contain_text("Maroon pure pattu", timeout=10000)
        card.get_by_role("button", name="Open & reply").click()
        expect(card.locator("text=For my sister's wedding")).to_be_visible()
        photo = os.path.abspath(os.path.join(SHOTS, "..", "reply.jpg"))
        make_photo(photo, "#7a1f2b")
        card.locator("input[type=file]").set_input_files(photo)
        expect(card.locator("img[src*='/replies/']")).to_have_count(1, timeout=15000)
        card.locator("textarea").fill("We have this exact border in pure Dharmavaram pattu. Blouse included, courier free.")
        card.get_by_label("Your price (₹)").fill("14500")
        card.get_by_label("Ready in (days)").fill("0")
        shot(sp, "24-seller-reply-mobile")
        card.get_by_role("button", name="Send reply").click()
        expect(sp.locator("text=Reply sent")).to_be_visible(timeout=10000)
        expect(card.locator("text=Your reply · Sent")).to_be_visible()
    _()

    @step("Buyer sees the reply, shortlists it and can WhatsApp the seller")
    def _():
        page.goto(APP + "/account/requests")
        expect(page.locator("text=1 new")).to_be_visible(timeout=10000)
        page.locator("button", has_text="Maroon pure pattu").click()
        reply = page.get_by_test_id("reply").first
        expect(reply).to_contain_text("₹14,500")
        expect(reply).to_contain_text("Ready now")
        wa = urllib.parse.unquote(reply.locator("a", has_text="WhatsApp").get_attribute("href"))
        assert "wa.me/91" in wa and "Maroon pure pattu" in wa, wa
        reply.get_by_role("button", name="☆ Shortlist").click()
        expect(reply.get_by_role("button", name="★ Shortlisted")).to_be_visible()
        shot(page, "25-buyer-replies")
    _()

    @step("Plan-based routing: Free shop waits for the head start, then gets 3 unlocks")
    def _():
        demo = session("demo-seller@example.com", "Ravi Kumar")["access_token"]
        me = rpc(demo, "me")[1]
        ravi = next(s for s in me["shops"] if s["name"] == "Ravi Handloom Weavers")["id"]
        lakshmi = next(s for s in me["shops"] if s["name"] == "Sri Lakshmi Pattu Sarees")["id"]
        mine = lambda items: [x for x in items if x["title"].startswith("Maroon pure pattu")]
        assert len(mine(rpc(demo, "seller_requests", {"p_shop": lakshmi})[1]["items"])) == 1
        free = rpc(demo, "seller_requests", {"p_shop": ravi})[1]
        assert free["status"]["quota"] == 3 and mine(free["items"]) == [], free
        # admin removes the head start from the Requests tab
        ap.goto(APP + "/admin?tab=requests")
        expect(ap.locator("text=Maroon pure pattu").first).to_be_visible(timeout=10000)
        ap.fill("#set-head_start_hours", "0")
        ap.get_by_role("button", name="Save rules").click()
        expect(ap.locator("text=Settings saved")).to_be_visible()
        free = rpc(demo, "seller_requests", {"p_shop": ravi})[1]
        assert len(mine(free["items"])) == 1 and "description" not in mine(free["items"])[0], free
        login(sp, session("demo-seller@example.com", "Ravi Kumar"))
        sp.goto(APP + f"/seller?shop={ravi}&tab=requests")
        expect(sp.get_by_test_id("lead-quota")).to_contain_text("of 3", timeout=10000)
        expect(sp.get_by_role("button", name=re.compile(r"Open & reply \(uses 1 of \d\)")).first).to_be_visible()
        shot(sp, "26-free-seller-requests-mobile")
    _()

    @step("Admin moderates requests and edits request allowances per plan")
    def _():
        ap.goto(APP + "/admin?tab=requests")
        ap.locator("button", has_text="Maroon pure pattu").click()
        expect(ap.get_by_role("dialog")).to_contain_text("We have this exact border")
        shot(ap, "27-admin-request")
        ap.get_by_role("button", name="Close", exact=True).first.click()
        ap.goto(APP + "/admin?tab=plans")
        row = ap.locator("[data-plan-row=free]")
        expect(row).to_contain_text("3/month")
        row.get_by_role("button", name="Edit").click()
        ap.fill("#pl-lead", "5")
        ap.get_by_role("button", name="Save plan").click()
        expect(ap.locator("[data-plan-row=free]")).to_contain_text("5/month", timeout=10000)
        expect(ap.locator("[data-plan-row=buyer_pass]")).to_contain_text("5 requests")
        shot(ap, "28-admin-plans")
        ap.locator("[data-plan-row=free]").get_by_role("button", name="Edit").click()
        ap.fill("#pl-lead", "3")
        ap.get_by_role("button", name="Save plan").click()
        expect(ap.locator("[data-plan-row=free]")).to_contain_text("3/month", timeout=10000)
    _()

    # ───────────── Real-world: reports, claims, admin listings, empty areas ─────────────
    @step("Buyer reports a wrong phone number; admin sees and resolves it")
    def _():
        page.goto(APP + "/shops/ravi-handloom-weavers-dharmavaram?fresh=1")
        page.get_by_role("button", name="Report a problem").scroll_into_view_if_needed()
        page.wait_for_timeout(1500)  # island hydrates when visible
        page.get_by_role("button", name="Report a problem").click()
        page.select_option("#rp-reason", "wrong_phone")
        page.get_by_label("Details").fill("Number says switched off for 3 days")
        page.get_by_role("button", name="Send").click()
        expect(page.locator("text=Thanks for telling us")).to_be_visible(timeout=10000)
        ap.goto(APP + "/admin?tab=reports")
        rep = ap.get_by_test_id("report").filter(has_text="Ravi Handloom Weavers")
        expect(rep).to_contain_text("Phone not working", timeout=10000)
        expect(rep).to_contain_text("switched off")
        shot(ap, "29-admin-reports")
        ap.once("dialog", lambda d: d.accept("Called seller, updated number"))
        rep.get_by_role("button", name="Resolved").click()
        expect(ap.locator("text=Marked resolved")).to_be_visible()
    _()

    @step("Admin lists a shop for launch; it shows 'Listed by Sarees Hub' and the owner gets it on sign-in")
    def _():
        ap.goto(APP + "/admin?tab=add")
        ap.fill("#add-owner", "venkat.sarees@example.com")
        ap.fill("#f-name", "Venkateswara Silk House")
        ap.fill("#f-phone", "+91 93930 12345")
        ap.get_by_role("button", name="📍 Use my current location").click()
        expect(ap.locator("text=✓ Pin set")).to_be_visible(timeout=15000)
        expect(ap.locator("#f-city")).to_have_value("Dharmavaram", timeout=8000)
        ap.locator("button.chip", has_text="Pure Pattu").first.click()
        shot(ap, "30-admin-add-shop")
        ap.get_by_role("button", name="Publish listing").click()
        expect(ap.locator("text=Shop listed")).to_be_visible(timeout=15000)
        shop = get(f"{MOCK}/rest/v1/rpc/search_shops", "POST", {"p_q": "Venkateswara Silk"})[1]["items"][0]
        page.goto(APP + f"/shops/{shop['slug']}?fresh=1")
        expect(page.locator("text=Listed by Sarees Hub").first).to_be_visible()
        expect(page.get_by_role("button", name="Own this shop? Claim it — free")).to_be_visible()
        shot(page, "31-listed-by-us")
        owner = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        op = owner.new_page()
        login(op, session("venkat.sarees@example.com", "Venkat Rao"))
        op.goto(APP + "/seller")
        expect(op.locator("h1", has_text="Venkateswara Silk House")).to_be_visible(timeout=10000)
        owner.close()
    _()

    @step("Owner claims an admin-listed shop from its page; admin verifies and hands it over")
    def _():
        tok = session("goodooruchowdappa@gmail.com", "Sai")["access_token"]
        r = get(f"{MOCK}/rest/v1/rpc/admin_create_shop", "POST", {"p": {"name": "Padmavathi Sarees", "kind": "shop", "phone": "9000044444", "city": "Dharmavaram", "lat": 14.41, "lng": 77.71, "photos": []}}, {"Authorization": f"Bearer {tok}"})[1]
        claimer = browser.new_context()
        cp = claimer.new_page()
        login(cp, session("padma.owner@example.com", "Padmavathi"))
        cp.goto(APP + f"/shops/{r['slug']}?fresh=1")
        cp.get_by_role("button", name="Own this shop? Claim it — free").scroll_into_view_if_needed()
        cp.wait_for_timeout(1500)
        cp.get_by_role("button", name="Own this shop? Claim it — free").click()
        cp.get_by_label("Details").fill("I am Padmavathi, the owner. Call the number on the page.")
        cp.get_by_role("button", name="Send").click()
        expect(cp.locator("text=call the shop's number")).to_be_visible(timeout=10000)
        ap.goto(APP + "/admin?tab=reports")
        rep = ap.get_by_test_id("report").filter(has_text="Padmavathi Sarees")
        expect(rep).to_contain_text("Owner wants to claim", timeout=10000)
        ap.once("dialog", lambda d: d.accept())
        rep.get_by_role("button", name="Verified — hand over").click()
        expect(ap.locator("text=Shop handed over")).to_be_visible()
        cp.goto(APP + "/seller")
        expect(cp.locator("h1", has_text="Padmavathi Sarees")).to_be_visible(timeout=10000)
        claimer.close()
    _()

    @step("Seller gets approval/review alerts in the bell")
    def _():
        demo = session("demo-seller@example.com", "Ravi Kumar")["access_token"]
        kinds = {n["kind"] for n in get(f"{MOCK}/rest/v1/rpc/my_notifications", "POST", {}, {"Authorization": f"Bearer {demo}"})[1]["items"]}
        assert "review_new" in kinds, kinds
        tok = json.loads(sp.evaluate("localStorage.getItem('sb-localhost-auth-token')"))["access_token"]
    _()

    @step("Empty town on the map shows the nearest shops instead of a dead end")
    def _():
        far = browser.new_context(viewport={"width": 1366, "height": 900})
        fp = far.new_page()
        fp.goto(APP + "/map?lat=28.6139&lng=77.2090&z=12")
        expect(fp.locator("text=No shops in this area yet")).to_be_visible(timeout=15000)
        expect(fp.get_by_test_id("nearest-shop").first).to_be_visible(timeout=10000)
        expect(fp.get_by_test_id("nearest-shop").first).to_contain_text("km")
        shot(fp, "32-map-empty-nearest", full=False)
        far.close()
    _()

    if errors:
        results.append(("No uncaught browser errors", "FAIL", " | ".join(errors)[:600]))
        print("FAIL  browser errors:", errors[:5])
    else:
        results.append(("No uncaught browser errors", "PASS", ""))
    browser.close()

json.dump(results, open(os.path.join(SHOTS, "..", "e2e-results.json"), "w"), indent=1)
failed = [r for r in results if r[1] == "FAIL"]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
