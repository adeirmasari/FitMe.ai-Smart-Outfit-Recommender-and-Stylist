import { h, spinner } from "../dom.js";
import * as session from "../session.js";

function field({ id, label, type = "text", autocomplete, hint, required = true, maxlength, minlength }) {
  const input = h("input", { id, name: id, type, autocomplete, required, maxlength, minlength, "aria-describedby": `${id}-msg` });
  const msg = h("p", { id: `${id}-msg`, class: hint ? "hint" : "error-text" }, hint || "");
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), input, msg);
  return {
    wrap,
    input,
    setError(text) {
      input.setAttribute("aria-invalid", text ? "true" : "false");
      msg.className = text ? "error-text" : "hint";
      msg.textContent = text || hint || "";
    },
  };
}

function safeNext(query) {
  const next = query.get("next") || "/analyze";
  // Only same-site relative paths; blocks open redirects like //evil.example.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/analyze";
}

function shell(form) {
  return h(
    "div",
    { class: "auth" },
    h(
      "div",
      { class: "auth-aside", "aria-hidden": "true" },
      h("img", { src: "/static/assets/samples/0000320.jpg", alt: "", width: 512, height: 512 }),
    ),
    h("div", { class: "auth-panel" }, form),
  );
}

function bindSubmit(form, button, alert, fields, action, ctx) {
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    alert.hidden = true;
    Object.values(fields).forEach((f) => f.setError(""));
    if (!form.checkValidity()) {
      for (const f of Object.values(fields)) {
        if (!f.input.validity.valid) f.setError(f.input.validationMessage);
      }
      form.querySelector("[aria-invalid='true']")?.focus();
      return;
    }
    busy = true;
    const label = button.textContent;
    button.disabled = true;
    button.replaceChildren(spinner(), " Please wait…");
    try {
      await action();
      ctx.navigate(safeNext(ctx.query), { replace: true });
    } catch (error) {
      const fieldErrors = error.fields || {};
      let shown = false;
      for (const [key, f] of Object.entries(fields)) {
        if (fieldErrors[key]) {
          f.setError([].concat(fieldErrors[key]).join(" "));
          shown = true;
        }
      }
      if (!shown || fieldErrors.non_field_errors) {
        alert.textContent = error.message;
        alert.hidden = false;
      }
      form.querySelector("[aria-invalid='true']")?.focus();
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = label;
    }
  });
}

export function renderLogin(ctx) {
  const fields = {
    username: field({ id: "username", label: "Username or email", autocomplete: "username", maxlength: 254 }),
    password: field({ id: "password", label: "Password", type: "password", autocomplete: "current-password", maxlength: 128 }),
  };
  const alert = h("div", { class: "alert", role: "alert", hidden: true });
  const button = h("button", { class: "btn", type: "submit" }, "Sign in");
  const expired = ctx.query.get("next") && !session.isAuthenticated();
  const form = h(
    "form",
    { class: "auth-form", novalidate: true },
    h("div", {}, h("p", { class: "eyebrow" }, "Welcome back"), h("h1", {}, "Sign in")),
    expired ? h("p", { class: "alert alert-info" }, "Sign in to continue.") : null,
    alert,
    fields.username.wrap,
    fields.password.wrap,
    button,
    h("p", { class: "small muted" }, "New to FitMe.ai? ", h("a", { href: `/register${location.search}` }, "Create an account")),
  );
  bindSubmit(form, button, alert, fields, () => session.login(fields.username.input.value.trim(), fields.password.input.value), ctx);
  return shell(form);
}

export function renderRegister(ctx) {
  const fields = {
    username: field({
      id: "username",
      label: "Username",
      autocomplete: "username",
      hint: "3–30 letters, numbers, dots, dashes or underscores.",
      maxlength: 30,
      minlength: 3,
    }),
    email: field({ id: "email", label: "Email", type: "email", autocomplete: "email", maxlength: 254 }),
    password: field({
      id: "password",
      label: "Password",
      type: "password",
      autocomplete: "new-password",
      hint: "At least 8 characters. Avoid common or all-number passwords.",
      minlength: 8,
      maxlength: 128,
    }),
  };
  const alert = h("div", { class: "alert", role: "alert", hidden: true });
  const button = h("button", { class: "btn", type: "submit" }, "Create account");
  const form = h(
    "form",
    { class: "auth-form", novalidate: true },
    h("div", {}, h("p", { class: "eyebrow" }, "Get started"), h("h1", {}, "Create your account")),
    alert,
    fields.username.wrap,
    fields.email.wrap,
    fields.password.wrap,
    button,
    h("p", { class: "small muted" }, "Already have an account? ", h("a", { href: `/login${location.search}` }, "Sign in")),
  );
  bindSubmit(
    form,
    button,
    alert,
    fields,
    () => session.register(fields.username.input.value.trim(), fields.email.input.value.trim(), fields.password.input.value),
    ctx,
  );
  return shell(form);
}
