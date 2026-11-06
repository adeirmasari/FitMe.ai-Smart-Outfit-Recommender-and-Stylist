
import { fetchImageUrl, request, upload } from "../api.js";
import { clear, h, toast } from "../dom.js";

const API = "/api/wardrobe/";

const CATEGORIES = [
  ["top", "Top"],
  ["bottom", "Bottom"],
];

const CATEGORY_LABELS = { top: "Top", bottom: "Bottom" };

function el(tag, attrs = {}, ...children) {
  return h(tag, attrs, ...children);
}

function makeField(labelText, control) {
  return el("div", { class: "field" }, el("label", {}, labelText), control);
}

function categorySelect(value = "top") {
  return el(
    "select",
    { name: "category", required: true },
    ...CATEGORIES.map(([valueKey, label]) =>
      el("option", { value: valueKey, selected: valueKey === value }, label),
    ),
  );
}

function makeForm(item = null) {
  const name = el("input", {
    type: "text",
    name: "name",
    required: true,
    maxlength: 120,
    value: item?.name || "",
    placeholder: "Example: White shirt",
  });
  const category = categorySelect(item?.category || "top");
  const color = el("input", {
    type: "text",
    name: "color",
    maxlength: 80,
    value: item?.color || "",
    placeholder: "Example: White",
  });

  const form = el(
    "form",
    { class: "wardrobe-form" },
    makeField("Item name", name),
    makeField("Category", category),
    makeField("Color (optional)", color),
  );

  let image = null;
  let imageError = null;

  if (!item) {
    image = el("input", {
      type: "file",
      name: "image",
      accept: "image/jpeg,image/png,image/webp",
      required: true,
      "aria-describedby": "wardrobe-image-error",
    });
    imageError = el("div", {
      id: "wardrobe-image-error",
      class: "error-text",
      role: "alert",
      hidden: true,
    });
    form.append(makeField("Item photo", image), imageError);
    form.append(
      el(
        "p",
        { class: "muted small" },
        "Use a JPG, PNG, or WebP photo that clearly shows clothing. Photos that do not show clothing will be rejected.",
      ),
    );
    // Clear the rejection message when the user selects a replacement photo.
    image.addEventListener("change", () => {
      imageError.hidden = true;
      clear(imageError);
      image.removeAttribute("aria-invalid");
    });
  }

  return { form, name, category, color, image, imageError };
}

