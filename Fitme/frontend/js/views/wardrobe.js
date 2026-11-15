import { fetchImageUrl, request, upload } from "../api.js";
import { clear, h, toast } from "../dom.js";

const API = "/api/wardrobe/";
// Proposal scope: the wardrobe interface exposes only Top and Bottom.
// "All items" remains available to show the complete saved collection.
const CATEGORIES = [
  ["all", "All items", "◫"],
  ["top", "Top", "▤"],
  ["bottom", "Bottom", "▥"],
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.filter(([key]) => key !== "all").map(([key, label]) => [key, label]));

function el(tag, attrs = {}, ...children) { return h(tag, attrs, ...children); }
function makeField(labelText, control) { return el("div", { class: "field" }, el("label", {}, labelText), control); }

function categorySelect(value = "top") {
  return el("select", { name: "category", required: true },
    ...CATEGORIES.filter(([key]) => key === "top" || key === "bottom").map(([key, label]) => el("option", { value: key, selected: key === value }, label)),
  );
}

function makeForm(item = null) {
  const name = el("input", { type: "text", name: "name", required: true, maxlength: 120, value: item?.name || "", placeholder: "Example: White shirt" });
  const category = categorySelect(item?.category || "top");
  const color = el("input", { type: "text", name: "color", maxlength: 80, value: item?.color || "", placeholder: "Example: White" });
  const form = el("form", { class: "wardrobe-form" }, makeField("Item name", name), makeField("Category", category), makeField("Color (optional)", color));
  let image = null;
  let imageError = null;
  if (!item) {
    image = el("input", { type: "file", name: "image", accept: "image/jpeg,image/png,image/webp", required: true, "aria-describedby": "wardrobe-image-error" });
    imageError = el("div", { id: "wardrobe-image-error", class: "error-text", role: "alert", hidden: true });
    form.append(makeField("Item photo", image), imageError,
      el("p", { class: "muted small" }, "Use a JPG, PNG, or WebP photo that clearly shows clothing. Photos that do not show clothing will be rejected."));
    image.addEventListener("change", () => { imageError.hidden = true; clear(imageError); image.removeAttribute("aria-invalid"); });
  }
  return { form, name, category, color, image, imageError };
}

