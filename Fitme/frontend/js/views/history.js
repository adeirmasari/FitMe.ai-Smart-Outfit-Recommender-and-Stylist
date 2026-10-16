import { fetchImageUrl, request } from "../api.js";
import { confirmDialog, formatDate, h, spinner, toast } from "../dom.js";

const STATUS_LABEL = { completed: "Completed", failed: "Failed", processing: "Processing", pending: "Pending" };

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
  const loadMoreBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Load more");
  const loadMore = h("div", { class: "load-more", hidden: true }, loadMoreBtn);
  const container = h("div", {});

  function emptyState() {
    return h(
      "div",
      { class: "center-state" },
      h("h2", {}, "No analyses yet"),
      h("p", { class: "muted" }, "Your analyzed outfits will appear here, newest first."),
      h("a", { class: "btn btn-accent", href: "/analyze" }, "Analyze your first outfit"),
    );
  }

  function updateCount() {
    countLine.textContent = total === 1 ? "1 analysis" : `${total} analyses`;
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

    const deleteBtn = h("button", { type: "button", class: "btn-link small", "aria-label": `Delete analysis from ${formatDate(item.created_at)}` }, "Delete");
    const li = h(
      "li",
      { class: "history-item" },
      thumb,
      h(
        "div",
        {},
        h("h2", {}, h("a", { href: `/analyses/${item.id}` }, item.occasion_label)),
        h(
          "p",
          { class: "when" },
          h("time", { datetime: item.created_at }, formatDate(item.created_at)),
          h("span", { class: `status status-${item.status}` }, STATUS_LABEL[item.status] || item.status),
          item.is_mock ? h("span", { class: "status status-pending" }, "Mock") : null,
        ),
        item.summary ? h("p", { class: "summary" }, item.summary) : item.error ? h("p", { class: "summary" }, item.error.message) : null,
      ),
      h("div", { class: "row-actions" }, deleteBtn),
    );

    deleteBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Delete this analysis?",
        body: "The photo and its recommendations will be permanently removed.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await request(`/api/analyses/${item.id}/`, { method: "DELETE" });
        li.remove();
        total -= 1;
        updateCount();
        toast("Analysis deleted.");
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
    loadMoreBtn.replaceChildren(spinner(), " Loading…");
    try {
      await loadPage();
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message, { error: true });
    } finally {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Load more";
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
        h("h2", {}, "History couldn't load"),
        h("p", { class: "muted" }, error.message),
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => ctx.navigate("/history", { replace: true }) }, "Try again"),
      ),
    );
  }

  return h(
    "div",
    { class: "page shell" },
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("p", { class: "eyebrow" }, "Archive"), h("h1", {}, "Your analyses"), countLine),
      h("a", { class: "btn", href: "/analyze" }, "New analysis"),
    ),
    container,
  );
}
