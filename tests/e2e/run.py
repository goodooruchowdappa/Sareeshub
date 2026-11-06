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
        prices = [int(re.sub(r"[^\d]", "", t)) for t in page.locator("section[aria-label=Results] h3 + p span.font-semibold").all_text_contents() if re.search(r"\d", t)]
        assert prices == sorted(prices) and len(prices) > 3, f"prices {prices}"
        page.locator("section[aria-label=Results] a").first.click()
        page.wait_for_url(re.compile(r"/sarees/[^?/]+$"))
        ld = [json.loads(x) for x in page.locator('script[type="application/ld+json"]').all_text_contents()]
        prod = next(d for d in ld if d["@type"] == "Product")
        assert prod["offers"]["priceCurrency"] == "INR", prod
        wa = urllib.parse.unquote(page.locator("a[data-track=whatsapp]").get_attribute("href"))
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

    admin_ctx = browser.new_context(viewport={"width": 1366, "height": 900})
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
