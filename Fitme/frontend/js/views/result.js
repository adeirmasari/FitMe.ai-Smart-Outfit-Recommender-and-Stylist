import { ApiError, fetchImageUrl, request } from "../api.js";
import {
  confirmDialog,
  formatDate,
  h,
  spinner,
  toast,
} from "../dom.js";
import { safeHex } from "../validation.js";

function block(title, eyebrow, ...content) {
  return h(
    "section",
    { class: "result-block" },
    h(
      "h2",
      {},
      title,
      eyebrow
        ? h("span", { class: "eyebrow" }, eyebrow)
        : null,
    ),
    ...content,
  );
}

function sourceBadge(source) {
  if (!source) return null;

  if (source.is_mock) {
    return h(
      "span",
      { class: "source-badge mock" },
      "Development mock — not AI output",
    );
  }

  return h(
    "span",
    {
      class: "source-badge",
      title: `Prompt ${source.prompt_version}`,
    },
    `${source.model} · ${(source.latency_ms / 1000).toFixed(1)}s`,
  );
}

function observations(rec) {
  const parts = [
    h("p", { class: "lead" }, rec.visual_analysis),
  ];

  if (rec.clothing_items.length) {
    parts.push(
      h(
        "table",
        {
          class: "items-table",
          style: {
            marginTop: "var(--space-5)",
          },
        },
        h(
          "caption",
          { class: "visually-hidden" },
          "Detected clothing items",
        ),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, "Item"),
            h("th", { scope: "col" }, "Colour"),
            h("th", { scope: "col" }, "Details"),
          ),
        ),
        h(
          "tbody",
          {},
          rec.clothing_items.map((item) =>
            h(
              "tr",
              {},
              h(
                "td",
                {},
                item.name,
                item.category
                  ? h(
                      "span",
                      { class: "muted" },
                      ` · ${item.category}`,
                    )
                  : null,
              ),
              h("td", {}, item.color || "—"),
              h("td", {}, item.details || "—"),
            ),
          ),
        ),
      ),
    );
  }

  if (rec.dominant_colors.length) {
    parts.push(
      h(
        "ul",
        {
          class: "swatches",
          "aria-label": "Dominant colours",
        },
        rec.dominant_colors.map((color) => {
          const hex = safeHex(color.hex);
          const swatch = h("span", {
            class: "swatch",
            "aria-hidden": "true",
          });

          if (hex) {
            swatch.style.backgroundColor = hex;
          }

          return h(
            "li",
            {},
            swatch,
            h(
              "span",
              {},
              color.name || hex || "Unnamed",
            ),
            hex
              ? h(
                  "span",
                  { class: "muted small" },
                  hex,
                )
              : null,
          );
        }),
      ),
    );
  }

  if (rec.styling_observations.length) {
    parts.push(
      h(
        "ul",
        {
          class: "plain-list",
          style: {
            marginTop: "var(--space-5)",
          },
        },
        rec.styling_observations.map((observation) =>
          h("li", {}, observation),
        ),
      ),
    );
  }

  return block(
    "What the model sees",
    "Observations",
    ...parts,
  );
}

function recommendations(rec, occasionLabel) {
  const out = [
    h(
      "div",
      { class: "verdict" },
      h(
        "p",
        { class: "eyebrow" },
        "Primary recommendation",
      ),
      h(
        "p",
        { class: "primary" },
        rec.primary_recommendation,
      ),
      rec.occasion_rationale
        ? h(
            "p",
            { class: "why" },
            h(
              "strong",
              {},
              `Why it works for ${occasionLabel.toLowerCase()}: `,
            ),
            rec.occasion_rationale,
          )
        : null,
    ),
  ];

  if (rec.color_suggestions.length) {
    out.push(
      block(
        "Colour pairings",
        null,
        h(
          "ul",
          { class: "pairings" },
          rec.color_suggestions.map((suggestion) =>
            h(
              "li",
              {},
              suggestion.palette.length
                ? h(
                    "span",
                    { class: "palette" },
                    suggestion.palette.join(" + "),
                  )
                : null,
              suggestion.note
                ? h(
                    "span",
                    { class: "muted" },
                    suggestion.note,
                  )
                : null,
            ),
          ),
        ),
      ),
    );
  }

  if (rec.alternative_outfits.length) {
    out.push(
      block(
        "Alternatives",
        "Optional",
        h(
          "ul",
          { class: "alts" },
          rec.alternative_outfits.map((alternative) =>
            h(
              "li",
              {},
              alternative.title
                ? h("h3", {}, alternative.title)
                : null,
              alternative.description
                ? h("p", {}, alternative.description)
                : null,
              alternative.items.length
                ? h(
                    "p",
                    { class: "alt-items" },
                    alternative.items.join(" · "),
                  )
                : null,
            ),
          ),
        ),
      ),
    );
  }

  return out;
}

