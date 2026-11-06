import { fetchImageUrl, request } from "../api.js";
import { confirmDialog, formatDate, h, spinner, toast } from "../dom.js";

const STATUS_LABEL = { completed: "Selesai", failed: "Gagal", processing: "Diproses", pending: "Menunggu" };
const OCCASION_LABEL = {
  casual: "Kasual",
  campus: "Kampus",
  work: "Kerja",
  formal: "Acara formal",
  party: "Pesta",
};

function occasionLabel(item) {
  if (item.occasion === "other") {
    return `Lainnya${item.occasion_label?.startsWith("Other:") ? `: ${item.occasion_label.slice(6).trimStart()}` : ""}`;
  }
  return OCCASION_LABEL[item.occasion] || item.occasion_label;
}

export async function renderHistory(ctx) {
  const objectUrls = [];
  const controller = new AbortController();
  ctx.onCleanup(() => {
    controller.abort();
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
  });

  let nextUrl = "/api/analyses/";
  let total = 0;
  const list = h("ul", { class: "history-list" });
  const countLine = h("p", {});
  const loadMoreBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Muat lainnya");
  const loadMore = h("div", { class: "load-more", hidden: true }, loadMoreBtn);
  const container = h("div", {});

  function emptyState() {
    return h(
      "div",
      { class: "center-state" },
      h("h2", {}, "Belum ada analisis"),
      h("p", { class: "muted" }, "Hasil analisis pakaianmu akan muncul di sini, mulai dari yang terbaru."),
      h("a", { class: "btn btn-accent", href: "/analyze" }, "Analisis pakaian pertama"),
    );
  }

  function updateCount() {
    countLine.textContent = `${total} analisis`;
    if (total === 0) container.replaceChildren(emptyState());
  }

  function row(item) {
    const thumb = h("div", { class: "thumb" }, spinner());
    fetchImageUrl(item.thumbnail_url, { signal: controller.signal })
      .then((url) => {
        objectUrls.push(url);
        thumb.replaceChildren(h("img", { src: url, alt: "", loading: "lazy" }));
      })
      .catch((e) => {
        if (e.name !== "AbortError") thumb.replaceChildren(h("span", { class: "small muted" }, "—"));
      });

    const deleteBtn = h("button", { type: "button", class: "btn-link small", "aria-label": `Hapus analisis tanggal ${formatDate(item.created_at)}` }, "Hapus");
    const li = h(
      "li",
      { class: "history-item" },
      thumb,
      h(
        "div",
        {},
        h("h2", {}, h("a", { href: `/analyses/${item.id}` }, occasionLabel(item))),
        h(
          "p",
          { class: "when" },
          h("time", { datetime: item.created_at }, formatDate(item.created_at)),
          h("span", { class: `status status-${item.status}` }, STATUS_LABEL[item.status] || item.status),
          item.is_mock ? h("span", { class: "status status-pending" }, "Data uji") : null,
        ),
        item.summary ? h("p", { class: "summary" }, item.summary) : item.error ? h("p", { class: "summary" }, item.error.message) : null,
      ),
      h("div", { class: "row-actions" }, deleteBtn),
    );

    deleteBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Hapus analisis ini?",
        body: "Foto dan rekomendasinya akan dihapus secara permanen.",
        confirmLabel: "Hapus",
        danger: true,
      });
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await request(`/api/analyses/${item.id}/`, { method: "DELETE" });
        li.remove();
        total -= 1;
        updateCount();
        toast("Analisis berhasil dihapus.");
        (list.querySelector("a") || ctx.isCurrent() && document.querySelector("main h1"))?.focus();
      } catch (error) {
        deleteBtn.disabled = false;
        toast(error.message, { error: true });
      }
    });
    return li;
  }

  async function loadPage() {
    const url = new URL(nextUrl, location.origin);
    const page = await request(url.pathname + url.search, { signal: controller.signal });
    total = page.count;
    nextUrl = page.next;
    page.results.forEach((item) => list.append(row(item)));
    loadMore.hidden = !nextUrl;
    updateCount();
  }

  loadMoreBtn.addEventListener("click", async () => {
    loadMoreBtn.disabled = true;
    loadMoreBtn.replaceChildren(spinner(), " Memuat…");
    try {
      await loadPage();
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message, { error: true });
    } finally {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Muat lainnya";
    }
  });

  container.append(list, loadMore);
  try {
    await loadPage();
  } catch (error) {
    container.replaceChildren(
      h(
        "div",
        { class: "center-state" },
        h("h2", {}, "Riwayat tidak dapat dimuat"),
        h("p", { class: "muted" }, error.message),
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => ctx.navigate("/history", { replace: true }) }, "Coba lagi"),
      ),
    );
  }

  return h(
    "div",
    { class: "page shell" },
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("p", { class: "eyebrow" }, "Arsip"), h("h1", {}, "Riwayat analisis"), countLine),
      h("a", { class: "btn", href: "/analyze" }, "Analisis baru"),
    ),
    container,
  );
}
