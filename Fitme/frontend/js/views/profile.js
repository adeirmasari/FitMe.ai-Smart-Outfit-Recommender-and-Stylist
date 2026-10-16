import { request } from "../api.js";
import { formatDate, h, spinner, toast } from "../dom.js";
import * as session from "../session.js";

function field(id, label, { type = "text", maxlength, value = "", hint = "", multiline = false, autocomplete } = {}) {
  const control = multiline
    ? h("textarea", { id, name: id, maxlength, rows: 4, "aria-describedby": `${id}-msg` })
    : h("input", { id, name: id, type, maxlength, autocomplete, "aria-describedby": `${id}-msg` });
  control.value = value || "";
  const msg = h("p", { id: `${id}-msg`, class: "hint" }, hint);
  return {
    wrap: h("div", { class: "field" }, h("label", { for: id }, label), control, msg),
    control,
    setError(text) {
      msg.className = text ? "error-text" : "hint";
      msg.textContent = text || hint;
      control.setAttribute("aria-invalid", text ? "true" : "false");
    },
  };
}

export async function renderProfile(ctx) {
  const profile = await request("/api/profile/");
  session.setProfile(profile);

  const fields = {
    display_name: field("display_name", "Display name", { maxlength: 60, value: profile.display_name, autocomplete: "nickname" }),
    email: field("email", "Email", { type: "email", maxlength: 254, value: profile.email, autocomplete: "email" }),
    style_notes: field("style_notes", "Style notes", {
      maxlength: 300,
      value: profile.style_notes,
      multiline: true,
      hint: "Pre-fills the “Anything else?” field for new analyses. Up to 300 characters.",
    }),
  };
  const saveBtn = h("button", { class: "btn", type: "submit" }, "Save changes");
  const alert = h("div", { class: "alert", role: "alert", hidden: true });
  const form = h(
    "form",
    { novalidate: true, "aria-labelledby": "edit-heading" },
    h("h2", { id: "edit-heading", style: { fontSize: "var(--step-2)" } }, "Edit profile"),
    alert,
    fields.display_name.wrap,
    fields.email.wrap,
    fields.style_notes.wrap,
    h("div", { class: "form-actions" }, saveBtn),
  );

  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    alert.hidden = true;
    Object.values(fields).forEach((f) => f.setError(""));
    const email = fields.email.control;
    if (!email.value.trim() || !email.checkValidity()) {
      fields.email.setError("Enter a valid email address.");
      email.focus();
      return;
    }
    busy = true;
    saveBtn.disabled = true;
    saveBtn.replaceChildren(spinner(), " Saving…");
    try {
      const updated = await request("/api/profile/", {
        method: "PATCH",
        body: {
          display_name: fields.display_name.control.value,
          email: email.value.trim(),
          style_notes: fields.style_notes.control.value,
        },
      });
      session.setProfile(updated);
      fields.display_name.control.value = updated.display_name;
      fields.style_notes.control.value = updated.style_notes;
      toast("Profile saved.");
    } catch (error) {
      let shown = false;
      for (const [key, f] of Object.entries(fields)) {
        if (error.fields?.[key]) {
          f.setError([].concat(error.fields[key]).join(" "));
          shown = true;
        }
      }
      if (!shown) {
        alert.textContent = error.message;
        alert.hidden = false;
      }
    } finally {
      busy = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save changes";
    }
  });

  const logoutBtn = h("button", { class: "btn btn-ghost", type: "button" }, "Sign out");
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      await session.logout();
    } catch {
      /* local session already cleared */
    }
    toast("You're signed out.");
    ctx.navigate("/", { replace: true });
  });

  return h(
    "div",
    { class: "page shell" },
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("p", { class: "eyebrow" }, "Account"), h("h1", {}, profile.display_name || profile.username)),
      h("a", { class: "btn btn-accent", href: "/analyze" }, "Back to workspace"),
    ),
    h(
      "div",
      { class: "profile" },
      h(
        "div",
        { style: { display: "grid", gap: "var(--space-6)", alignContent: "start" } },
        h(
          "dl",
          {},
          h("div", {}, h("dt", {}, "Username"), h("dd", {}, profile.username)),
          h("div", {}, h("dt", {}, "Member since"), h("dd", {}, formatDate(profile.date_joined))),
          h("div", {}, h("dt", {}, "Analyses"), h("dd", {}, h("a", { href: "/history" }, String(profile.analysis_count)))),
        ),
        h("div", {}, logoutBtn),
      ),
      form,
    ),
  );
}