function wardrobeOutfits(rec, ctx) {
  const controller = new AbortController();
  const imageUrls = [];

  ctx.onCleanup(() => {
    controller.abort();

    imageUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
  });

  function clothingCard(item) {
    const frame = h(
      "div",
      { class: "frame" },
      spinner(),
    );

    if (item.wardrobe_item_id) {
      const path =
        `/api/wardrobe/` +
        `${encodeURIComponent(item.wardrobe_item_id)}` +
        `/image/?variant=thumb`;

      fetchImageUrl(path, {
        signal: controller.signal,
      })
        .then((url) => {
          imageUrls.push(url);

          frame.replaceChildren(
            h("img", {
              src: url,
              alt: item.name,
              loading: "lazy",
            }),
          );
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            frame.replaceChildren(
              h(
                "p",
                { class: "muted small" },
                "Foto tidak tersedia; pakaian mungkin sudah dihapus.",
              ),
            );
          }
        });
    } else {
      frame.replaceChildren(
        h(
          "p",
          { class: "muted small" },
          "ID pakaian tidak tersedia.",
        ),
      );
    }

    return h(
      "article",
      { class: "result-block" },
      h(
        "p",
        { class: "eyebrow" },
        item.category === "top"
          ? "ATASAN"
          : "BAWAHAN",
      ),
      frame,
      h("h3", {}, item.name),
      h(
        "p",
        { class: "small muted" },
        `ID: ${item.wardrobe_item_id}`,
      ),
      item.color
        ? h(
            "p",
            { class: "small muted" },
            `Warna: ${item.color}`,
          )
        : null,
    );
  }

  const outfits = Array.isArray(rec.outfits)
    ? rec.outfits
    : [];

  if (!outfits.length) {
    return block(
      "Outfit dari Digital Wardrobe",
      null,
      h(
        "p",
        { class: "muted" },
        "Data outfit belum tersedia. Coba buat rekomendasi kembali.",
      ),
    );
  }

  return block(
    "Outfit dari Digital Wardrobe",
    null,
    ...outfits.map((outfit) =>
      h(
        "article",
        { class: "result-block" },
        h("h3", {}, outfit.title),
        h(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "1rem",
            },
          },
          (
            Array.isArray(outfit.items)
              ? outfit.items
              : []
          ).map(clothingCard),
        ),
        h(
          "p",
          { class: "why" },
          outfit.reason,
        ),
      ),
    ),
  );
}

