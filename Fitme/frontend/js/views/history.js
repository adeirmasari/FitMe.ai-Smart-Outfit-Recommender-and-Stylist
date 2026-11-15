import { fetchImageUrl, request } from "../api.js";
import { confirmDialog, formatDate, h, spinner, toast } from "../dom.js";

const STATUS_LABEL = {
  completed: "Completed",
  failed: "Failed",
  processing: "Processing",
  pending: "Pending",
};

const OCCASION_LABEL = {
  casual: "Casual",
  campus: "Campus",
  work: "Work",
  formal: "Formal Event",
  party: "Party",
};

function occasionLabel(item) {
  if (item.occasion === "other") {
    const extra = item.occasion_label?.startsWith("Other:")
      ? item.occasion_label.slice(6).trimStart()
      : "";
    return extra ? `Other: ${extra}` : "Other";
  }
  return OCCASION_LABEL[item.occasion] || item.occasion_label || "Outfit Analysis";
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || "Unknown";
}

export async function renderHistory(ctx) {
  const objectUrls = [];
  const controller = new AbortController();

  ctx.onCleanup(() => {
    controller.abort();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  });

  let nextUrl = "/api/analyses/";
  let total = 0;
  let isLoading = false;
  const records = [];

  const countLine = h("p", { class: "history-subtitle" });
  const totalStat = h("strong", { class: "history-stat-value" }, "0");
  const loadedStat = h("strong", { class: "history-stat-value" }, "0");
  const completedStat = h("strong", { class: "history-stat-value" }, "0");

  const searchInput = h("input", {
    class: "history-search-input",
    type: "search",
    placeholder: "Search occasion, summary, or status...",
    "aria-label": "Search analysis history",
  });

  const statusFilter = h(
    "select",
    { class: "history-select", "aria-label": "Filter by status" },
    h("option", { value: "all" }, "All statuses"),
    h("option", { value: "completed" }, "Completed"),
    h("option", { value: "processing" }, "Processing"),
    h("option", { value: "pending" }, "Pending"),
    h("option", { value: "failed" }, "Failed"),
  );

  const sortSelect = h(
    "select",
    { class: "history-select", "aria-label": "Sort history" },
    h("option", { value: "newest" }, "Newest first"),
    h("option", { value: "oldest" }, "Oldest first"),
  );

  const list = h("ul", { class: "history-list" });
  const emptyStateContainer = h("div", { class: "history-empty-container", hidden: true });
  const resultInfo = h("p", { class: "history-result-info" });
  const loadMoreBtn = h("button", { type: "button", class: "btn btn-ghost history-load-btn" }, "Load More");
  const loadMore = h("div", { class: "load-more", hidden: true }, loadMoreBtn);
  const container = h("div", { class: "history-content" });

  function updateStatistics() {
    const completedCount = records.filter(({ item }) => item.status === "completed").length;
    totalStat.textContent = String(total);
    loadedStat.textContent = String(records.length);
    completedStat.textContent = String(completedCount);
    countLine.textContent = `${total} ${total === 1 ? "analysis" : "analyses"} in your history`;
  }

  function createEmptyState(isSearchEmpty = false) {
    if (isSearchEmpty) {
      return h(
        "div",
        { class: "history-empty-state" },
        h("div", { class: "history-empty-icon" }, "⌕"),
        h("h2", {}, "No matching results"),
        h("p", {}, "We couldn't find any analyses matching your search or filter. Try another keyword or reset your filters."),
        h("button", {
          type: "button",
          class: "btn btn-accent",
          onclick: () => {
            searchInput.value = "";
            statusFilter.value = "all";
            sortSelect.value = "newest";
            renderRows();
          },
        }, "Clear Filters"),
      );
    }

    return h(
      "div",
      { class: "history-empty-state" },
      h("div", { class: "history-empty-icon" }, "✦"),
      h("h2", {}, "Your style journey starts here"),
      h("p", {}, "You haven't analyzed any outfits yet. Start your first analysis and your recommendations will appear here."),
      h("a", { class: "btn btn-accent", href: "/analyze" }, "Analyze Your First Outfit"),
    );
  }

  function createHistoryCard(item) {
    const thumb = h(
      "div",
      { class: "history-thumb" },
      h("div", { class: "history-thumb-loading" }, spinner()),
    );

    if (item.thumbnail_url) {
      fetchImageUrl(item.thumbnail_url, { signal: controller.signal })
        .then((url) => {
          if (controller.signal.aborted) {
            URL.revokeObjectURL(url);
            return;
          }
          objectUrls.push(url);
          thumb.replaceChildren(h("img", {
            src: url,
            alt: "Outfit analysis thumbnail",
            loading: "lazy",
          }));
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            thumb.replaceChildren(h("span", { class: "history-thumb-fallback" }, "No Image"));
          }
        });
    } else {
      thumb.replaceChildren(h("span", { class: "history-thumb-fallback" }, "No Image"));
    }

    const status = h(
      "span",
      { class: `history-status status-${item.status || "unknown"}` },
      statusLabel(item.status),
    );

    const detailsLink = h(
      "a",
      { class: "history-view-btn", href: `/analyses/${item.id}` },
      "View Details",
      h("span", { "aria-hidden": "true" }, " →"),
    );

    const deleteBtn = h(
      "button",
      {
        type: "button",
        class: "history-delete-btn",
        "aria-label": `Delete analysis dated ${formatDate(item.created_at)}`,
      },
      "Delete",
    );

    const description = item.summary || item.error?.message || "No summary available for this analysis.";

    const card = h(
      "li",
      { class: "history-card" },
      thumb,
      h(
        "div",
        { class: "history-card-content" },
        h("div", { class: "history-card-heading" }, h("h2", {}, occasionLabel(item)), status),
        h(
          "div",
          { class: "history-card-meta" },
          h("span", {}, h("span", { class: "history-meta-icon" }, "◷"), formatDate(item.created_at)),
          item.is_mock ? h("span", { class: "history-test-badge" }, "Test Data") : null,
        ),
        h("p", { class: "history-card-summary" }, description),
        h("div", { class: "history-card-actions" }, detailsLink, deleteBtn),
      ),
    );

    deleteBtn.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Delete this analysis?",
        body: "This analysis and its associated photo will be permanently deleted. This action cannot be undone.",
        confirmLabel: "Delete Analysis",
        danger: true,
      });
      if (!confirmed) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";

      try {
        await request(`/api/analyses/${item.id}/`, { method: "DELETE" });
        const index = records.findIndex((record) => String(record.item.id) === String(item.id));
        if (index !== -1) records.splice(index, 1);
        total = Math.max(0, total - 1);
        updateStatistics();
        renderRows();
        toast("Analysis deleted successfully.");
      } catch (error) {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete";
        toast(error.message || "Failed to delete analysis.", { error: true });
      }
    });

    return card;
  }

  function getVisibleRecords() {
    const keyword = searchInput.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value;
    const sortOrder = sortSelect.value;

    const filtered = records.filter(({ item }) => {
      const matchesStatus = selectedStatus === "all" || item.status === selectedStatus;
      const searchableText = [
        occasionLabel(item),
        item.summary || "",
        item.error?.message || "",
        item.status || "",
        statusLabel(item.status),
        item.occasion_label || "",
        item.is_mock ? "test data" : "",
      ].join(" ").toLowerCase();
      return matchesStatus && (!keyword || searchableText.includes(keyword));
    });

    filtered.sort((a, b) => {
      const dateA = new Date(a.item.created_at).getTime();
      const dateB = new Date(b.item.created_at).getTime();
      return sortOrder === "oldest" ? dateA - dateB : dateB - dateA;
    });

    return filtered;
  }

  function renderRows() {
    const visibleRecords = getVisibleRecords();
    list.replaceChildren(...visibleRecords.map((record) => record.element));

    const hasRecords = records.length > 0;
    const hasResults = visibleRecords.length > 0;
    list.hidden = !hasResults;
    emptyStateContainer.hidden = hasResults;

    if (!hasRecords && total === 0) {
      emptyStateContainer.replaceChildren(createEmptyState(false));
    } else if (!hasResults) {
      emptyStateContainer.replaceChildren(createEmptyState(true));
    }

    resultInfo.textContent = hasResults
      ? `Showing ${visibleRecords.length} of ${records.length} loaded analyses`
      : hasRecords ? "No results found in the loaded analyses" : "";

    loadMore.hidden = !nextUrl || (!hasRecords && total === 0);
  }

  searchInput.addEventListener("input", renderRows);
  statusFilter.addEventListener("change", renderRows);
  sortSelect.addEventListener("change", renderRows);

  async function loadPage() {
    if (!nextUrl || isLoading) return;
    isLoading = true;
    try {
      const url = new URL(nextUrl, location.origin);
      const page = await request(url.pathname + url.search, { signal: controller.signal });
      total = Number(page.count) || 0;
      nextUrl = page.next;
      page.results.forEach((item) => {
        records.push({ item, element: createHistoryCard(item) });
      });
      updateStatistics();
      renderRows();
    } finally {
      isLoading = false;
    }
  }

  loadMoreBtn.addEventListener("click", async () => {
    if (isLoading) return;
    loadMoreBtn.disabled = true;
    loadMoreBtn.replaceChildren(spinner(), " Loading...");
    try {
      await loadPage();
    } catch (error) {
      if (error.name !== "AbortError") {
        toast(error.message || "Failed to load more history.", { error: true });
      }
    } finally {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Load More";
    }
  });

  const statsSection = h(
    "section",
    { class: "history-stats" },
    h("div", { class: "history-stat-card" },
      h("span", { class: "history-stat-label" }, "Total Analyses"),
      totalStat,
      h("span", { class: "history-stat-note" }, "All recorded analyses"),
    ),
    h("div", { class: "history-stat-card" },
      h("span", { class: "history-stat-label" }, "Loaded Entries"),
      loadedStat,
      h("span", { class: "history-stat-note" }, "Loaded from the API"),
    ),
    h("div", { class: "history-stat-card" },
      h("span", { class: "history-stat-label" }, "Completed"),
      completedStat,
      h("span", { class: "history-stat-note" }, "Among loaded entries"),
    ),
  );

  const toolbar = h(
    "section",
    { class: "history-toolbar" },
    h("div", { class: "history-search-wrap" },
      h("span", { class: "history-search-icon", "aria-hidden": "true" }, "⌕"),
      searchInput,
    ),
    h("div", { class: "history-toolbar-filters" }, statusFilter, sortSelect),
  );

  const loadingState = h(
    "div",
    { class: "history-loading-state" },
    spinner(),
    h("p", {}, "Loading your analysis history..."),
  );
  container.replaceChildren(loadingState);

  try {
    await loadPage();
    container.replaceChildren(statsSection, toolbar, resultInfo, list, emptyStateContainer, loadMore);
    renderRows();
  } catch (error) {
    if (error.name === "AbortError") return;

    const retryButton = h("button", {
      type: "button",
      class: "btn btn-ghost",
      onclick: async () => {
        retryButton.disabled = true;
        retryButton.textContent = "Loading...";
        try {
          await loadPage();
          container.replaceChildren(statsSection, toolbar, resultInfo, list, emptyStateContainer, loadMore);
          renderRows();
        } catch (retryError) {
          retryButton.disabled = false;
          retryButton.textContent = "Try Again";
          if (retryError.name !== "AbortError") {
            toast(retryError.message || "Could not load history.", { error: true });
          }
        }
      },
    }, "Try Again");

    container.replaceChildren(
      h("div", { class: "history-error-state" },
        h("div", { class: "history-error-icon" }, "!"),
        h("h2", {}, "Could not load history"),
        h("p", {}, error.message || "Something went wrong while loading your history."),
        retryButton,
      ),
    );
  }

  return h(
    "div",
    { class: "page shell history-page" },
    h("div", { class: "page-head history-page-head" },
      h("div", { class: "history-heading" },
        h("p", { class: "eyebrow" }, "Your Personal Archive"),
        h("h1", {}, "Analysis History"),
        countLine,
      ),
      h("a", { class: "btn btn-accent history-new-btn", href: "/analyze" }, "+ New Analysis"),
    ),
    container,
  );
}
