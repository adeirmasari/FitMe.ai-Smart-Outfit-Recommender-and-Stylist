import { onSessionExpired } from "./api.js";
import { clear, h, loadingState, toast } from "./dom.js";
import { match, navigate, onNavigate, route, startRouter } from "./router.js";
import * as session from "./session.js";
import { renderAnalyze } from "./views/analyze.js";
import { renderLogin, renderRegister } from "./views/auth.js";
import { renderHistory } from "./views/history.js";
import { renderLanding } from "./views/landing.js";
import { renderNotFound } from "./views/notfound.js";
import { renderProfile } from "./views/profile.js";
import { renderResult } from "./views/result.js";
import { renderWardrobe } from "./views/wardrobe.js";

const main = document.getElementById("main");
const nav = document.getElementById("site-nav");
const navToggle = document.querySelector(".nav-toggle");

route("/", renderLanding, { title: "Analisis pakaian dan penataan gaya" });
route("/login", renderLogin, { title: "Masuk" });
route("/register", renderRegister, { title: "Buat akun" });
route("/analyze", renderAnalyze, { auth: true, title: "Analisis pakaian" });
route("/analyses/:id", renderResult, { auth: true, title: "Hasil analisis" });
route("/history", renderHistory, { auth: true, title: "Riwayat" });
route("/profile", renderProfile, { auth: true, title: "Profil" });
route("/wardrobe", renderWardrobe, { auth: true, title: "Lemari Digital" });

let cleanups = [];
let renderSeq = 0;
let firstRender = true;

function runCleanups() {
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch (error) {
      console.error(error);
    }
  }
}

function renderNav() {
  clear(nav);
  const here = location.pathname;
  const link = (href, label) =>
    h("a", { href, "aria-current": here === href || (href === "/history" && here.startsWith("/analyses/")) ? "page" : null }, label);
  if (session.isAuthenticated()) {
      nav.append(
    link("/analyze", "Analisis"),
    link("/history", "Riwayat"),
    link("/wardrobe", "Lemari Digital"),
    link("/profile", "Profil"),
    h("button", { class: "btn btn-ghost", type: "button", onclick: handleLogout }, "Keluar"),
  );
  } else {
    nav.append(link("/login", "Masuk"), h("a", { class: "btn", href: "/register" }, "Buat akun"));
  }
}

async function handleLogout() {
  try {
    await session.logout();
  } catch {
    // Local session is cleared regardless; the cookie is cleared server-side on success.
  }
  toast("Kamu telah keluar.");
  navigate("/", { replace: true });
}

async function render() {
  const seq = ++renderSeq;
  runCleanups();
  nav.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
  renderNav();

  const matched = match(location.pathname);
  const params = new URLSearchParams(location.search);

  if (matched?.auth && !session.isAuthenticated()) {
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    return;
  }
  if ((location.pathname === "/login" || location.pathname === "/register") && session.isAuthenticated()) {
    navigate("/analyze", { replace: true });
    return;
  }

  document.title = `${matched?.title || "Not found"} — FitMe.ai`;
  const ctx = {
    params: matched?.params || {},
    query: params,
    state: history.state,
    navigate,
    onCleanup: (fn) => cleanups.push(fn),
    isCurrent: () => seq === renderSeq,
  };

  clear(main);
  main.append(loadingState("Memuat…"));
  let view;
  try {
    view = await (matched ? matched.handler(ctx) : renderNotFound(ctx));
  } catch (error) {
    console.error(error);
    view = h(
      "div",
      { class: "center-state" },
      h("h1", { style: { fontSize: "var(--step-2)" } }, "Halaman tidak dapat dimuat"),
      h("p", { class: "muted" }, error?.message || "Silakan coba lagi."),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => render() }, "Coba lagi"),
    );
  }
  if (seq !== renderSeq) return; // a newer navigation won
  clear(main);
  view.classList.add("view-enter");
  main.append(view);
  // Move focus to the new heading on in-app navigation (not on first load, so the skip link stays first).
  if (!firstRender) {
    const heading = main.querySelector("h1");
    (heading || main).setAttribute("tabindex", "-1");
    (heading || main).focus({ preventScroll: true });
  }
  firstRender = false;
  window.scrollTo(0, 0);
}

navToggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});

onSessionExpired(() => {
  if (!session.isAuthenticated()) return;
  session.expire();
  toast("Sesi berakhir. Silakan masuk kembali.", { error: true });
  navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
});

session.subscribe(() => renderNav());
onNavigate(render);

await session.restore();
startRouter();
