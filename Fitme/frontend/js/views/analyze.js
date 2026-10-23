import { ApiError, request, upload, fetchImageUrl } from "../api.js";
import { h, spinner } from "../dom.js";
import { getSession } from "../session.js";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_TYPES,
  MAX_BYTES,
  OCCASIONS,
  TEXT_LIMITS,
  checkDimensions,
  checkFile,
  formatBytes,
  validateBrief,
} from "../validation.js";

const STAGES = [
  [0, "Mengirim koleksi ke Gemini…"],
  [6000, "Reading the garments and colours…"],
  [16000, "Matching suggestions to the occasion…"],
  [35000, "Still working — larger models can take up to a minute."],
];

function readDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function textField({ id, label, hint, multiline = false, value = "" }) {
  const limit = TEXT_LIMITS[id];
  const control = multiline
    ? h("textarea", { id, name: id, maxlength: limit, rows: 3, "aria-describedby": `${id}-hint ${id}-count` })
    : h("input", { id, name: id, type: "text", maxlength: limit, "aria-describedby": `${id}-hint ${id}-count` });
  control.value = value;
  const count = h("span", { id: `${id}-count`, class: "counter", "aria-live": "off" });
  const error = h("p", { class: "error-text", hidden: true });
  const update = () => (count.textContent = `${control.value.length}/${limit}`);
  control.addEventListener("input", update);
  update();
  const wrap = h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    control,
    h("div", { style: { display: "flex", justifyContent: "space-between", gap: "1rem" } }, h("p", { id: `${id}-hint`, class: "hint" }, hint), count),
    error,
  );
  return {
    wrap,
    control,
    setError(text) {
      error.hidden = !text;
      error.textContent = text || "";
      control.setAttribute("aria-invalid", text ? "true" : "false");
    },
  };
}

    export async function renderAnalyze(ctx) {
      const profile = getSession().profile;
      const state = {
      file: null,
      fileError: null,
      previewUrl: null,
      busy: false,
      controller: null,
      sampleKey: null,
      source: "upload",
      selectedWardrobeItemId: null,
      wardrobeItems: [],
      wardrobeImageUrls: [],
      wardrobeImageUrlById: {},
      wardrobeLoading: false,
      wardrobeLoaded: false,
      wardrobeError: null,
    };

  const [health, samples] = await Promise.all([
    request("/api/health/", { auth: false }).catch(() => null),
    fetch("/static/assets/samples/samples.json")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ]);
  const provider = health?.ai_provider;
  const providerReady = Boolean(provider?.configured);

  // ---------- Image column ----------

    // ---------- Clothing source selector ----------
  const sourceUploadBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-accent",
      "aria-pressed": "true",
      onclick: () => switchSource("upload"),
    },
    "Upload Foto Baru",
  );

  const sourceWardrobeBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      "aria-pressed": "false",
      onclick: () => switchSource("wardrobe"),
    },
    "Digital Wardrobe",
  );

  const sourceSelector = h(
    "div",
    {
      class: "source-selector",
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem",
        marginBottom: "1rem",
      },
    },
    sourceUploadBtn,
    sourceWardrobeBtn,
  );

    const wardrobePanel = h("div", {
    class: "wardrobe-panel",
    hidden: true,
  });

  const wardrobeStatus = h(
    "p",
    { class: "small muted", role: "status" },
    "Koleksi pakaian akan ditampilkan di sini.",
  );

  const wardrobeGrid = h("div", {
    class: "wardrobe-grid",
  });

  wardrobePanel.append(wardrobeStatus, wardrobeGrid);

    async function loadWardrobe() {
    if (state.wardrobeLoading || state.wardrobeLoaded) return;

    state.wardrobeLoading = true;
    state.wardrobeError = null;
    state.wardrobeImageUrlById = {};
    wardrobeStatus.textContent = "Memuat koleksi pakaian...";
    wardrobeGrid.replaceChildren();

    try {
      const response = await request("/api/wardrobe/?page_size=50");
      const items = Array.isArray(response)
        ? response
        : response.results || [];

      state.wardrobeItems = items;
      state.wardrobeLoaded = true;

      if (items.length === 0) {
        wardrobeStatus.textContent =
          "Koleksi masih kosong. Tambahkan pakaian terlebih dahulu di Digital Wardrobe.";
        return;
      }

      wardrobeStatus.textContent =
        `${items.length} item pakaian tersimpan.`;

      const cards = await Promise.all(
        items.map(async (item) => {
          let imageUrl = null;

          if (item.thumbnail_url || item.image_url) {
            try {
              imageUrl = await fetchImageUrl(
                item.thumbnail_url || item.image_url,
              );
            } catch {
              imageUrl = null;
            }
          }

          if (imageUrl) {
            state.wardrobeImageUrls.push(imageUrl);
            state.wardrobeImageUrlById[item.id] = imageUrl;
          }

          return h(
            "article",
            {
              class: "wardrobe-item-card",
              style: {
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "0.75rem",
                minWidth: "0",
              },
            },
            imageUrl
              ? h("img", {
                  src: imageUrl,
                  alt: item.name,
                  loading: "lazy",
                  style: {
                    width: "100%",
                    height: "150px",
                    objectFit: "cover",
                    borderRadius: "8px",
                  },
                })
              : h(
                  "div",
                  {
                    style: {
                      height: "150px",
                      display: "grid",
                      placeItems: "center",
                    },
                  },
                  "Foto tidak tersedia",
                ),
            h("h3", {}, item.name),
            h("p", { class: "small muted" }, item.category_label || item.category),
            item.color
              ? h("p", { class: "small muted" }, `Warna: ${item.color}`)
              : null,
          );
        }),
      );

      wardrobeGrid.style.display = "grid";
      wardrobeGrid.style.gridTemplateColumns =
        "repeat(auto-fill, minmax(140px, 1fr))";
      wardrobeGrid.style.gap = "1rem";
      wardrobeGrid.replaceChildren(...cards);
    } catch (error) {
      state.wardrobeError = error.message || "Gagal memuat koleksi pakaian.";
      wardrobeStatus.textContent = state.wardrobeError;
    } finally {
      state.wardrobeLoading = false;
      updateSubmit();
    }
  }

  
  
  function selectWardrobeItem() {
    // Digital Wardrobe menggunakan seluruh koleksi,
    // bukan satu item yang dipilih pengguna.
    updateSubmit();
  }


  function switchSource(source) {
    if (state.busy) return;

    state.source = source;

    const useUpload = source === "upload";

    sourceUploadBtn.classList.toggle("btn-accent", useUpload);
    sourceWardrobeBtn.classList.toggle("btn-accent", !useUpload);

    sourceUploadBtn.setAttribute("aria-pressed", String(useUpload));
    sourceWardrobeBtn.setAttribute("aria-pressed", String(!useUpload));

    wardrobePanel.hidden = useUpload;
    dropzone.hidden = !useUpload || Boolean(state.file);
    preview.hidden = !useUpload || !state.file;
    imageError.hidden = !useUpload || !state.fileError;

    if (samplesBlock) {
      samplesBlock.hidden = !useUpload;
    }

    if (!useUpload) {
      loadWardrobe();
    }

    updateSubmit();
  }

  const fileInput = h("input", {
    type: "file",
    id: "photo",
    accept: [...ACCEPTED_TYPES, ...ACCEPTED_EXTENSIONS].join(","),
    class: "visually-hidden",
    "aria-describedby": "photo-rules photo-error",
  });
  const cameraInput = h("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  const imageError = h("p", { id: "photo-error", class: "error-text", role: "alert" });
  const hasCamera = window.matchMedia("(pointer: coarse)").matches;

  const chooseBtn = h("button", { type: "button", class: "btn", onclick: () => fileInput.click() }, "Choose photo");
  const cameraBtn = hasCamera ? h("button", { type: "button", class: "btn btn-ghost", onclick: () => cameraInput.click() }, "Take photo") : null;

  const dropzone = h(
    "div",
    { class: "dropzone" },
    h(
      "div",
      {},
      h("h2", {}, "Add an outfit photo"),
      h("p", { class: "muted" }, hasCamera ? "Choose from your library or use the camera." : "Drag a photo here, or choose one from your computer."),
      h("div", { class: "picker" }, h("label", { for: "photo", class: "visually-hidden" }, "Outfit photo"), chooseBtn, cameraBtn),
      h("p", { id: "photo-rules", class: "small muted", style: { marginTop: "var(--space-4)" } }, `JPEG, PNG or WebP · up to ${formatBytes(MAX_BYTES)} · at least 200px per side`),
    ),
  );

  const previewImg = h("img", { alt: "Preview of the selected outfit photo" });
  const fileMeta = h("span", { class: "file-meta" });
  const preview = h(
    "figure",
    { class: "preview", hidden: true, style: { margin: 0 } },
    previewImg,
    h(
      "figcaption",
      { class: "preview-bar" },
      fileMeta,
      h(
        "span",
        { class: "controls" },
        h("button", { type: "button", class: "btn-link", onclick: () => fileInput.click() }, "Replace"),
        h("button", { type: "button", class: "btn-link", onclick: () => setFile(null) }, "Remove"),
      ),
    ),
  );

  const sampleButtons = [];
  const samplesBlock = samples.length
    ? h(
        "div",
        { class: "samples" },
        h("p", { class: "small muted" }, "No photo handy? Try an outfit from the FitMe dataset:"),
        h(
          "ul",
          {},
          samples.map((sample) => {
            const btn = h(
              "button",
              { type: "button", "aria-pressed": "false", title: sample.label, onclick: () => useSample(sample, btn) },
              h("img", { src: sample.src, alt: sample.alt, loading: "lazy", width: 96, height: 96 }),
            );
            sampleButtons.push(btn);
            return h("li", {}, btn);
          }),
        ),
      )
    : null;

  function revokePreview() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }

  async function setFile(file, { sampleKey = null } = {}) {
    revokePreview();
    state.file = file;
    state.fileError = null;
    state.sampleKey = sampleKey;
    sampleButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === sampleKey)));
    imageError.textContent = "";
    dropzone.classList.remove("invalid");

    if (!file) {
      preview.hidden = true;
      dropzone.hidden = false;
      previewImg.removeAttribute("src");
      fileInput.value = "";
      updateSubmit();
      return;
    }

    const typeError = checkFile(file);
    if (typeError) {
      state.fileError = typeError;
      state.file = null;
      showImageError(typeError);
      return;
    }
    state.previewUrl = URL.createObjectURL(file);
    const { width, height } = await readDimensions(state.previewUrl);
    const dimError = checkDimensions(width, height);
    if (dimError) {
      revokePreview();
      state.file = null;
      state.fileError = dimError;
      showImageError(dimError);
      return;
    }
    previewImg.src = state.previewUrl;
    fileMeta.textContent = `${sampleKey ? `Dataset sample ${sampleKey}` : file.name} · ${width}×${height} · ${formatBytes(file.size)}`;
    preview.hidden = false;
    dropzone.hidden = true;
    updateSubmit();
  }

  function showImageError(message) {
    imageError.textContent = message;
    preview.hidden = true;
    dropzone.hidden = false;
    dropzone.classList.add("invalid");
    fileInput.value = "";
    updateSubmit();
  }

  async function useSample(sample, btn) {
    if (state.busy) return;
    btn.dataset.key = sample.key;
    try {
      const response = await fetch(sample.src);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      await setFile(new File([blob], `dataset-${sample.key}.jpg`, { type: "image/jpeg" }), { sampleKey: sample.key });
    } catch {
      showImageError("That sample couldn't be loaded. Try another one or upload your own photo.");
    }
  }
  sampleButtons.forEach((b, i) => (b.dataset.key = samples[i].key));

  fileInput.addEventListener("change", () => setFile(fileInput.files[0] || null));
  cameraInput.addEventListener("change", () => setFile(cameraInput.files[0] || null));
  for (const type of ["dragenter", "dragover"]) {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    dropzone.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragging");
    });
  }
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) setFile(file);
  });

  // ---------- Brief column ----------
  const occasionError = h("p", { class: "error-text", role: "alert" });
  const occasionInputs = OCCASIONS.map((o) =>
    h("label", { class: "chip" }, h("input", { type: "radio", name: "occasion", value: o.value, required: true }), h("span", {}, o.label)),
  );
  const occasionDetail = textField({ id: "occasion_detail", label: "Describe the occasion", hint: "e.g. gallery opening, job interview" });
  occasionDetail.wrap.hidden = true;

  const preferred = textField({ id: "preferred_style", label: "Preferred style", hint: "e.g. minimal, streetwear, classic" });
  const impression = textField({ id: "desired_impression", label: "Impression you want to make", hint: "e.g. approachable, confident, polished" });
  const context = textField({
    id: "additional_context",
    label: "Anything else?",
    hint: profile?.style_notes ? "Pre-filled from your profile style notes." : "Weather, dress code, pieces you'd like to keep.",
    multiline: true,
    value: (profile?.style_notes || "").slice(0, TEXT_LIMITS.additional_context),
  });
  const textFields = { occasion_detail: occasionDetail, preferred_style: preferred, desired_impression: impression, additional_context: context };

  const formAlert = h("div", { class: "alert", role: "alert", hidden: true });
  const recommendationResults = h("section", {
    class: "recommendation-results",
    hidden: true,
    "aria-live": "polite",
    style: {
      marginTop: "1.5rem",
    },
  });
  const submitBtn = h("button", { type: "submit", class: "btn btn-accent" }, "Analyze outfit");
  const progressFill = h("div", { class: "progress-fill" });
  const progressLabel = h("p", { class: "small muted", "aria-live": "polite" });
  const progress = h("div", { class: "progress", hidden: true }, h("div", { class: "progress-track" }, progressFill), progressLabel);
  const submitHint = h("p", { class: "small muted" });

  const form = h(
    "form",
    { class: "brief", novalidate: true },
    h("div", {}, h("h2", {}, "The brief")),
    h(
      "fieldset",
      { class: "field" },
      h("legend", {}, "Occasion ", h("span", { class: "muted" }, "(required)")),
      h("div", { class: "occasions" }, occasionInputs),
      occasionError,
    ),
    occasionDetail.wrap,
    h(
      "div",
      { class: "optional" },
      h("div", { class: "optional-head" }, h("p", { class: "eyebrow" }, "Preferences"), h("span", { class: "small muted" }, "Optional")),
      preferred.wrap,
      impression.wrap,
      context.wrap,
    ),
    h("div", { class: "submit-row" }, formAlert, submitBtn, progress, submitHint),
  );

  form.addEventListener("change", (e) => {
    if (e.target.name === "occasion") {
      occasionError.textContent = "";
      occasionDetail.wrap.hidden = e.target.value !== "other";
      updateSubmit();
    }
  });

  function selectedOccasion() {
    return form.querySelector("input[name=occasion]:checked")?.value || "";
  }

  
