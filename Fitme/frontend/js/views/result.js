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
    casual: "Kasual",
    campus: "Kampus",
    work: "Kerja",
    formal: "Acara formal",
    party: "Pesta",
    other: "Lainnya",
  };
  return analysis.occasion === "other" && analysis.occasion_detail
    ? `Lainnya: ${analysis.occasion_detail}`
    : labels[analysis.occasion] || analysis.occasion_label;
}

function clothingCategory(category) {
  const labels = {
    top: "Atasan",
    bottom: "Bawahan",
    outerwear: "Pakaian luar",
    dress: "Gaun",
    footwear: "Alas kaki",
    accessory: "Aksesori",
    bag: "Tas",
    other: "Lainnya",
  };
  return labels[category] || category;
}

function sourceBadge(source) {
  if (!source) return null;

  if (source.is_mock) {
    return h(
      "span",
      { class: "source-badge mock" },
      "Data uji — bukan hasil AI",
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
          "Pakaian yang terdeteksi",
        ),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, "Pakaian"),
            h("th", { scope: "col" }, "Warna"),
            h("th", { scope: "col" }, "Detail"),
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
          "aria-label": "Warna utama",
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
              color.name || hex || "Tanpa nama",
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
    "Hasil pengamatan",
    "Pengamatan",
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
        "Rekomendasi utama",
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
              `Alasan cocok untuk ${occasionLabel.toLowerCase()}: `,
            ),
            rec.occasion_rationale,
          )
        : null,
    ),
  ];

  if (rec.color_suggestions.length) {
    out.push(
      block(
        "Paduan warna",
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
        "Alternatif",
        "Opsional",
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
              alt: `${item.category === "top" ? "Atasan" : "Bawahan"}: ${item.name}`,
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
                "Foto tidak tersedia. Pakaian mungkin sudah dihapus.",
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
      {
        class: "wardrobe-result-item",
        dataset: { wardrobeItemId: item.wardrobe_item_id || "" },
      },
      h(
        "p",
        { class: "eyebrow" },
        item.category === "top"
          ? "ATASAN"
          : "BAWAHAN",
      ),
      frame,
      h("h3", {}, item.name || "Pakaian tanpa nama"),
      h(
        "p",
        { class: "small wardrobe-item-id" },
        `ID pakaian: ${item.wardrobe_item_id || "tidak tersedia"}`,
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
      "Rekomendasi dari Lemari Digital",
      null,
      h(
        "p",
        { class: "muted" },
        "Data pakaian rekomendasi belum tersedia. Coba buat rekomendasi kembali.",
      ),
    );
  }

  return block(
    "Rekomendasi dari Lemari Digital",
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
          h("strong", {}, "Alasan rekomendasi: "),
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
            "Analisis tidak ditemukan",
          ),
          h(
            "p",
            { class: "muted" },
            "Data mungkin telah dihapus atau bukan milik akun ini.",
          ),
          h(
            "a",
            {
              class: "btn btn-ghost",
              href: "/history",
            },
            "Kembali ke riwayat",
          ),
        );
      }

      throw error;
    }
  }

  // Foto analisis atau kolase Lemari Digital
  const frame = h(
    "div",
    { class: "frame" },
    h(
      "span",
      { class: "loading-line" },
      spinner(),
      "Memuat foto…",
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
              ? "Kolase foto Lemari Digital"
              : `Foto pakaian untuk acara ${occasionName(analysis)}`,
        }),
      );
    })
    .catch((error) => {
      if (error.name !== "AbortError") {
        frame.replaceChildren(
          h(
            "p",
            { class: "muted small" },
            "Foto tidak dapat dimuat.",
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
    `Gaya: ${analysis.preferred_style}`,
    analysis.desired_impression &&
      `Kesan: ${analysis.desired_impression}`,
    analysis.additional_context &&
      `Catatan: ${analysis.additional_context}`,
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
    "Hapus",
  );

  deleteBtn.addEventListener("click", async () => {
    if (busy) return;

    const ok = await confirmDialog({
      title: "Hapus analisis ini?",
      body:
        "Foto dan rekomendasinya akan dihapus secara permanen.",
      confirmLabel: "Hapus",
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

      toast("Analisis berhasil dihapus.");
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
      "Analisis pakaian lain",
    ),
    h(
      "a",
      {
        class: "btn btn-ghost",
        href: "/history",
      },
      "Riwayat",
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
          ? "Rekomendasi Lemari Digital"
          : "Hasil analisis pakaian"
        : analysis.status === "failed"
          ? analysis.error?.code === "image_not_clothing"
            ? "Foto ditolak"
            : "Analisis belum selesai"
          : "Sedang diproses",
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
                      "Ini adalah data uji pengembangan.",
                    ),
                    "Foto ini tidak dianalisis oleh AI. Atur AI_PROVIDER untuk mendapatkan hasil dari model AI.",
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
                "Batasan",
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
          ? "Rekomendasi dibuat dari maksimal 12 foto di Lemari Digital."
          : "Saran dibuat oleh model AI dari satu foto. Gunakan sebagai pertimbangan, bukan keputusan mutlak.",
      ),
    ];
  } else if (
    analysis.status === "failed" &&
    analysis.error?.code === "image_not_clothing"
  ) {
    // Bukan analisis sukses: tampilkan alasan dan arahkan untuk mengganti foto.
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
        reason ? h("span", { style: { display: "block" } }, `Alasan: ${reason}`) : null,
        h(
          "span",
          { style: { display: "block", marginTop: "var(--space-2)" } },
          err.guidance ||
            "Ganti dengan foto yang menampilkan pakaian dengan jelas.",
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
          "Ganti foto",
        ),
      ),
    ];
  } else if (analysis.status === "failed") {
    const err =
      analysis.error || {
        message: "Analisis gagal diselesaikan.",
        retryable: true,
      };

    const retryBtn = err.retryable
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-accent",
          },
          "Coba lagi",
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
          " Mencoba lagi…",
        );

        retryStatus.textContent =
          analysis.source === "wardrobe"
            ? "Menyusun ulang kombinasi dari koleksi pakaian…"
            : "Mengirim ulang foto ke AI. Proses ini dapat memerlukan waktu hingga satu menit.";

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
          retryBtn.textContent = "Coba lagi";
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
            ? "Foto koleksi tersimpan. Kamu dapat mencoba rekomendasi lagi."
            : "Foto tersimpan. Kamu dapat mencoba lagi tanpa mengunggah ulang."
          : "Coba periksa kembali ketersediaan AI atau mulai analisis baru.",
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
          `Kode gangguan: ${err.code} · Percobaan: ${analysis.attempt_count}`,
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
              "Periksa status AI",
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
          "Analisis masih diproses.",
        ),
        "Perbarui status sebentar lagi untuk melihat hasilnya.",
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
            "Perbarui status",
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