export async function renderResult(ctx) {
  const id = ctx.params.id;

  let analysis =
    ctx.state?.analysis?.id === id
      ? ctx.state.analysis
      : null;

  if (!analysis) {
    try {
      analysis = await request(
        `/api/analyses/${encodeURIComponent(id)}/`,
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 404
      ) {
        return h(
          "div",
          { class: "center-state" },
          h(
            "h1",
            {
              style: {
                fontSize: "var(--step-3)",
              },
            },
            "Analysis not found",
          ),
          h(
            "p",
            { class: "muted" },
            "It may have been deleted, or it belongs to another account.",
          ),
          h(
            "a",
            {
              class: "btn btn-ghost",
              href: "/history",
            },
            "Back to history",
          ),
        );
      }

      throw error;
    }
  }

  // Foto analisis atau kolase Digital Wardrobe
  const frame = h(
    "div",
    { class: "frame" },
    h(
      "span",
      { class: "loading-line" },
      spinner(),
      "Loading photo…",
    ),
  );

  let objectUrl = null;
  const controller = new AbortController();

  fetchImageUrl(analysis.image_url, {
    signal: controller.signal,
  })
    .then((url) => {
      objectUrl = url;

      frame.replaceChildren(
        h("img", {
          src: url,
          alt:
            analysis.source === "wardrobe"
              ? "Kolase foto Digital Wardrobe"
              : `Submitted outfit photo for ${analysis.occasion_label}`,
        }),
      );
    })
    .catch((error) => {
      if (error.name !== "AbortError") {
        frame.replaceChildren(
          h(
            "p",
            { class: "muted small" },
            "The photo couldn't be loaded.",
          ),
        );
      }
    });

  ctx.onCleanup(() => {
    controller.abort();

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  });

  const prefs = [
    analysis.preferred_style &&
      `Style: ${analysis.preferred_style}`,
    analysis.desired_impression &&
      `Impression: ${analysis.desired_impression}`,
    analysis.additional_context &&
      `Notes: ${analysis.additional_context}`,
  ].filter(Boolean);

  const photo = h(
    "aside",
    { class: "result-photo" },
    frame,
    h(
      "div",
      { class: "meta" },
      h(
        "span",
        {},
        formatDate(analysis.created_at),
      ),
      prefs.map((pref) =>
        h("span", {}, pref),
      ),
    ),
  );

  // Tombol tindakan
  let busy = false;

  const deleteBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-danger",
    },
    "Delete",
  );

  deleteBtn.addEventListener("click", async () => {
    if (busy) return;

    const ok = await confirmDialog({
      title: "Delete this analysis?",
      body:
        "The photo and its recommendations will be permanently removed.",
      confirmLabel: "Delete",
      danger: true,
    });

    if (!ok) return;

    busy = true;
    deleteBtn.disabled = true;

    try {
      await request(
        `/api/analyses/${encodeURIComponent(id)}/`,
        { method: "DELETE" },
      );

      toast("Analysis deleted.");
      ctx.navigate("/history", {
        replace: true,
      });
    } catch (error) {
      toast(error.message, {
        error: true,
      });

      busy = false;
      deleteBtn.disabled = false;
    }
  });

  const actions = h(
    "div",
    { class: "result-actions" },
    h(
      "a",
      {
        class: "btn",
        href: "/analyze",
      },
      "Analyze another outfit",
    ),
    h(
      "a",
      {
        class: "btn btn-ghost",
        href: "/history",
      },
      "History",
    ),
    deleteBtn,
  );

  const header = h(
    "div",
    {
      style: {
        display: "grid",
        gap: "var(--space-3)",
        marginBottom: "var(--space-5)",
      },
    },
    h(
      "p",
      { class: "eyebrow" },
      analysis.occasion_label,
    ),
    h(
      "h1",
      {
        style: {
          fontSize: "var(--step-3)",
        },
      },
      analysis.status === "completed"
        ? analysis.source === "wardrobe"
          ? "Rekomendasi Digital Wardrobe"
          : "Your outfit analysis"
        : analysis.status === "failed"
          ? "The analysis didn't finish"
          : "Still processing",
    ),
    analysis.recommendation
      ? h(
          "div",
          {},
          sourceBadge(
            analysis.recommendation.source,
          ),
        )
      : null,
  );

  // Isi halaman sesuai status analisis
  let body;

  if (
    analysis.status === "completed" &&
    analysis.recommendation
  ) {
    const rec = analysis.recommendation;

    body = [
      ...(
        analysis.source === "wardrobe"
          ? [wardrobeOutfits(rec, ctx)]
          : [
              rec.source.is_mock
                ? h(
                    "div",
                    {
                      class: "alert alert-notice",
                      style: {
                        marginBottom:
                          "var(--space-5)",
                      },
                    },
                    h(
                      "strong",
                      {},
                      "This is a development fixture.",
                    ),
                    "No vision model analyzed this photo. Configure AI_PROVIDER=gemini for real results.",
                  )
                : null,
              ...recommendations(
                rec,
                analysis.occasion_label,
              ),
              observations(rec),
            ]
      ),
      rec.limitations.length
        ? h(
            "section",
            { class: "result-block" },
            h(
              "div",
              { class: "limitations" },
              h(
                "h2",
                {},
                "Limitations",
              ),
              h(
                "ul",
                { class: "plain-list" },
                rec.limitations.map(
                  (limitation) =>
                    h(
                      "li",
                      {},
                      limitation,
                    ),
                ),
              ),
            ),
          )
        : null,
      h(
        "p",
        { class: "small muted" },
        analysis.source === "wardrobe"
          ? "Rekomendasi berdasarkan hingga 12 foto dari Digital Wardrobe."
          : "Suggestions are generated by a vision-language model from a single photo. Treat them as a starting point, not a verdict.",
      ),
    ];
  } else if (analysis.status === "failed") {
    const err =
      analysis.error || {
        message: "The analysis failed.",
        retryable: true,
      };

    const retryBtn = err.retryable
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-accent",
          },
          "Retry analysis",
        )
      : null;

    const retryStatus = h("p", {
      class: "small muted",
      "aria-live": "polite",
    });

    retryBtn?.addEventListener(
      "click",
      async () => {
        if (busy) return;

        busy = true;
        retryBtn.disabled = true;
        retryBtn.replaceChildren(
          spinner(),
          " Retrying…",
        );

        retryStatus.textContent =
          analysis.source === "wardrobe"
            ? "Gemini sedang menyusun ulang kombinasi dari koleksi pakaianmu…"
            : "Sending the same photo to the model again. This can take up to a minute.";

        try {
          const updated = await request(
            `/api/analyses/${encodeURIComponent(id)}/retry/`,
            { method: "POST" },
          );

          ctx.navigate(
            `/analyses/${id}`,
            {
              replace: true,
              state: {
                analysis: updated,
              },
            },
          );
        } catch (error) {
          const updated =
            error.data?.analysis;

          if (updated) {
            ctx.navigate(
              `/analyses/${id}`,
              {
                replace: true,
                state: {
                  analysis: updated,
                },
              },
            );

            toast(error.message, {
              error: true,
            });
            return;
          }

          retryStatus.textContent =
            error.message;
          busy = false;
          retryBtn.disabled = false;
          retryBtn.textContent =
            "Retry analysis";
        }
      },
    );

    body = [
      h(
        "div",
        {
          class: "alert",
          role: "alert",
        },
        h(
          "strong",
          {},
          err.message,
        ),
        err.retryable
          ? analysis.source === "wardrobe"
            ? "Foto koleksi tersimpan, sehingga kamu dapat mencoba rekomendasi lagi."
            : "Your photo is saved, so you can retry without uploading it again."
          : "Try again later or start a new analysis.",
        h(
          "span",
          {
            class: "small muted",
            style: {
              display: "block",
              marginTop:
                "var(--space-2)",
            },
          },
          `Error code: ${err.code} · Attempts: ${analysis.attempt_count}`,
        ),
      ),
      retryBtn
        ? h(
            "div",
            {
              class: "result-actions",
            },
            retryBtn,
          )
        : null,
      retryStatus,
    ];
  } else {
    body = [
      h(
        "div",
        {
          class: "alert alert-info",
        },
        h(
          "strong",
          {},
          "This analysis is still being processed.",
        ),
        "Refresh in a moment to see the result.",
        h(
          "div",
          {
            class: "alert-actions",
          },
          h(
            "button",
            {
              class: "btn-link",
              type: "button",
              onclick: () =>
                ctx.navigate(
                  location.pathname,
                  {
                    replace: true,
                  },
                ),
            },
            "Refresh",
          ),
        ),
      ),
    ];
  }

  return h(
    "div",
    { class: "page shell" },
    h(
      "div",
      { class: "result" },
      photo,
      h(
        "div",
        {},
        header,
        ...body,
        actions,
      ),
    ),
  );
}