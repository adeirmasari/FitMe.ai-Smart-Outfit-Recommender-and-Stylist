"""Browser end-to-end checks for FitMe.ai.

Requires a running server (AI_PROVIDER=mock is fine) and Google Chrome or
Playwright's Chromium:

    python e2e/test_e2e.py --base http://127.0.0.1:8000 [--shots e2e/screenshots]
"""

import argparse
import re
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

PASSWORD = "Str0ng-pass-123"


def tiny_png(path):
    Image.new("RGB", (120, 120), (200, 30, 30)).save(path, format="PNG")


def no_horizontal_scroll(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def run(base, shots, headed):
    shots.mkdir(parents=True, exist_ok=True)
    stamp = str(int(time.time()))
    user_a, user_b = f"ana{stamp}", f"bo{stamp}"
    results = []

    def check(name, fn):
        try:
            fn()
            results.append((name, True, ""))
            print(f"PASS  {name}")
        except Exception as exc:  # noqa: BLE001
            results.append((name, False, str(exc).splitlines()[0][:300]))
            print(f"FAIL  {name}: {str(exc).splitlines()[0][:300]}")

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=not headed)
        except Exception:
            browser = p.chromium.launch(headless=not headed)

        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))
        state = {}

        def landing():
            page.goto(base + "/")
            expect(page.get_by_role("heading", level=1)).to_contain_text("Kenakan pakaian")
            expect(page.get_by_role("link", name="Buat akun", exact=True)).to_be_visible()
            page.screenshot(path=shots / "01-landing-desktop.png", full_page=True)

        def register():
            page.get_by_role("link", name="Analisis pakaian").first.click()
            expect(page).to_have_url(base + "/register")
            page.get_by_role("button", name="Buat akun").click()
            expect(page.locator("#username[aria-invalid=true]")).to_be_visible()
            page.fill("#username", user_a)
            page.fill("#email", f"{user_a}@example.com")
            page.fill("#password", "12345678")
            page.get_by_role("button", name="Buat akun").click()
            expect(page.locator("#password-msg")).to_contain_text("numeric")
            page.fill("#password", PASSWORD)
            page.get_by_role("button", name="Buat akun").click()
            expect(page).to_have_url(base + "/analyze")
            expect(page.get_by_role("button", name="Keluar")).to_be_visible()

        def analyze_validation():
            expect(page.get_by_text("Mode data uji aktif.")).to_be_visible()
            page.get_by_role("button", name="Buat rekomendasi").click()
            expect(page.locator("#photo-error")).to_contain_text("Pilih foto")
            expect(page.get_by_text("Pilih acara yang akan dihadiri.")).to_be_visible()
            small = shots / "_tiny.png"
            tiny_png(small)
            page.set_input_files("#photo", str(small))
            expect(page.locator("#photo-error")).to_contain_text("terlalu kecil")
            small.unlink()
            page.set_input_files("#photo", {"name": "notes.txt", "mimeType": "text/plain", "buffer": b"hello"})
            expect(page.locator("#photo-error")).to_contain_text("JPEG, PNG, atau WebP")

        def analyze_submit():
            page.locator(".samples button").first.click()
            expect(page.locator(".preview img")).to_be_visible()
            expect(page.locator(".file-meta")).to_contain_text("Contoh dataset")
            page.get_by_role("radio", name="Lainnya").check()
            expect(page.locator("#occasion_detail")).to_be_visible()
            page.get_by_role("radio", name="Kerja").check()
            expect(page.locator("#occasion_detail")).to_be_hidden()
            page.fill("#preferred_style", "minimal")
            page.screenshot(path=shots / "02-analyze-desktop.png", full_page=True)
            requests = []
            page.on("request", lambda r: requests.append(r.url) if r.method == "POST" and r.url.endswith("/api/analyses/") else None)
            failed_posts = {"count": 0}

            def fail_first_post(route):
                if route.request.method == "POST" and failed_posts["count"] == 0:
                    failed_posts["count"] += 1
                    route.abort()
                else:
                    route.continue_()

            page.route("**/api/analyses/", fail_first_post)
            # Two submits in the same tick must produce only one request.
            page.evaluate("() => { const f = document.querySelector('form.brief'); f.requestSubmit(); f.requestSubmit(); }")
            expect(page.locator(".form-alert")).to_be_visible()
            expect(page.locator(".form-alert")).to_contain_text("Koneksi ke server terputus")
            expect(page.get_by_role("button", name="Coba lagi")).to_be_visible()
            expect(page.get_by_role("button", name="Buat rekomendasi")).to_be_enabled()
            expect(page.locator(".preview img")).to_be_visible()
            assert len(requests) == 1, f"expected one failed POST, saw {len(requests)}"
            page.unroute("**/api/analyses/", fail_first_post)
            page.get_by_role("button", name="Coba lagi").click()
            expect(page).to_have_url(re.compile(r".*/analyses/[0-9a-f-]{36}$"), timeout=20000)
            state["result_url"] = page.url
            assert len(requests) == 2, f"expected one retry after a failed POST, saw {len(requests)}"

        def result_render():
            expect(page.get_by_role("heading", name="Hasil analisis pakaian")).to_be_visible()
            expect(page.locator(".source-badge.mock")).to_contain_text("bukan hasil AI")
            expect(page.get_by_text("Rekomendasi utama")).to_be_visible()
            expect(page.locator(".result-photo img")).to_be_visible()
            expect(page.locator(".swatches li").first).to_be_visible()
            page.screenshot(path=shots / "03-result-desktop.png", full_page=True)

        def refresh_keeps_session():
            page.reload()
            expect(page.get_by_role("heading", name="Hasil analisis pakaian")).to_be_visible()
            expect(page.get_by_role("button", name="Keluar")).to_be_visible()

        def expired_access_token_refreshes():
            calls = {"n": 0}

            def fake_401(route):
                calls["n"] += 1
                if calls["n"] == 1:
                    route.fulfill(status=401, content_type="application/json", body='{"error":{"code":"token_not_valid","message":"expired"}}')
                else:
                    route.continue_()

            page.route("**/api/analyses/?*", fake_401)
            page.route("**/api/analyses/", fake_401)
            page.get_by_role("link", name="Riwayat", exact=True).first.click()
            expect(page.locator(".history-item")).to_have_count(1)
            assert calls["n"] >= 2, "request was not retried after refresh"
            page.unroute("**/api/analyses/?*")
            page.unroute("**/api/analyses/")
            page.screenshot(path=shots / "04-history-desktop.png", full_page=True)

        def history_to_detail():
            page.locator(".history-item h2 a").first.click()
            expect(page).to_have_url(state["result_url"])

        def cross_user_blocked():
            other = browser.new_context()
            p2 = other.new_page()
            p2.goto(base + "/register")
            p2.fill("#username", user_b)
            p2.fill("#email", f"{user_b}@example.com")
            p2.fill("#password", PASSWORD)
            p2.get_by_role("button", name="Buat akun").click()
            expect(p2).to_have_url(base + "/analyze")
            p2.goto(state["result_url"])
            expect(p2.get_by_role("heading", name="Analisis tidak ditemukan")).to_be_visible()
            p2.goto(base + "/history")
            expect(p2.get_by_role("heading", name="Belum ada analisis")).to_be_visible()
            other.close()

        def profile_edit():
            page.get_by_role("link", name="Profil").click()
            page.fill("#display_name", "Ana Stylist")
            page.fill("#style_notes", "Neutral palette, no heels")
            page.get_by_role("button", name="Simpan perubahan").click()
            expect(page.locator(".toast")).to_contain_text("Profil berhasil disimpan")
            page.fill("#email", "broken")
            page.get_by_role("button", name="Simpan perubahan").click()
            expect(page.locator("#email-msg")).to_contain_text("email yang valid")
            page.goto(base + "/analyze")
            expect(page.locator("#additional_context")).to_have_value("Neutral palette, no heels")

        def wardrobe_flow():
            page.goto(base + "/wardrobe")
            expect(page.get_by_role("heading", name="Lemari Digital")).to_be_visible()
            page.get_by_role("button", name="+ Tambah pakaian").click()
            dialog = page.get_by_role("dialog")
            dialog.locator("input[name=name]").fill("Kemeja putih")
            dialog.locator("select[name=category]").select_option("top")
            photo = Path(__file__).resolve().parents[1] / "frontend" / "assets" / "samples" / "0000080.jpg"
            dialog.locator("input[name=image]").set_input_files(str(photo))
            dialog.get_by_role("button", name="Unggah pakaian").click()
            expect(page.locator(".wardrobe-card h2")).to_contain_text("Kemeja putih")

            page.locator(".wardrobe-card").get_by_role("button", name="Edit").click()
            dialog = page.get_by_role("dialog")
            dialog.locator("input[name=name]").fill("Kemeja putih uji")
            dialog.get_by_role("button", name="Simpan perubahan").click()
            expect(page.locator(".wardrobe-card h2")).to_contain_text("Kemeja putih uji")

            page.once("dialog", lambda prompt: prompt.accept())
            page.locator(".wardrobe-card").get_by_role("button", name="Hapus").click()
            expect(page.get_by_role("heading", name="Lemari kamu masih kosong")).to_be_visible()

        def delete_flow():
            page.goto(base + "/history")
            page.get_by_role("button", name=re.compile("Hapus analisis")).first.click()
            page.get_by_role("dialog").get_by_role("button", name="Batal").click()
            expect(page.locator(".history-item")).to_have_count(1)
            page.get_by_role("button", name=re.compile("Hapus analisis")).first.click()
            page.get_by_role("dialog").get_by_role("button", name="Hapus").click()
            expect(page.get_by_role("heading", name="Belum ada analisis")).to_be_visible()

        def logout_and_guard():
            page.get_by_role("button", name="Keluar").click()
            expect(page).to_have_url(base + "/")
            page.goto(base + "/history")
            expect(page).to_have_url(re.compile(r".*/login\?next=%2Fhistory$"))

        def login_flow():
            page.fill("#username", user_a)
            page.fill("#password", "wrong-password-9")
            page.get_by_role("button", name="Masuk").click()
            expect(page.get_by_role("alert")).to_contain_text("Incorrect")
            page.fill("#password", PASSWORD)
            page.get_by_role("button", name="Masuk").click()
            expect(page).to_have_url(base + "/history")

        def mobile():
            m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
            mp = m.new_page()
            mp.goto(base + "/")
            assert no_horizontal_scroll(mp), "landing scrolls horizontally"
            mp.screenshot(path=shots / "05-landing-mobile.png", full_page=True)
            mp.get_by_role("button", name="Menu").click()
            expect(mp.locator("#site-nav").get_by_role("link", name="Masuk")).to_be_visible()
            mp.locator("#site-nav").get_by_role("link", name="Masuk").click()
            mp.fill("#username", user_a)
            mp.fill("#password", PASSWORD)
            mp.get_by_role("button", name="Masuk").click()
            expect(mp).to_have_url(base + "/analyze")
            expect(mp.get_by_role("button", name="Ambil foto")).to_be_visible()
            assert no_horizontal_scroll(mp), "analyze scrolls horizontally"
            mp.locator(".samples button").nth(2).click()
            mp.get_by_role("radio", name="Pesta").check()
            mp.screenshot(path=shots / "06-analyze-mobile.png", full_page=True)
            mp.get_by_role("button", name="Buat rekomendasi").click()
            expect(mp.get_by_role("heading", name="Hasil analisis pakaian")).to_be_visible(timeout=20000)
            assert no_horizontal_scroll(mp), "result scrolls horizontally"
            mp.screenshot(path=shots / "07-result-mobile.png", full_page=True)
            mp.goto(base + "/history")
            expect(mp.locator(".history-item")).to_have_count(1)
            assert no_horizontal_scroll(mp), "history scrolls horizontally"
            mp.screenshot(path=shots / "08-history-mobile.png", full_page=True)
            m.close()

        def keyboard_focus():
            page.goto(base + "/")
            page.keyboard.press("Tab")
            expect(page.locator(".skip-link")).to_be_focused()

        for name, fn in [
            ("landing page", landing),
            ("registration + validation", register),
            ("analyze validation (empty, tiny, wrong type)", analyze_validation),
            ("analyze submit, single request", analyze_submit),
            ("result rendering", result_render),
            ("refresh keeps session (HttpOnly refresh cookie)", refresh_keeps_session),
            ("expired access token is refreshed and retried", expired_access_token_refreshes),
            ("history -> detail navigation", history_to_detail),
            ("cross-user access blocked in UI", cross_user_blocked),
            ("profile edit + validation + prefill", profile_edit),
            ("Digital Wardrobe create, edit, and delete", wardrobe_flow),
            ("delete with confirmation", delete_flow),
            ("logout + auth guard", logout_and_guard),
            ("login errors + redirect to next", login_flow),
            ("mobile layouts (390px) + camera button", mobile),
            ("keyboard skip link", keyboard_focus),
        ]:
            check(name, fn)

        relevant = [e for e in console_errors if "401" not in e and "Failed to load resource" not in e]
        results.append(("no uncaught JS errors", not relevant, "; ".join(relevant)[:300]))
        print(("PASS" if not relevant else "FAIL") + "  no uncaught JS errors" + ("" if not relevant else f": {relevant[:3]}"))
        browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--shots", default=str(Path(__file__).parent / "screenshots"))
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    sys.exit(run(args.base.rstrip("/"), Path(args.shots), args.headed))