function dialogFor(item = null) {
  const dialog = el("dialog", { class: "wardrobe-dialog" });
  const heading = el("h2", {}, item ? "Edit item" : "Add an item");
  const { form, name, category, color, image, imageError } = makeForm(item);
  const cancel = el("button", { class: "btn btn-ghost", type: "button" }, "Cancel");
  const submit = el("button", { class: "btn", type: "submit" }, item ? "Save changes" : "Upload item");
  const actions = el("div", { class: "wardrobe-form-actions" }, cancel, submit);

  form.append(actions);
  dialog.append(heading, form);
  document.body.append(dialog);

  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());

  return { dialog, form, name, category, color, submit, image, imageError };
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export async function renderWardrobe(ctx) {
  const root = el("section", { class: "page shell wardrobe-page" });
  const header = el(
    "div",
    { class: "page-head" },
    el(
      "div",
      {},
      el("span", { class: "eyebrow" }, "Your collection"),
      el("h1", {}, "Digital Wardrobe"),
      el("p", {}, "Store and manage your clothing collection in one place."),
    ),
    el("button", { class: "btn", type: "button" }, "+ Add an item"),
  );

  const addButton = header.querySelector("button");
  const toolbar = el("div", { class: "wardrobe-toolbar" });
  const search = el("input", {
    type: "text",
    placeholder: "Search by item name or color…",
    "aria-label": "Search items",
  });
  const filter = el(
    "select",
    { "aria-label": "Filter by category" },
    el("option", { value: "" }, "All categories"),
    ...CATEGORIES.map(([value, label]) => el("option", { value }, label)),
  );
  const count = el("p", { class: "muted small", "aria-live": "polite" }, "Loading collection…");
  const grid = el("div", { class: "wardrobe-grid" });
  const status = el("div", { class: "center-state" }, "Loading wardrobe…");

  toolbar.append(search, filter);
  root.append(header, toolbar, count, status, grid);

  let items = [];
  let imageUrls = new Map();
  let disposed = false;
  let loading = false;

  const cleanup = () => {
    disposed = true;
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls.clear();
  };
  ctx.onCleanup(cleanup);

  async function loadImages() {
    for (const item of items) {
      if (disposed || imageUrls.has(item.id)) continue;
      try {
        const url = await fetchImageUrl(`${API}${item.id}/image/?variant=thumb`);
        if (disposed) {
          URL.revokeObjectURL(url);
          return;
        }
        imageUrls.set(item.id, url);
      } catch (error) {
        console.warn("Could not load wardrobe item photo:", item.id, error);
      }
    }
  }

  function renderGrid() {
    clear(grid);
    const query = search.value.trim().toLowerCase();
    const category = filter.value;
    const filtered = items.filter((item) => {
      const matchesText = `${item.name || ""} ${item.color || ""}`.toLowerCase().includes(query);
      return matchesText && (!category || item.category === category);
    });

    count.textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;
    if (!filtered.length) {
      grid.append(
        el(
          "div",
          { class: "wardrobe-empty" },
          el("h2", {}, items.length ? "No matching items" : "Your wardrobe is empty"),
          el(
            "p",
            { class: "muted" },
            items.length
              ? "Try another search term or category."
              : "Add your first clothing photo to start building your collection.",
          ),
        ),
      );
      return;
    }

    for (const item of filtered) {
      const image = el("div", { class: "wardrobe-card-image" });
      const url = imageUrls.get(item.id);
      if (url) {
        image.append(el("img", { src: url, alt: item.name || "Clothing item photo", loading: "lazy" }));
      } else {
        image.append(el("span", { class: "muted small" }, "Photo unavailable"));
      }

      const details = el(
        "div",
        { class: "wardrobe-card-details" },
        el("span", { class: "eyebrow" }, CATEGORY_LABELS[item.category] || item.category),
        el("h2", {}, item.name || "Unnamed item"),
        el("p", { class: "muted small" }, item.color || "Color not specified"),
        el(
          "p",
          { class: "muted small" },
          item.created_at ? `Added ${formatDate(item.created_at)}` : "",
        ),
      );

      const edit = el("button", { class: "btn btn-ghost", type: "button" }, "Edit");
      const remove = el("button", { class: "btn btn-danger", type: "button" }, "Delete");
      const actions = el("div", { class: "wardrobe-card-actions" }, edit, remove);
      const card = el("article", { class: "wardrobe-card" }, image, details, actions);

      edit.addEventListener("click", () => editItem(item));
      remove.addEventListener("click", () => deleteItem(item));
      grid.append(card);
    }
  }

  async function refresh() {
    if (loading || disposed) return;
    loading = true;
    status.hidden = false;
    grid.hidden = true;
    status.textContent = "Loading wardrobe…";

    try {
      const data = await request(API);
      if (disposed || !ctx.isCurrent()) return;
      items = Array.isArray(data) ? data : data?.results || [];
      await loadImages();
      if (disposed || !ctx.isCurrent()) return;
      status.hidden = true;
      grid.hidden = false;
      renderGrid();
    } catch (error) {
      if (disposed || !ctx.isCurrent()) return;
      status.textContent = "";
      clear(status);
      status.append(
        el("h2", {}, "Could not load wardrobe"),
        el("p", {}, error.message || "Please try again."),
        el("button", { class: "btn btn-ghost", type: "button" }, "Try again"),
      );
      status.querySelector("button").addEventListener("click", refresh);
    } finally {
      loading = false;
    }
  }

  async function addItem() {
    const { dialog, form, name, category, color, submit, image, imageError } = dialogFor();

    function showImageProblem(...lines) {
      clear(imageError);
      imageError.append(...lines.filter(Boolean));
      imageError.hidden = false;
      image.setAttribute("aria-invalid", "true");
      image.value = "";
      image.focus();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const file = form.elements.image.files?.[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("name", name.value.trim());
      formData.append("category", category.value);
      if (color.value.trim()) formData.append("color", color.value.trim());
      formData.append("image", file);

      submit.disabled = true;
      submit.textContent = "Checking photo…";
      try {
        await upload(API, formData);
        if (disposed) return;
        dialog.close();
        toast("Item added.");
        await refresh();
      } catch (error) {
        if (error.code === "image_not_clothing") {
          // Rejected before saving, so it is not added to the collection.
          const info = error.data?.error || {};
          showImageProblem(
            el("strong", { style: { display: "block" } }, error.message),
            info.reason ? el("span", { style: { display: "block" } }, `Reason: ${info.reason}`) : null,
            el(
              "span",
              { style: { display: "block" } },
              info.guidance || "Replace it with a photo that clearly shows clothing.",
            ),
          );
        } else if (error.fields?.image) {
          showImageProblem(el("span", {}, [].concat(error.fields.image).join(" ")));
        } else {
          toast(error.message || "Upload failed.", { error: true });
        }
      } finally {
        if (submit.isConnected) {
          submit.disabled = false;
          submit.textContent = "Upload item";
        }
      }
    });
    dialog.showModal();
  }

  async function editItem(item) {
    const { dialog, form, name, category, color, submit } = dialogFor(item);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      submit.disabled = true;
      try {
        await request(`${API}${item.id}/`, {
          method: "PATCH",
          body: {
            name: name.value.trim(),
            category: category.value,
            color: color.value.trim(),
          },
        });
        if (disposed) return;
        dialog.close();
        toast("Item updated.");
        await refresh();
      } catch (error) {
        toast(error.message || "Could not update item.", { error: true });
      } finally {
        if (submit.isConnected) submit.disabled = false;
      }
    });
    dialog.showModal();
  }

  async function deleteItem(item) {
    const confirmed = window.confirm(`Delete "${item.name || "this item"}" from your Digital Wardrobe?`);
    if (!confirmed) return;

    try {
      await request(`${API}${item.id}/`, { method: "DELETE" });
      const oldUrl = imageUrls.get(item.id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      imageUrls.delete(item.id);
      items = items.filter((entry) => entry.id !== item.id);
      renderGrid();
      toast("Item deleted.");
    } catch (error) {
      toast(error.message || "Could not delete item.", { error: true });
    }
  }

  addButton.addEventListener("click", addItem);
  search.addEventListener("input", renderGrid);
  filter.addEventListener("change", renderGrid);

  await refresh();
  return root;
}
