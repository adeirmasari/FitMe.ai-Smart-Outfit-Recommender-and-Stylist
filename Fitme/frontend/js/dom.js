/**
 * Tiny element builder. All text goes through text nodes, so model output and
 * user content can never be interpreted as HTML.
 *
 *   h("p", { class: "lead", onclick: fn }, "Text", h("strong", {}, "bold"))
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
}

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function spinner() {
  return h("span", { class: "spinner", "aria-hidden": "true" });
}

/** Simple loading block used while a view fetches data. */
export function loadingState(label) {
  return h("div", { class: "center-state" }, h("span", { class: "loading-line" }, spinner(), label));
}

export function toast(message, { error = false, timeout = 4000 } = {}) {
  const region = document.querySelector(".toast-region");
  if (!region) return;
  const item = h("div", { class: `toast${error ? " error" : ""}` }, message);
  region.append(item);
  setTimeout(() => item.remove(), timeout);
}

/** Accessible confirm dialog built on <dialog>. Resolves true/false. */
export function confirmDialog({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const cancel = h("button", { class: "btn btn-ghost", type: "button", value: "cancel" }, "Cancel");
    const ok = h("button", { class: `btn ${danger ? "btn-accent" : ""}`, type: "button", value: "ok" }, confirmLabel);
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const dialog = h(
      "dialog",
      { "aria-labelledby": titleId },
      h("h2", { id: titleId }, title),
      h("p", { class: "muted" }, body),
      h("div", { class: "dialog-actions" }, cancel, ok),
    );
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
