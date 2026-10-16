/** History-API router. Django serves index.html for every non-API path, so
 *  deep links and refreshes land on the right view. */

const routes = [];
let renderFn = () => {};

export function route(pattern, handler, { auth = false, title = "" } = {}) {
  const keys = [];
  const regex = new RegExp(
    "^" +
      pattern.replace(/\/:([a-z]+)/gi, (_, key) => {
        keys.push(key);
        return "/([^/]+)";
      }) +
      "/?$",
  );
  routes.push({ regex, keys, handler, auth, title });
}

export function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.regex);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { ...r, params };
    }
  }
  return null;
}

export function onNavigate(fn) {
  renderFn = fn;
}

export function navigate(to, { replace = false, state = null } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) {
    location.href = to;
    return;
  }
  if (replace) history.replaceState(state, "", url.pathname + url.search);
  else history.pushState(state, "", url.pathname + url.search);
  renderFn();
}

export function startRouter() {
  window.addEventListener("popstate", () => renderFn());
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) return;
    event.preventDefault();
    navigate(url.pathname + url.search);
  });
  renderFn();
}
