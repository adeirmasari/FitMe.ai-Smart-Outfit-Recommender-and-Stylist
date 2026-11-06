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

function occasionName(analysis) {
  const labels = {
    casual: "Casual",
    campus: "Campus",
    work: "Work",
    formal: "Formal event",
    party: "Party",
    other: "Other",
  };
  return analysis.occasion === "other" && analysis.occasion_detail
    ? `Other: ${analysis.occasion_detail}`
    : labels[analysis.occasion] || analysis.occasion_label;
}

function clothingCategory(category) {
  const labels = {
    top: "Top",
    bottom: "Bottom",
    outerwear: "Outerwear",
    dress: "Dress",
    footwear: "Footwear",
    accessory: "Accessory",
    bag: "Bag",
    other: "Other",
  };
  return labels[category] || category;
}

function sourceBadge(source) {
  if (!source) return null;

  if (source.is_mock) {
    return h(
      "span",
      { class: "source-badge mock" },
      "Test data — not AI-generated",
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
          "Detected clothing",
        ),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, "Item"),
            h("th", { scope: "col" }, "Color"),
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
                      ` · ${clothingCategory(item.category)}`,
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
          "aria-label":           "Dominant colors",
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
    "What we observed",
    "Observation",
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
        "Main recommendation",
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
        "Color combinations",
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
              alt: `${item.category === "top" ? "Top" : "Bottom"}: ${item.name}`,
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
                "Photo unavailable. This item may have been deleted.",
              ),
            );
          }
        });
    } else {
      frame.replaceChildren(
        h(
          "p",
          { class: "muted small" },
          "Item ID unavailable.",
        ),
      );
    }

    return h(
      "article",
      {
        class: "wardrobe-result-item",
        dataset: { wardrobeItemId: item.wardrobe_item_id || "" },
      },
      h(
        "p",
        { class: "eyebrow" },
        item.category === "top"
          ? "TOP"
          : "BOTTOM",
      ),
      frame,
      h("h3", {}, item.name || "Unnamed item"),
      h(
        "p",
        { class: "small wardrobe-item-id" },
        `Item ID: ${item.wardrobe_item_id || "unavailable"}`,
      ),
      item.color
        ? h(
            "p",
            { class: "small muted" },
            `Color: ${item.color}`,
          )
        : null,
    );
  }

  const outfits = Array.isArray(rec.outfits)
    ? rec.outfits
    : [];

  if (!outfits.length) {
    return block(
      "Digital Wardrobe recommendation",
      null,
      h(
        "p",
        { class: "muted" },
        "Recommended clothing details are unavailable. Try generating a new recommendation.",
      ),
    );
  }

  return block(
    "Digital Wardrobe recommendation",
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
          h("strong", {}, "Why this outfit: "),
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
            "This analysis may have been deleted or may not belong to your account.",
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

  // Analysis photo or Digital Wardrobe collage
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
              ? "Digital Wardrobe photo collage"
              : `Outfit photo for ${occasionName(analysis)}`,
        }),
      );
    })
    .catch((error) => {
      if (error.name !== "AbortError") {
        frame.replaceChildren(
          h(
            "p",
            { class: "muted small" },
            "Could not load photo.",
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

  // Action buttons
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
        "The photo and recommendation will be permanently deleted.",
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
      occasionName(analysis),
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
          ? "Digital Wardrobe recommendation"
          : "Outfit analysis result"
        : analysis.status === "failed"
          ? analysis.error?.code === "image_not_clothing"
            ? "Photo rejected"
            : "Analysis failed"
          : "Processing",
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

  // Render the page based on the analysis status.
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
                      "This is development test data.",
                    ),
                    "This photo was not analyzed by AI. Configure AI_PROVIDER to get results from an AI model.",
                  )
                : null,
              ...recommendations(
                rec,
                occasionName(analysis),
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
          ? "Recommendations use up to 12 photos from your Digital Wardrobe."
          : "Suggestions are generated by an AI model from one photo. Use them as guidance, not as a definitive decision.",
      ),
    ];
  } else if (
    analysis.status === "failed" &&
    analysis.error?.code === "image_not_clothing"
  ) {
    // This is not a successful analysis; explain the rejection and offer a replacement.
    const err = analysis.error;
    const reason = window.history.state?.rejectionReason || "";

    body = [
      h(
        "div",
        {
          class: "alert",
          role: "alert",
        },
        h("strong", {}, err.message),
        reason ? h("span", { style: { display: "block" } }, `Reason: ${reason}`) : null,
        h(
          "span",
          { style: { display: "block", marginTop: "var(--space-2)" } },
          err.guidance ||
            "Replace it with a photo that clearly shows clothing.",
        ),
      ),
      h(
        "div",
        { class: "result-actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn btn-accent",
            onclick: () => ctx.navigate("/analyze"),
          },
          "Replace photo",
        ),
      ),
    ];
  } else if (analysis.status === "failed") {
    const err =
      analysis.error || {
        message: "The analysis could not be completed.",
        retryable: true,
      };

    const retryBtn = err.retryable
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-accent",
          },
          "Try again",
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
            ? "Putting together a new outfit from your wardrobe…"
            : "Resubmitting your photo to the AI. This may take up to one minute.";

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
                  rejectionReason:
                    error.data?.error?.reason || "",
                },
              },
            );

            if (error.code !== "image_not_clothing") {
              toast(error.message, {
                error: true,
              });
            }
            return;
          }

          retryStatus.textContent =
            error.message;
          busy = false;
          retryBtn.disabled = false;
          retryBtn.textContent = "Try again";
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
            ? "Your wardrobe items are saved. You can try generating a recommendation again."
            : "Your photo is saved. You can try again without uploading it again."
          : "Check whether the AI service is available or start a new analysis.",
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
          `Error code: ${err.code} · Attempt: ${analysis.attempt_count}`,
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
      err.code === "provider_not_configured"
        ? h(
            "div",
            { class: "result-actions" },
            h(
              "a",
              { class: "btn btn-ghost", href: "/analyze" },
              "Check AI status",
            ),
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
          "Your analysis is still processing.",
        ),
        "Check back shortly to see the results.",
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
            "Refresh status",
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