function dialogFor(item = null) {
  const dialog = el("dialog", { class: "wardrobe-dialog" });
  const heading = el("h2", {}, item ? "Edit item" : "Add an item");
  const fields = makeForm(item);
  const cancel = el("button", { class: "btn btn-ghost", type: "button" }, "Cancel");
  const submit = el("button", { class: "btn btn-accent", type: "submit" }, item ? "Save changes" : "Upload item");
  fields.form.append(el("div", { class: "wardrobe-form-actions" }, cancel, submit));
  dialog.append(heading, fields.form);
  document.body.append(dialog);
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  return { dialog, ...fields, submit };
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export async function renderWardrobe(ctx) {
  const root = el("section", { class: "page shell wardrobe-page" });
  const heading = el("div", { class: "wardrobe-heading" },
    el("div", {}, el("span", { class: "eyebrow" }, "YOUR COLLECTION"), el("h1", {}, "Digital Wardrobe"), el("p", { class: "muted" }, "Organize your clothing collection and find your pieces easily.")),
    el("button", { class: "btn btn-accent wardrobe-add", type: "button" }, "+ Add an item"),
  );
  const addButton = heading.querySelector("button");
  const layout = el("div", { class: "wardrobe-layout" });
  const sidebar = el("aside", { class: "wardrobe-sidebar", "aria-label": "Wardrobe categories" });
  const sidebarTitle = el("div", { class: "wardrobe-sidebar-title" }, "CATEGORIES");
  const categoryNav = el("div", { class: "wardrobe-category-nav" });
  sidebar.append(sidebarTitle, categoryNav);

  const content = el("section", { class: "wardrobe-content" });
  const toolbar = el("div", { class: "wardrobe-toolbar" });
  const searchWrap = el("label", { class: "wardrobe-search" }, el("span", { "aria-hidden": "true" }, "⌕"));
  const search = el("input", { type: "search", placeholder: "Search items or colors...", "aria-label": "Search items or colors" });
  searchWrap.append(search);
  const sort = el("select", { class: "wardrobe-sort", "aria-label": "Sort items" },
    el("option", { value: "newest" }, "Recently added"), el("option", { value: "oldest" }, "Oldest first"), el("option", { value: "name" }, "Name A–Z"));
  const viewToggle = el("div", { class: "wardrobe-view-toggle", role: "group", "aria-label": "Display mode" });
  const gridMode = el("button", { type: "button", class: "is-active", "aria-label": "Grid view", title: "Grid view" }, "▦");
  const listMode = el("button", { type: "button", "aria-label": "List view", title: "List view" }, "☷");
  viewToggle.append(gridMode, listMode);
  toolbar.append(searchWrap, sort, viewToggle);

  const sectionHead = el("div", { class: "wardrobe-section-head" }, el("div", {}, el("h2", {}, "All items"), el("p", { class: "muted small", "aria-live": "polite" }, "Loading collection...")));
  const count = sectionHead.querySelector("p");
  const grid = el("div", { class: "wardrobe-grid" });
  const status = el("div", { class: "center-state" }, "Loading wardrobe...");
  content.append(toolbar, sectionHead, status, grid);
  layout.append(sidebar, content);
  root.append(heading, layout);

  let items = [];
  let imageUrls = new Map();
  let selectedCategory = "all";
  let viewMode = "grid";
  let disposed = false;
  let loading = false;

  const cleanup = () => {
    disposed = true;
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls.clear();
  };
  ctx.onCleanup(cleanup);

  async function loadImages() {
    await Promise.all(items.map(async (item) => {
      if (disposed || imageUrls.has(item.id)) return;
      try {
        const url = await fetchImageUrl(`${API}${item.id}/image/?variant=thumb`);
        if (disposed) URL.revokeObjectURL(url);
        else imageUrls.set(item.id, url);
      } catch (error) { console.warn("Could not load wardrobe item photo:", item.id, error); }
    }));
  }

  function openPreview(item) {
    const dialog = el("dialog", { class: "wardrobe-preview-dialog" });
    const close = el("button", { class: "wardrobe-preview-close", type: "button", "aria-label": "Close preview" }, "×");
    const url = imageUrls.get(item.id);
    const media = el("div", { class: "wardrobe-preview-media" }, url ? el("img", { src: url, alt: item.name || "Clothing item" }) : el("span", { class: "muted" }, "Photo unavailable"));
    const details = el("div", { class: "wardrobe-preview-details" },
      el("span", { class: "eyebrow" }, CATEGORY_LABELS[item.category] || item.category || "ITEM"),
      el("h2", {}, item.name || "Unnamed item"),
      el("p", { class: "muted" }, item.color || "Color not specified"),
      item.created_at ? el("p", { class: "muted small" }, `Added ${formatDate(item.created_at)}`) : null);
    const edit = el("button", { class: "btn btn-ghost", type: "button" }, "Edit item");
    const remove = el("button", { class: "btn btn-danger", type: "button" }, "Delete");
    details.append(el("div", { class: "wardrobe-preview-actions" }, edit, remove));
    dialog.append(close, media, details);
    document.body.append(dialog);
    close.addEventListener("click", () => dialog.close());
    edit.addEventListener("click", () => { dialog.close(); editItem(item); });
    remove.addEventListener("click", () => { dialog.close(); deleteItem(item); });
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  function renderCategories() {
    clear(categoryNav);
    for (const [key, label, icon] of CATEGORIES) {
      const amount = key === "all" ? items.length : items.filter((item) => item.category === key).length;
      const button = el("button", { type: "button", class: `wardrobe-category${selectedCategory === key ? " is-active" : ""}`, "aria-pressed": String(selectedCategory === key) },
        el("span", { class: "wardrobe-category-icon", "aria-hidden": "true" }, icon),
        el("span", { class: "wardrobe-category-name" }, label),
        el("span", { class: "wardrobe-category-count" }, amount));
      button.addEventListener("click", () => { selectedCategory = key; renderCategories(); renderGrid(); });
      categoryNav.append(button);
    }
  }

  function renderGrid() {
    clear(grid);
    const query = search.value.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const textMatch = `${item.name || ""} ${item.color || ""}`.toLowerCase().includes(query);
      return textMatch && (selectedCategory === "all" || item.category === selectedCategory);
    });
    filtered.sort((a, b) => {
      if (sort.value === "name") return (a.name || "").localeCompare(b.name || "");
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return sort.value === "oldest" ? dateA - dateB : dateB - dateA;
    });
    const activeLabel = CATEGORIES.find(([key]) => key === selectedCategory)?.[1] || "All items";
    sectionHead.querySelector("h2").textContent = activeLabel;
    count.textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;
    grid.classList.toggle("is-list", viewMode === "list");

    if (!filtered.length) {
      grid.append(el("div", { class: "wardrobe-empty" },
        el("span", { class: "wardrobe-empty-icon" }, "◇"),
        el("h3", {}, items.length ? "No matching items" : "Your wardrobe is empty"),
        el("p", { class: "muted" }, items.length ? "Try another search or category." : "Add your first clothing photo to start your collection."),
        !items.length ? el("button", { class: "btn btn-accent", type: "button", onclick: addItem }, "+ Add an item") : null));
      return;
    }

    for (const item of filtered) {
      const url = imageUrls.get(item.id);
      const image = el("div", { class: "wardrobe-card-image" }, url ? el("img", { src: url, alt: item.name || "Clothing item", loading: "lazy" }) : el("span", { class: "muted small" }, "No photo"));
      const details = el("div", { class: "wardrobe-card-details" },
        el("span", { class: "wardrobe-card-category" }, CATEGORY_LABELS[item.category] || item.category || "Other"),
        el("h3", {}, item.name || "Unnamed item"),
        el("p", { class: "muted small" }, item.color || "Color not specified"));
      const card = el("button", { type: "button", class: "wardrobe-card", "aria-label": `View ${item.name || "clothing item"}` }, image, details);
      card.addEventListener("click", () => openPreview(item));
      grid.append(card);
    }
  }

  async function refresh() {
    if (loading || disposed) return;
    loading = true;
    status.hidden = false;
    grid.hidden = true;
    status.textContent = "Loading wardrobe...";
    try {
      const data = await request(API);
      if (disposed || !ctx.isCurrent()) return;
      items = Array.isArray(data) ? data : data?.results || [];
      await loadImages();
      if (disposed || !ctx.isCurrent()) return;
      renderCategories();
      status.hidden = true;
      grid.hidden = false;
      renderGrid();
    } catch (error) {
      if (disposed || !ctx.isCurrent()) return;
      clear(status);
      status.append(el("h2", {}, "Could not load wardrobe"), el("p", {}, error.message || "Please try again."),
        el("button", { class: "btn btn-ghost", type: "button", onclick: refresh }, "Try again"));
    } finally { loading = false; }
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
      submit.textContent = "Checking photo...";
      try {
        await upload(API, formData);
        if (disposed) return;
        dialog.close();
        toast("Item added.");
        await refresh();
      } catch (error) {
        if (error.code === "image_not_clothing") {
          const info = error.data?.error || {};
          showImageProblem(el("strong", { style: { display: "block" } }, error.message),
            info.reason ? el("span", { style: { display: "block" } }, `Reason: ${info.reason}`) : null,
            el("span", { style: { display: "block" } }, info.guidance || "Replace it with a photo that clearly shows clothing."));
        } else if (error.fields?.image) showImageProblem(el("span", {}, [].concat(error.fields.image).join(" ")));
        else toast(error.message || "Upload failed.", { error: true });
      } finally {
        if (submit.isConnected) { submit.disabled = false; submit.textContent = "Upload item"; }
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
        await request(`${API}${item.id}/`, { method: "PATCH", body: { name: name.value.trim(), category: category.value, color: color.value.trim() } });
        if (disposed) return;
        dialog.close();
        toast("Item updated.");
        await refresh();
      } catch (error) { toast(error.message || "Could not update item.", { error: true }); }
      finally { if (submit.isConnected) submit.disabled = false; }
    });
    dialog.showModal();
  }

  async function deleteItem(item) {
    const dialog = el("dialog", {
      class: "wardrobe-confirm-dialog",
      "aria-labelledby": "wardrobe-delete-title",
      "aria-describedby": "wardrobe-delete-description",
    });
    const closeButton = el("button", {
      class: "wardrobe-confirm-close", type: "button", "aria-label": "Tutup konfirmasi",
    }, "×");
    const title = el("h2", { id: "wardrobe-delete-title" }, "Hapus pakaian?");
    const imageUrl = imageUrls.get(item.id);
    const image = el("div", { class: "wardrobe-confirm-image" },
      imageUrl ? el("img", { src: imageUrl, alt: item.name || "Foto pakaian" })
        : el("span", { class: "muted small" }, "Foto tidak tersedia"));
    const itemName = el("strong", { class: "wardrobe-confirm-item-name" }, item.name || "Pakaian");
    const itemMeta = el("p", { class: "wardrobe-confirm-item-meta" },
      `${CATEGORY_LABELS[item.category] || "Pakaian"}${item.color ? ` · ${item.color}` : ""}`);
    const description = el("p", {
      id: "wardrobe-delete-description", class: "wardrobe-confirm-description",
    }, "Apakah kamu yakin ingin menghapus pakaian ini dari Digital Wardrobe?");
    const note = el("p", { class: "wardrobe-confirm-note" },
      "Pakaian yang dihapus tidak akan muncul lagi dalam koleksimu.");
    const cancelButton = el("button", {
      class: "btn btn-ghost wardrobe-confirm-cancel", type: "button",
    }, "Batal");
    const deleteButton = el("button", {
      class: "btn btn-danger wardrobe-confirm-delete", type: "button",
    }, "Ya, Hapus");
    const actions = el("div", { class: "wardrobe-confirm-actions" }, cancelButton, deleteButton);
    dialog.append(closeButton, title, image, itemName, itemMeta, description, note, actions);
    document.body.append(dialog);

    const closeDialog = () => {
      if (dialog.open) dialog.close();
      else dialog.remove();
    };
    closeButton.addEventListener("click", closeDialog);
    cancelButton.addEventListener("click", closeDialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("close", () => dialog.remove());

    deleteButton.addEventListener("click", async () => {
      if (deleteButton.disabled) return;
      deleteButton.disabled = true;
      cancelButton.disabled = true;
      closeButton.disabled = true;
      deleteButton.textContent = "Menghapus...";
      try {
        await request(`${API}${item.id}/`, { method: "DELETE" });
        const oldUrl = imageUrls.get(item.id);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        imageUrls.delete(item.id);
        items = items.filter((entry) => entry.id !== item.id);
        renderCategories();
        renderGrid();
        closeDialog();
        toast("Pakaian berhasil dihapus dari Digital Wardrobe.");
      } catch (error) {
        deleteButton.disabled = false;
        cancelButton.disabled = false;
        closeButton.disabled = false;
        deleteButton.textContent = "Ya, Hapus";
        toast(error.message || "Pakaian tidak dapat dihapus.", { error: true });
      }
    });
    dialog.showModal();
  }

  addButton.addEventListener("click", addItem);
  search.addEventListener("input", renderGrid);
  sort.addEventListener("change", renderGrid);
  gridMode.addEventListener("click", () => { viewMode = "grid"; gridMode.classList.add("is-active"); listMode.classList.remove("is-active"); renderGrid(); });
  listMode.addEventListener("click", () => { viewMode = "list"; listMode.classList.add("is-active"); gridMode.classList.remove("is-active"); renderGrid(); });

  await refresh();
  return root;
}
