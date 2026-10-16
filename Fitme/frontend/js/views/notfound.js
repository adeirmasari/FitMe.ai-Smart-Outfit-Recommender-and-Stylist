import { h } from "../dom.js";

export function renderNotFound() {
  return h(
    "div",
    { class: "center-state" },
    h("p", { class: "eyebrow" }, "404"),
    h("h1", { style: { fontSize: "var(--step-3)" } }, "This page doesn't exist"),
    h("a", { class: "btn btn-ghost", href: "/" }, "Back to FitMe.ai"),
  );
}
