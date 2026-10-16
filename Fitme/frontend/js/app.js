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

const main = document.getElementById("main");
const nav = document.getElementById("site-nav");
const navToggle = document.querySelector(".nav-toggle");

route("/", renderLanding, { title: "Outfit analysis and styling" });
route("/login", renderLogin, { title: "Sign in" });
route("/register", renderRegister, { title: "Create account" });
route("/analyze", renderAnalyze, { auth: true, title: "Analyze an outfit" });
route("/analyses/:id", renderResult, { auth: true, title: "Analysis" });
route("/history", renderHistory, { auth: true, title: "History" });
route("/profile", renderProfile, { auth: true, title: "Profile" });

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
      link("/analyze", "Analyze"),
      link("/history", "History"),
      link("/profile", "Profile"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: handleLogout }, "Sign out"),
    );
  } else {
    nav.append(link("/login", "Sign in"), h("a", { class: "btn", href: "/register" }, "Create account"));
  }
}

async function handleLogout() {
  try {
    await session.logout();
  } catch {
    // Local session is cleared regardless; the cookie is cleared server-side on success.
  }
  toast("You're signed out.");
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
  main.append(loadingState("Loading…"));
  let view;
  try {
    view = await (matched ? matched.handler(ctx) : renderNotFound(ctx));
  } catch (error) {
    console.error(error);
    view = h(
      "div",
      { class: "center-state" },
      h("h1", { style: { fontSize: "var(--step-2)" } }, "This page couldn't load"),
      h("p", { class: "muted" }, error?.message || "Please try again."),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => render() }, "Try again"),
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
  toast("Your session expired. Please sign in again.", { error: true });
  navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
});

session.subscribe(() => renderNav());
onNavigate(render);

await session.restore();
startRouter();
