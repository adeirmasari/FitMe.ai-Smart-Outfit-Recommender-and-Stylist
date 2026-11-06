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

const WARDROBE_UPLOAD_LABEL = "Mengirim koleksi pakaian…";

function readDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    img.onerror = () =>
      resolve({
        width: 0,
        height: 0,
      });
    img.src = url;
  });
}

function textField({
  id,
  label,
  hint,
  multiline = false,
  value = "",
}) {
  const limit = TEXT_LIMITS[id];

  const control = multiline
    ? h("textarea", {
        id,
        name: id,
        maxlength: limit,
        rows: 3,
        "aria-describedby": `${id}-hint ${id}-count`,
      })
    : h("input", {
        id,
        name: id,
        type: "text",
        maxlength: limit,
        "aria-describedby": `${id}-hint ${id}-count`,
      });

  control.value = value;

  const count = h("span", {
    id: `${id}-count`,
    class: "counter",
    "aria-live": "off",
  });

  const error = h("p", {
    class: "error-text",
    hidden: true,
  });

  const update = () => {
    count.textContent = `${control.value.length}/${limit}`;
  };

  control.addEventListener("input", update);
  update();

  const wrap = h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    control,
    h(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
        },
      },
      h("p", { id: `${id}-hint`, class: "hint" }, hint),
      count,
    ),
    error,
  );

  return {
    wrap,
    control,
    setError(text) {
      error.hidden = !text;
      error.textContent = text || "";
      control.setAttribute(
        "aria-invalid",
        text ? "true" : "false",
      );
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
    wardrobeItems: [],
    wardrobeImageUrls: [],
    wardrobeLoading: false,
    wardrobeLoaded: false,
    wardrobeError: null,
  };

  const [health, samples] = await Promise.all([
    request("/api/health/", { auth: false }).catch(() => null),
    fetch("/static/assets/samples/samples.json")
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => []),
  ]);

  const provider = health?.ai_provider;
  const providerReady = Boolean(provider?.configured);

  const sourceUploadBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-accent",
      "aria-pressed": "true",
      onclick: () => switchSource("upload"),
    },
    "Unggah foto baru",
  );

  const sourceWardrobeBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      "aria-pressed": "false",
      onclick: () => switchSource("wardrobe"),
    },
    "Lemari digital",
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
    {
      class: "small muted",
      role: "status",
    },
    "Koleksi pakaian akan ditampilkan di sini.",
  );

  const wardrobeGrid = h("div", {
    class: "wardrobe-grid",
  });

  wardrobePanel.append(
    wardrobeStatus,
    wardrobeGrid,
  );

  async function loadWardrobe() {
    if (state.wardrobeLoading || state.wardrobeLoaded) {
      return;
    }

    state.wardrobeLoading = true;
    state.wardrobeError = null;

    wardrobeStatus.textContent = "Memuat koleksi pakaian...";
    wardrobeGrid.replaceChildren();

    try {
      const response = await request(
        "/api/wardrobe/?page_size=50",
      );

      const items = Array.isArray(response)
        ? response
        : response.results || [];

      state.wardrobeItems = items;
      state.wardrobeLoaded = true;

      if (items.length === 0) {
        wardrobeStatus.textContent =
          "Koleksi masih kosong. Tambahkan pakaian terlebih dahulu di Lemari Digital.";
        return;
      }

      const hasTop = items.some((item) => item.category === "top");
      const hasBottom = items.some((item) => item.category === "bottom");
      wardrobeStatus.textContent = hasTop && hasBottom
        ? `${items.length} pakaian tersimpan. Rekomendasi akan dibuat dari koleksi ini.`
        : "Tambahkan minimal satu atasan dan satu bawahan di Lemari Digital untuk membuat rekomendasi.";

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
            h(
              "p",
              { class: "small muted" },
              item.category_label || item.category,
            ),
            item.color
              ? h(
                  "p",
                  { class: "small muted" },
                  `Warna: ${item.color}`,
                )
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
      wardrobeStatus.replaceChildren(
        state.wardrobeError,
        h(
          "button",
          {
            type: "button",
            class: "btn-link",
            onclick: () => {
              state.wardrobeLoaded = false;
              loadWardrobe();
            },
          },
          "Coba muat lagi",
        ),
      );
    } finally {
      state.wardrobeLoading = false;
      updateSubmit();
    }
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
    photoRules.hidden = !useUpload;
    imageError.hidden = !useUpload || !state.fileError;

    if (samplesBlock) samplesBlock.hidden = !useUpload;
    if (!useUpload) loadWardrobe();
    updateSubmit();
  }

  // Kolom foto
  const fileInput = h("input", {
    type: "file",
    id: "photo",
    accept: [
      ...ACCEPTED_TYPES,
      ...ACCEPTED_EXTENSIONS,
    ].join(","),
    class: "visually-hidden",
    "aria-describedby": "photo-rules photo-error",
  });

  const cameraInput = h("input", {
    type: "file",
    accept: "image/*",
    capture: "environment",
    class: "visually-hidden",
    tabindex: "-1",
    "aria-hidden": "true",
  });

  const imageError = h("p", {
    id: "photo-error",
    class: "error-text",
    role: "alert",
    hidden: true,
  });

  const hasCamera =
    window.matchMedia("(pointer: coarse)").matches;

  const chooseBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => fileInput.click(),
    },
    "Pilih foto",
  );

  const cameraBtn = hasCamera
    ? h(
        "button",
        {
          type: "button",
          class: "btn btn-ghost",
          onclick: () => cameraInput.click(),
        },
        "Ambil foto",
      )
    : null;

  const dropzone = h(
    "div",
    { class: "dropzone" },
    h(
      "div",
      {},
      h("h2", {}, "Tambahkan foto pakaian"),
      h(
        "p",
        { class: "muted" },
        hasCamera
          ? "Pilih foto dari galeri atau gunakan kamera."
          : "Seret foto ke sini atau pilih dari perangkat.",
      ),
      h(
        "div",
        { class: "picker" },
        h(
          "label",
          {
            for: "photo",
            class: "visually-hidden",
          },
          "Foto pakaian",
        ),
        chooseBtn,
        cameraBtn,
      ),
    ),
  );

  const photoRules = h(
    "p",
    {
      id: "photo-rules",
      class: "small muted",
      style: { marginTop: "var(--space-3)" },
    },
    `Aturan foto: JPEG, PNG, atau WebP · maksimal ${formatBytes(MAX_BYTES)} · minimal 200 piksel pada setiap sisi.`,
  );

  const previewImg = h("img", {
    alt: "Pratinjau foto pakaian yang dipilih",
  });

  const fileMeta = h("span", {
    class: "file-meta",
  });

  const preview = h(
    "figure",
    {
      class: "preview",
      hidden: true,
      style: {
        margin: 0,
      },
    },
    previewImg,
    h(
      "figcaption",
      { class: "preview-bar" },
      fileMeta,
      h(
        "span",
        { class: "controls" },
        h(
          "button",
          {
            type: "button",
            class: "btn-link",
            onclick: () => fileInput.click(),
          },
          "Ganti foto",
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn-link",
            onclick: () => setFile(null),
          },
          "Hapus foto",
        ),
      ),
    ),
  );

  const sampleButtons = [];

  const samplesBlock = samples.length
    ? h(
        "div",
        { class: "samples" },
        h(
          "p",
          { class: "small muted" },
          "Belum punya foto? Coba salah satu contoh pakaian:",
        ),
        h(
          "ul",
          {},
          samples.map((sample) => {
            const btn = h(
              "button",
              {
                type: "button",
                "aria-pressed": "false",
                title: sample.label,
                onclick: () => useSample(sample, btn),
              },
              h("img", {
                src: sample.src,
                alt: sample.alt,
                loading: "lazy",
                width: 96,
                height: 96,
              }),
            );

            sampleButtons.push(btn);

            return h("li", {}, btn);
          }),
        ),
      )
    : null;

  function revokePreview() {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
    }
    state.previewUrl = null;
  }

  async function setFile(file, { sampleKey = null } = {}) {
    if (state.busy) return;
    revokePreview();

    state.file = file;
    state.fileError = null;
    state.sampleKey = sampleKey;

    sampleButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.key === sampleKey),
      );
    });

    clearImageError();

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

    const { width, height } = await readDimensions(
      state.previewUrl,
    );

    const dimError = checkDimensions(width, height);

    if (dimError) {
      revokePreview();
      state.file = null;
      state.fileError = dimError;
      showImageError(dimError);
      return;
    }

    previewImg.src = state.previewUrl;
    fileMeta.textContent =
      `${sampleKey ? `Contoh dataset ${sampleKey}` : file.name} · ` +
      `${width}×${height} · ${formatBytes(file.size)}`;

    preview.hidden = false;
    dropzone.hidden = true;
    updateSubmit();
  }

  function clearImageError() {
    imageError.replaceChildren();
    imageError.hidden = true;
    dropzone.classList.remove("invalid");
    dropzone.removeAttribute("aria-invalid");
  }

  /** Pesan error selalu tampil di kolom foto, tepat di bawah dropzone. */
  function showImageError(message, { focus = false } = {}) {
    imageError.replaceChildren(message);
    revealImageError(focus);
  }

  /** Foto ditolak karena isinya bukan pakaian: tampilkan alasan dan arahan ganti foto. */
  function showImageRejection({ message, reason, guidance }) {
    revokePreview();
    state.file = null;
    state.fileError = message || "Foto ditolak karena tidak terdeteksi sebagai pakaian.";
    state.sampleKey = null;
    sampleButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    previewImg.removeAttribute("src");

    imageError.replaceChildren(
      h("strong", { style: { display: "block" } }, message || "Foto ditolak karena tidak terdeteksi sebagai pakaian."),
      reason ? h("span", { style: { display: "block" } }, `Alasan: ${reason}`) : null,
      h(
        "span",
        { style: { display: "block", marginTop: "var(--space-2)" } },
        guidance || "Ganti dengan foto yang menampilkan pakaian atau outfit secara jelas.",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn",
          style: { marginTop: "var(--space-3)" },
          onclick: () => fileInput.click(),
        },
        "Ganti foto",
      ),
    );
    revealImageError(true);
  }

  function revealImageError(focus) {
    imageError.hidden = false;
    preview.hidden = true;
    dropzone.hidden = false;
    dropzone.classList.add("invalid");
    dropzone.setAttribute("aria-invalid", "true");
    fileInput.value = "";
    updateSubmit();
    if (focus) {
      imageError.scrollIntoView({ behavior: "smooth", block: "center" });
      chooseBtn.focus({ preventScroll: true });
    }
  }

  async function useSample(sample, btn) {
    if (state.busy) {
      return;
    }

    btn.dataset.key = sample.key;

    try {
      const response = await fetch(sample.src);

      if (!response.ok) {
        throw new Error();
      }

      const blob = await response.blob();

      await setFile(
        new File(
          [blob],
          `dataset-${sample.key}.jpg`,
          { type: "image/jpeg" },
        ),
        { sampleKey: sample.key },
      );
    } catch {
      showImageError(
        "Contoh foto tidak dapat dimuat. Coba contoh lain atau unggah foto sendiri.",
      );
    }
  }

  sampleButtons.forEach((button, index) => {
    button.dataset.key = samples[index].key;
  });

  fileInput.addEventListener("change", () => {
    setFile(fileInput.files[0] || null);
  });

  cameraInput.addEventListener("change", () => {
    setFile(cameraInput.files[0] || null);
  });

  for (const type of ["dragenter", "dragover"]) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  }

  for (const type of ["dragleave", "drop"]) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
    });
  }

  dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];

    if (file) {
      setFile(file);
    }
  });

  // Kolom acara dan preferensi
  const occasionError = h("p", {
    class: "error-text",
    role: "alert",
  });

  const occasionInputs = OCCASIONS.map((occasion) =>
    h(
      "label",
      { class: "chip" },
      h("input", {
        type: "radio",
        name: "occasion",
        value: occasion.value,
        required: true,
      }),
      h("span", {}, occasion.label),
    ),
  );

  const occasionDetail = textField({
    id: "occasion_detail",
    label: "Jelaskan acara",
    hint: "Contoh: pembukaan galeri, wawancara kerja",
  });

  occasionDetail.wrap.hidden = true;

  const preferred = textField({
    id: "preferred_style",
    label: "Gaya yang disukai",
    hint: "Contoh: minimalis, streetwear, klasik",
  });

  const impression = textField({
    id: "desired_impression",
    label: "Kesan yang ingin ditampilkan",
    hint: "Contoh: ramah, percaya diri, rapi",
  });

  const context = textField({
    id: "additional_context",
    label: "Catatan tambahan",
    hint: profile?.style_notes
      ? "Terisi dari catatan gaya di profil."
      : "Cuaca, aturan berpakaian, atau pakaian yang ingin tetap digunakan.",
    multiline: true,
    value: (profile?.style_notes || "").slice(
      0,
      TEXT_LIMITS.additional_context,
    ),
  });

  const textFields = {
    occasion_detail: occasionDetail,
    preferred_style: preferred,
    desired_impression: impression,
    additional_context: context,
  };

  const formAlert = h("div", {
    class: "alert form-alert",
    role: "alert",
    hidden: true,
  });

  const submitBtn = h(
    "button",
    {
      type: "submit",
      class: "btn btn-accent",
    },
    "Buat rekomendasi",
  );

  const progressFill = h("div", {
    class: "progress-fill",
  });

  const progressLabel = h("p", {
    class: "small muted",
    "aria-live": "polite",
  });

  const progress = h(
    "div",
    {
      class: "progress",
      hidden: true,
    },
    h(
      "div",
      { class: "progress-track" },
      progressFill,
    ),
    progressLabel,
  );

  const submitHint = h("p", {
    class: "small muted",
  });

  const form = h(
    "form",
    {
      class: "brief",
      novalidate: true,
    },
    h(
      "div",
      {},
      h("h2", {}, "Detail kebutuhan"),
    ),
    h(
      "fieldset",
      { class: "field" },
      h(
        "legend",
        {},
        "Acara ",
        h("span", { class: "muted" }, "(wajib)"),
      ),
      h(
        "div",
        { class: "occasions" },
        occasionInputs,
      ),
      occasionError,
    ),
    occasionDetail.wrap,
    h(
      "div",
      { class: "optional" },
      h(
        "div",
        { class: "optional-head" },
        h("p", { class: "eyebrow" }, "Preferensi"),
        h("span", { class: "small muted" }, "Opsional"),
      ),
      preferred.wrap,
      impression.wrap,
      context.wrap,
    ),
    h(
      "div",
      { class: "submit-row" },
      formAlert,
      submitBtn,
      progress,
      submitHint,
    ),
  );

  form.addEventListener("change", (event) => {
    if (event.target.name === "occasion") {
      const isOther = event.target.value === "other";
      occasionError.textContent = "";
      occasionDetail.wrap.hidden = !isOther;
      // Detail hanya berlaku untuk "Other"; error lama tidak relevan lagi.
      if (!isOther) occasionDetail.setError("");
      updateSubmit();
    }
  });

  function selectedOccasion() {
    return (
      form.querySelector(
        "input[name=occasion]:checked",
      )?.value || ""
    );
  }

  function updateSubmit() {
    const missing = [];
    let wardrobeNotReady = false;

    if (state.source === "wardrobe") {
      if (state.wardrobeLoading) {
        missing.push("koleksi selesai dimuat");
        wardrobeNotReady = true;
      } else if (
        !state.wardrobeItems.some((item) => item.category === "top") ||
        !state.wardrobeItems.some((item) => item.category === "bottom")
      ) {
        missing.push("minimal satu atasan dan satu bawahan di Lemari Digital");
        wardrobeNotReady = true;
      }
    } else if (!state.file) {
      missing.push("foto");
    }

    if (!selectedOccasion()) {
      missing.push("acara");
    }

    const providerBlocked =
      !providerReady ||
      (
        state.source === "wardrobe" &&
        provider?.name !== "gemini"
      );

    // Foto atau acara yang belum dipilih tidak mengunci tombol: saat
    // ditekan, validasi menampilkan pesan di kolom yang bersangkutan.
    const blocked =
      providerBlocked ||
      state.busy ||
      wardrobeNotReady;

    submitBtn.setAttribute(
      "aria-disabled",
      String(blocked),
    );
    submitBtn.disabled = blocked;

    submitHint.textContent = state.busy
      ? ""
      : providerBlocked
        ? state.source === "wardrobe"
          ? "Layanan AI untuk rekomendasi Lemari Digital belum tersedia."
          : "Layanan AI belum tersedia untuk menganalisis foto."
        : missing.length
          ? `Lengkapi ${missing.join(" dan ")} untuk melanjutkan.`
          : "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (
      state.busy ||
      !providerReady ||
      (
        state.source === "wardrobe" &&
        provider?.name !== "gemini"
      )
    ) {
      return;
    }

    formAlert.hidden = true;

    Object.values(textFields).forEach((field) => {
      field.setError("");
    });

    const fields = Object.fromEntries(
      Object.entries(textFields).map(
        ([key, field]) => [
          key,
          field.control.value,
        ],
      ),
    );

    const { valid, errors } = validateBrief({
      file: state.file,
      fileError: state.fileError,
      occasion: selectedOccasion(),
      fields,
      source: state.source,
    });

    if (!valid) {
      if (errors.image) {
        showImageError(errors.image, { focus: true });
      }

      if (errors.occasion) {
        occasionError.textContent =
          errors.occasion;
      }

      for (const [key, field] of Object.entries(
        textFields,
      )) {
        if (errors[key]) {
          field.setError(errors[key]);
        }
      }

      const fieldToFocus = errors.image
        ? chooseBtn
        : errors.occasion
          ? occasionInputs[0].querySelector("input")
          : form.querySelector("[aria-invalid=true]");

      fieldToFocus?.focus();
      return;
    }

    const data = new FormData();

    const isWardrobe = state.source === "wardrobe";

    if (!isWardrobe) {
      data.append("image", state.file, state.file.name);
    }

    data.append(
      "occasion",
      selectedOccasion(),
    );

    for (const [key, value] of Object.entries(fields)) {
      if (
        key === "occasion_detail" &&
        selectedOccasion() !== "other"
      ) {
        continue;
      }

      if (value.trim()) {
        data.append(
          key,
          value.trim(),
        );
      }
    }

    state.busy = true;
    state.controller = new AbortController();

    fileInput.disabled = true;
    cameraInput.disabled = true;
    chooseBtn.disabled = true;
    sourceUploadBtn.disabled = true;
    sourceWardrobeBtn.disabled = true;
    preview.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    sampleButtons.forEach((button) => {
      button.disabled = true;
    });

    form
      .querySelectorAll("input, textarea")
      .forEach((element) => {
        element.disabled = true;
      });

    submitBtn.replaceChildren(
      spinner(),
      " Menganalisis…",
    );

    updateSubmit();

    progress.hidden = false;
    progressFill.classList.remove(
      "indeterminate",
    );
    progressFill.style.width = "0";

    progressLabel.textContent = isWardrobe
      ? "Menyiapkan koleksi pakaian…"
      : "Mengunggah foto…";

    try {
      const result = await upload(
        isWardrobe
          ? "/api/analyses/wardrobe-recommendation/"
          : "/api/analyses/",
        data,
        {
          signal: state.controller.signal,

          onProgress: (fraction) => {
            progressFill.style.width =
              `${Math.round(fraction * 100)}%`;

            progressLabel.textContent = isWardrobe
              ? WARDROBE_UPLOAD_LABEL
              : `Mengunggah foto... ${Math.round(fraction * 100)}%`;
          },

          onUploaded: () => {
            progressFill.style.width = "";
            progressFill.classList.add(
              "indeterminate",
            );

            progressLabel.textContent = isWardrobe
              ? "AI sedang menyusun kombinasi pakaian. Proses dapat memerlukan waktu hingga dua menit."
              : "AI sedang menganalisis foto. Proses dapat memerlukan waktu hingga dua menit.";
          },
        },
      );

      ctx.navigate(
        `/analyses/${result.id}`,
        {
          state: {
            analysis: result,
          },
        },
      );
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }

      if (
        error instanceof ApiError &&
        error.data?.analysis
      ) {
        // Analisis gagal di AI, tetapi datanya sudah
        // tersimpan dan dapat dibuka untuk dicoba ulang.
        ctx.navigate(
          `/analyses/${error.data.analysis.id}`,
          {
            state: {
              analysis: error.data.analysis,
            },
          },
        );
        return;
      }

      const fieldErrors = error.fields || {};

      if (error.code === "image_not_clothing") {
        const info = error.data?.error || {};
        showImageRejection({
          message: error.message,
          reason: info.reason,
          guidance: info.guidance,
        });
      } else if (fieldErrors.image) {
        const message = [].concat(fieldErrors.image).join(" ");
        revokePreview();
        state.file = null;
        state.fileError = message;
        previewImg.removeAttribute("src");
        showImageError(message, { focus: true });
      }

      if (fieldErrors.occasion) {
        occasionError.textContent =
          [].concat(fieldErrors.occasion).join(" ");
      }

      for (const [key, field] of Object.entries(
        textFields,
      )) {
        if (fieldErrors[key]) {
          field.setError(
            [].concat(fieldErrors[key]).join(" "),
          );
        }
      }

      if (!Object.keys(fieldErrors).length) {
        const code = error.code || "error";
        const heading = code === "network_error"
          ? "Koneksi ke server terputus."
          : code === "timeout"
            ? "Respons terlalu lama."
            : code === "provider_not_configured"
              ? "Layanan AI belum tersedia."
              : "Analisis belum dapat dimulai.";
        const message = code === "network_error"
          ? "Periksa koneksi internet, lalu coba lagi."
          : code === "timeout"
            ? "Periksa Riwayat terlebih dahulu. Jika hasil belum muncul, kirim ulang analisis."
            : error.message;
        const actions = [];

        if (code === "provider_not_configured") {
          actions.push(h(
            "button",
            {
              type: "button",
              class: "btn btn-ghost",
              onclick: () => ctx.navigate("/analyze", { replace: true }),
            },
            "Periksa status AI",
          ));
        } else {
          actions.push(h(
            "button",
            {
              type: "button",
              class: "btn btn-ghost",
              onclick: () => form.requestSubmit(),
            },
            "Coba lagi",
          ));
          if (code === "timeout") {
            actions.push(h(
              "a",
              { class: "btn btn-ghost", href: "/history" },
              "Buka Riwayat",
            ));
          }
        }

        formAlert.replaceChildren(
          h("strong", {}, heading),
          message,
          h("div", { class: "alert-actions" }, actions),
        );
        formAlert.hidden = false;
      }
    } finally {
      if (ctx.isCurrent()) {
        state.busy = false;

        form
          .querySelectorAll("input, textarea")
          .forEach((element) => {
            element.disabled = false;
          });

        fileInput.disabled = false;
        cameraInput.disabled = false;
        chooseBtn.disabled = false;
        sourceUploadBtn.disabled = false;
        sourceWardrobeBtn.disabled = false;
        preview.querySelectorAll("button").forEach((button) => {
          button.disabled = false;
        });
        sampleButtons.forEach((button) => {
          button.disabled = false;
        });

        submitBtn.textContent = "Buat rekomendasi";
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

  // Informasi status AI
  let banner = null;
  const checkServiceButton = h(
    "button",
    {
      type: "button",
      class: "btn btn-ghost",
      onclick: () => ctx.navigate("/analyze", { replace: true }),
    },
    "Periksa lagi",
  );

  if (!health) {
    banner = h(
      "div",
      {
        class: "alert",
        role: "alert",
      },
      h(
        "strong",
        {},
        "Tidak dapat terhubung ke server FitMe.ai.",
      ),
      "Periksa koneksi internet, lalu muat ulang halaman.",
      h("div", { class: "alert-actions" }, checkServiceButton),
    );
  } else if (!providerReady) {
    banner = h(
      "div",
      {
        class: "alert alert-notice",
        role: "status",
      },
      h(
        "strong",
        {},
        "Layanan AI belum tersedia.",
      ),
      "AI belum dikonfigurasi, sehingga analisis foto dan rekomendasi Lemari Digital belum dapat dibuat.",
      h("div", { class: "alert-actions" }, checkServiceButton),
    );
  } else if (provider.is_mock) {
    banner = h(
      "div",
      {
        class: "alert alert-notice",
        role: "status",
      },
      h(
        "strong",
        {},
        "Mode data uji aktif.",
      ),
      "Hasil di server ini adalah data uji, bukan rekomendasi dari AI.",
    );
  }

  loadWardrobe();

  return h(
    "div",
    {
      class: "page shell",
    },
    h(
      "div",
      {
        class: "page-head",
      },
      h(
        "div",
        {},
        h(
          "p",
          { class: "eyebrow" },
          "Ruang analisis",
        ),
        h(
          "h1",
          {},
          "Analisis pakaian",
        ),
        h(
          "p",
          {},
          providerReady && !provider.is_mock
            ? `Analisis menggunakan ${provider.model}.`
            : "Unggah foto atau pilih pakaian dari Lemari Digital, lalu tentukan acaranya.",
        ),
      ),
      h(
        "a",
        {
          href: "/history",
          class: "small",
        },
        "Lihat riwayat",
      ),
    ),
    banner
      ? h(
          "div",
          {
            style: {
              marginBottom: "var(--space-6)",
            },
          },
          banner,
        )
      : null,
    h(
      "div",
      {
        class: "workspace",
      },
      h(
        "section",
        {
          "aria-label": "Foto pakaian",
        },
        sourceSelector,
        wardrobePanel,
        dropzone,
        preview,
        photoRules,
        imageError,
        fileInput,
        cameraInput,
        samplesBlock,
      ),
      h(
        "section",
        {
          "aria-label": "Acara dan preferensi",
        },
        form,
      ),
    ),
  );
}