function renderWardrobeRecommendation(result) {
  const outfit = result?.outfit;

  if (!outfit?.top_id || !outfit?.bottom_id) {
    recommendationResults.hidden = true;
    recommendationResults.replaceChildren();
    return false;
  }

  const top = state.wardrobeItems.find(
    (item) =>
      String(item.id) === String(outfit.top_id) &&
      item.category === "top",
  );

  const bottom = state.wardrobeItems.find(
    (item) =>
      String(item.id) === String(outfit.bottom_id) &&
      item.category === "bottom",
  );

  // Pastikan kedua item benar-benar ada di koleksi pengguna.
  if (!top || !bottom) {
    recommendationResults.hidden = true;
    recommendationResults.replaceChildren();
    return false;
  }

  function createClothingCard(item, label) {
    const imageUrl = state.wardrobeImageUrlById[item.id];

    return h(
      "article",
      {
        style: {
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "1rem",
          minWidth: "0",
        },
      },
      h("p", { class: "eyebrow" }, label),
      imageUrl
        ? h("img", {
            src: imageUrl,
            alt: item.name,
            loading: "lazy",
            style: {
              display: "block",
              width: "100%",
              height: "220px",
              objectFit: "cover",
              borderRadius: "8px",
            },
          })
        : h(
            "p",
            { class: "small muted" },
            "Foto pakaian tidak tersedia.",
          ),
      h("h3", {}, item.name),
      item.color
        ? h("p", { class: "small muted" }, `Warna: ${item.color}`)
        : null,
    );
  }

  recommendationResults.replaceChildren(
    h("h2", {}, "Rekomendasi Outfit Kamu"),
    h(
      "p",
      { class: "small muted" },
      "Satu kombinasi pakaian yang dipilih berdasarkan acara dan preferensimu.",
    ),
    h(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
        },
      },
      createClothingCard(top, "ATASAN"),
      createClothingCard(bottom, "BAWAHAN"),
    ),
    h(
      "div",
      {
        style: {
          marginTop: "1rem",
          padding: "1rem",
          border: "1px solid var(--border)",
          borderRadius: "12px",
        },
      },
      h("h3", {}, "Alasan rekomendasi"),
      h(
        "p",
        {},
        typeof outfit.reason === "string" && outfit.reason.trim()
          ? outfit.reason
          : "Tidak ada alasan rekomendasi yang diberikan.",
      ),
    ),
  );

  recommendationResults.hidden = false;
  return true;
}

    function updateSubmit() {
      const missing = [];

      if (state.source === "wardrobe") {
        if (state.wardrobeLoading) {
          missing.push("wardrobe loading to finish");
        } else if (!state.wardrobeItems.length) {
          missing.push("at least one wardrobe item");
        }
      } else if (!state.file) {
        missing.push("a photo");
      }

      if (!selectedOccasion()) {
        missing.push("an occasion");
      }

      const providerBlocked = state.source === "upload" && !providerReady;
      const blocked = providerBlocked || state.busy || missing.length > 0;

      submitBtn.setAttribute("aria-disabled", String(blocked));
      submitBtn.disabled = blocked;

      submitHint.textContent = state.busy
        ? ""
        : providerBlocked
          ? "Upload analysis requires an AI provider."
          : missing.length
            ? `Add ${missing.join(" and ")} to continue.`
            : "";
    }



    function stageTimer() {
      const started = Date.now();
      const id = setInterval(() => {
        const elapsed = Date.now() - started;
        const stage = [...STAGES].reverse().find(([at]) => elapsed >= at);
        progressLabel.textContent = stage[1];
      }, 1000);
      return () => clearInterval(id);
    }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
        if (
      state.busy ||
      (state.source === "upload" && !providerReady)
    ) {
      return;
    }
    formAlert.hidden = true;
    Object.values(textFields).forEach((f) => f.setError(""));
    const fields = Object.fromEntries(Object.entries(textFields).map(([k, f]) => [k, f.control.value]));
    const { valid, errors } = validateBrief({
    file: state.file,
    fileError: state.fileError,
    occasion: selectedOccasion(),
    fields,
    source: state.source,
  });
    if (!valid) {
      if (errors.image) showImageError(errors.image);
      if (errors.occasion) occasionError.textContent = errors.occasion;
      for (const [key, f] of Object.entries(textFields)) if (errors[key]) f.setError(errors[key]);
      (errors.image ? (state.file ? fileInput : chooseBtn) : errors.occasion ? occasionInputs[0].querySelector("input") : form.querySelector("[aria-invalid=true]"))?.focus();
      return;
    }

    
    
    const isWardrobe = state.source === "wardrobe";
    const data = new FormData();

    if (!isWardrobe) {
      data.append("image", state.file, state.file.name);
    }

    data.append("occasion", selectedOccasion());

    for (const [key, value] of Object.entries(fields)) {
      if (key === "occasion_detail" && selectedOccasion() !== "other") {
        continue;
      }

      if (value.trim()) {
        data.append(key, value.trim());
      }
    }


    state.busy = true;
    state.controller = new AbortController();
    form.querySelectorAll("input, textarea").forEach((el) => (el.disabled = true));
    submitBtn.replaceChildren(spinner(), " Analyzing…");
    updateSubmit();
    progress.hidden = false;
    progressFill.classList.remove("indeterminate");
    progressFill.style.width = "0";
    progressLabel.textContent =
    state.source === "wardrobe"
      ? "Preparing wardrobe item…"
      : "Uploading photo…";
    let stopStages = () => {};

    try {
      
const endpoint = isWardrobe
  ? "/api/analyses/wardrobe-recommendation/"
  : "/api/analyses/";

    const result = await upload(endpoint, data, {
      signal: state.controller.signal,

      onProgress: (fraction) => {
        progressFill.style.width = `${Math.round(fraction * 100)}%`;

        progressLabel.textContent = isWardrobe
          ? "Preparing your Digital Wardrobe..."
          : `Uploading photo... ${Math.round(fraction * 100)}%`;
      },

      onUploaded: () => {
        if (isWardrobe) {
          progressFill.style.width = "100%";
          progressFill.classList.remove("indeterminate");
          progressLabel.textContent =
            "Preparing your wardrobe collection...";
        } else {
          progressFill.style.width = "";
          progressFill.classList.add("indeterminate");
          progressLabel.textContent = STAGES[0][1];
        }
      },
    });

    
    if (isWardrobe) {
      const hasRecommendation = renderWardrobeRecommendation(result);

      if (hasRecommendation) {
        formAlert.replaceChildren(
          h("strong", {}, "Rekomendasi outfit berhasil dimuat."),
        );
      } else {
        formAlert.replaceChildren(
          h("strong", {}, "Digital Wardrobe berhasil disiapkan."),
          ` Sebanyak ${result.wardrobe_count} item pakaian berhasil dimuat untuk persiapan rekomendasi. Integrasi AI belum menghasilkan rekomendasi outfit.`,
        );
      }

      formAlert.hidden = false;
    } else {
      ctx.navigate(`/analyses/${result.id}`, {
        state: { analysis: result },
      });
    }


    } catch (error) {
      if (error.name === "AbortError") return;
      if (error instanceof ApiError && error.data?.analysis) {
        // The analysis was stored but the model failed: the result page offers a retry.
        ctx.navigate(`/analyses/${error.data.analysis.id}`, { state: { analysis: error.data.analysis } });
        return;
      }
      const fieldErrors = error.fields || {};
      if (fieldErrors.image) showImageError([].concat(fieldErrors.image).join(" "));
      if (fieldErrors.occasion) occasionError.textContent = [].concat(fieldErrors.occasion).join(" ");
      for (const [key, f] of Object.entries(textFields)) if (fieldErrors[key]) f.setError([].concat(fieldErrors[key]).join(" "));
      if (!Object.keys(fieldErrors).length) {
        formAlert.replaceChildren(h("strong", {}, "The analysis didn't start."), error.message);
        formAlert.hidden = false;
      }
    } finally {
      stopStages();
      if (ctx.isCurrent()) {
        state.busy = false;
        form.querySelectorAll("input, textarea").forEach((el) => (el.disabled = false));
        submitBtn.textContent = "Analyze outfit";
        progress.hidden = true;
        updateSubmit();
      }
    }
  });

  
  ctx.onCleanup(() => {
    state.controller?.abort();
    revokePreview();

    state.wardrobeImageUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });

    state.wardrobeImageUrls = [];
  });


  // ---------- Provider banner ----------
  let banner = null;
  if (!health) {
    banner = h("div", { class: "alert", role: "alert" }, h("strong", {}, "Can't reach the FitMe.ai server."), "Check your connection, then reload the page.");
  } else if (!providerReady) {
    banner = h(
      "div",
      { class: "alert alert-notice", role: "status" },
      h("strong", {}, "Analysis is unavailable right now."),
      "No AI provider is configured. Upload analysis is unavailable, but Digital Wardrobe can prepare your clothing collection.",
    );
  } else if (provider.is_mock) {
    banner = h(
      "div",
      { class: "alert alert-notice", role: "status" },
      h("strong", {}, "Development mock mode."),
      "Results on this server are placeholder fixtures, not Qwen2.5-VL output. Only the dominant colours are measured from your photo.",
    );
  }

  return h(
    "div",
    { class: "page shell" },
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, "Workspace"),
        h("h1", {}, "Analyze an outfit"),
        h("p", {}, providerReady && !provider.is_mock ? `Analysis by ${provider.model} (Qwen2.5-VL).` : "Upload a photo and describe the occasion."),
      ),
      h("a", { href: "/history", class: "small" }, "View history"),
    ),
    banner ? h("div", { style: { marginBottom: "var(--space-6)" } }, banner) : null,
    h(
      "div",
      { class: "workspace" },
      h(
  "section",
  { "aria-label": "Outfit photo" },
  sourceSelector,
  wardrobePanel,
  dropzone,
  preview,
  imageError,
  fileInput,
  cameraInput,
  samplesBlock,
),
            h(
        "section",
        { "aria-label": "Occasion and preferences" },
        form,
        recommendationResults,
      ),
    ),
  );
}

