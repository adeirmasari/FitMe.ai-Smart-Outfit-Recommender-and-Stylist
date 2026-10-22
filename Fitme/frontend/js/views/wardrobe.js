
import { fetchImageUrl, request, upload } from "../api.js";
import { clear, h, toast } from "../dom.js";

const API = "/api/wardrobe/";

const CATEGORIES = [
  ["top", "Atasan"],
  ["bottom", "Bawahan"],
];

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
    placeholder: "Contoh: Kemeja putih",
  });
  const category = categorySelect(item?.category || "top");
  const color = el("input", {
    type: "text",
    name: "color",
    maxlength: 80,
    value: item?.color || "",
    placeholder: "Contoh: Putih",
  });

  const form = el(
    "form",
    { class: "wardrobe-form" },
    makeField("Nama pakaian", name),
    makeField("Kategori", category),
    makeField("Warna (opsional)", color),
  );

  if (!item) {
    const image = el("input", {
      type: "file",
      name: "image",
      accept: "image/jpeg,image/png,image/webp",
      required: true,
    });
    form.append(makeField("Foto pakaian", image));
    form.append(
      el(
        "p",
        { class: "muted small" },
        "Gunakan foto JPG, PNG, atau WebP. Batas ukuran mengikuti validasi backend.",
      ),
    );
  }

  return { form, name, category, color };
}

function dialogFor(item = null) {
  const dialog = el("dialog", { class: "wardrobe-dialog" });
  const heading = el("h2", {}, item ? "Edit pakaian" : "Tambah pakaian");
  const { form, name, category, color } = makeForm(item);
  const cancel = el("button", { class: "btn btn-ghost", type: "button" }, "Batal");
  const submit = el("button", { class: "btn", type: "submit" }, item ? "Simpan perubahan" : "Upload pakaian");
  const actions = el("div", { class: "wardrobe-form-actions" }, cancel, submit);

  form.append(actions);
  dialog.append(heading, form);
  document.body.append(dialog);

  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());

  return { dialog, form, name, category, color, submit };
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

export async function renderWardrobe(ctx) {
  const root = el("section", { class: "page shell wardrobe-page" });
  const header = el(
    "div",
    { class: "page-head" },
    el(
      "div",
      {},
      el("span", { class: "eyebrow" }, "Lemari digital"),
      el("h1", {}, "Digital Wardrobe"),
      el("p", {}, "Simpan dan kelola koleksi pakaianmu dalam satu tempat."),
    ),
    el("button", { class: "btn", type: "button" }, "+ Tambah pakaian"),
  );

  const addButton = header.querySelector("button");
  const toolbar = el("div", { class: "wardrobe-toolbar" });
  const search = el("input", {
    type: "text",
    placeholder: "Cari nama atau warna pakaian…",
    "aria-label": "Cari pakaian",
  });
  const filter = el(
    "select",
    { "aria-label": "Filter kategori" },
    el("option", { value: "" }, "Semua kategori"),
    ...CATEGORIES.map(([value, label]) => el("option", { value }, label)),
  );
  const count = el("p", { class: "muted small", "aria-live": "polite" }, "Memuat koleksi…");
  const grid = el("div", { class: "wardrobe-grid" });
  const status = el("div", { class: "center-state" }, "Memuat koleksi pakaian…");

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
        console.warn("Gagal memuat foto pakaian:", item.id, error);
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

    count.textContent = `${filtered.length} pakaian`;
    if (!filtered.length) {
      grid.append(
        el(
          "div",
          { class: "wardrobe-empty" },
          el("h2", {}, items.length ? "Tidak ada pakaian yang cocok" : "Lemari kamu masih kosong"),
          el(
            "p",
            { class: "muted" },
            items.length
              ? "Coba kata kunci atau kategori lain."
              : "Tambahkan foto pakaian pertamamu untuk mulai membangun koleksi.",
          ),
        ),
      );
      return;
    }

    for (const item of filtered) {
      const image = el("div", { class: "wardrobe-card-image" });
      const url = imageUrls.get(item.id);
      if (url) {
        image.append(el("img", { src: url, alt: item.name || "Foto pakaian", loading: "lazy" }));
      } else {
        image.append(el("span", { class: "muted small" }, "Foto tidak tersedia"));
      }

      const details = el(
        "div",
        { class: "wardrobe-card-details" },
        el("span", { class: "eyebrow" }, item.category_label || item.category),
        el("h2", {}, item.name || "Tanpa nama"),
        el("p", { class: "muted small" }, item.color || "Warna belum diisi"),
        el(
          "p",
          { class: "muted small" },
          item.created_at ? `Ditambahkan ${formatDate(item.created_at)}` : "",
        ),
      );

      const edit = el("button", { class: "btn btn-ghost", type: "button" }, "Edit");
      const remove = el("button", { class: "btn btn-danger", type: "button" }, "Hapus");
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
    status.textContent = "Memuat koleksi pakaian…";

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
        el("h2", {}, "Koleksi belum dapat dimuat"),
        el("p", {}, error.message || "Silakan coba lagi."),
        el("button", { class: "btn btn-ghost", type: "button" }, "Coba lagi"),
      );
      status.querySelector("button").addEventListener("click", refresh);
    } finally {
      loading = false;
    }
  }

  async function addItem() {
    const { dialog, form, name, category, color, submit } = dialogFor();
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
      submit.textContent = "Mengunggah…";
      try {
        await upload(API, formData);
        if (disposed) return;
        dialog.close();
        toast("Pakaian berhasil ditambahkan.");
        await refresh();
      } catch (error) {
        toast(error.message || "Upload gagal.", { error: true });
      } finally {
        if (submit.isConnected) {
          submit.disabled = false;
          submit.textContent = "Upload pakaian";
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
        toast("Informasi pakaian berhasil diperbarui.");
        await refresh();
      } catch (error) {
        toast(error.message || "Gagal memperbarui pakaian.", { error: true });
      } finally {
        if (submit.isConnected) submit.disabled = false;
      }
    });
    dialog.showModal();
  }

  async function deleteItem(item) {
    const confirmed = window.confirm(`Hapus "${item.name || "pakaian ini"}" dari Digital Wardrobe?`);
    if (!confirmed) return;

    try {
      await request(`${API}${item.id}/`, { method: "DELETE" });
      const oldUrl = imageUrls.get(item.id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      imageUrls.delete(item.id);
      items = items.filter((entry) => entry.id !== item.id);
      renderGrid();
      toast("Pakaian berhasil dihapus.");
    } catch (error) {
      toast(error.message || "Gagal menghapus pakaian.", { error: true });
    }
  }

  addButton.addEventListener("click", addItem);
  search.addEventListener("input", renderGrid);
  filter.addEventListener("change", renderGrid);

  await refresh();
  return root;
}
