import { h } from "../dom.js";
import { isAuthenticated } from "../session.js";

const S = "/static/assets/samples";

function plate(src, alt, caption, extra = "") {
  return h(
    "figure",
    { class: `plate ${extra}`, style: { margin: 0 } },
    h("img", { src, alt, loading: "eager", width: 512, height: 512 }),
    caption ? h("figcaption", {}, caption) : null,
  );
}

export function renderLanding() {
  const signedIn = isAuthenticated();
  const primaryHref = signedIn ? "/analyze" : "/register";

  return h(
  "div",
  {},
  h(
    "section",
    { class: "hero" },
    h(
      "div",
      { class: "shell" },
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, "Analisis pakaian · Penataan gaya pribadi"),
        h(
          "h1",
          {},
          "Kenakan pakaian yang sesuai dengan ",
          h("em", {}, "acara tujuanmu."),
        ),
        h(
          "p",
          { class: "lede" },
          "Unggah foto pakaian atau gunakan Lemari Digital, pilih acara, lalu temukan inspirasi gaya yang sesuai untukmu.",
        ),
        h(
          "div",
          { class: "actions" },
          h(
            "a",
            { class: "btn btn-accent", href: primaryHref },
            "Analisis pakaian",
          ),
          signedIn
            ? h(
                "a",
                { class: "btn btn-ghost", href: "/history" },
                "Riwayatmu",
              )
            : h(
                "a",
                { class: "btn btn-ghost", href: "/login" },
                "Masuk",
              ),
        ),
      ),
      h(
        "div",
        { class: "hero-plates", "aria-label": "Contoh foto pakaian" },
        plate(
          `${S}/0000080.jpg`,
          "Legging kulit hitam, sepatu hak merah, dan blus hitam transparan",
          "Malam",
          "plate-tall",
        ),
        plate(
          `${S}/0000320.jpg`,
          "Atasan turtleneck warna bata, rok tweed, dan sepatu bot selutut",
          "Kerja",
        ),
        plate(
          `${S}/0000232.jpg`,
          "Sepatu hak merah, legging hitam, dan mantel merah",
          "Akhir pekan",
        ),
      ),
    ),
  ),

  h(
    "section",
    { class: "section", "aria-labelledby": "how" },
    h(
      "div",
      { class: "shell" },
      h(
        "div",
        { class: "section-head" },
        h("p", { class: "eyebrow" }, "Cara kerja"),
        h("h2", { id: "how" }, "Temukan inspirasi pakaian dalam tiga langkah."),
      ),
      h(
        "ol",
        { class: "steps" },
        h(
          "li",
          {},
          h("h3", {}, "Pilih pakaian"),
          h(
            "p",
            {},
            "Unggah foto pakaian atau pilih koleksi dari Lemari Digital.",
          ),
        ),
        h(
          "li",
          {},
          h("h3", {}, "Ceritakan acaramu"),
          h(
            "p",
            {},
            "Pilih acara dan tambahkan gaya atau kesan yang ingin ditampilkan.",
          ),
        ),
        h(
          "li",
          {},
          h("h3", {}, "Lihat rekomendasimu"),
          h(
            "p",
            {},
            "Lihat saran beserta alasannya. Rekomendasi Lemari Digital menggunakan pakaian milikmu dan tersimpan di riwayat.",
          ),
        ),
      ),
    ),
  ),

  h(
    "section",
    { class: "section", "aria-labelledby": "example" },
    h(
      "div",
      { class: "shell example" },
      plate(
        `${S}/0000500.jpg`,
        "Celana jins hitam dengan kantong ritsleting dan sepatu hak hitam",
        "Contoh foto",
      ),
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, "Contoh hasil rekomendasi"),
        h(
          "h2",
          { id: "example", class: "visually-hidden" },
          "Contoh rekomendasi",
        ),
        h(
          "p",
          { class: "ask", style: { marginTop: "var(--space-4)" } },
          "“Bantu pilihkan sweater untuk celana jins hitam dan sepatu hak saya.”",
        ),
        h(
          "blockquote",
          {},
          "Sweater abu-abu berlengan panjang. Manset bertekstur dan kerah bulat memberi sentuhan lembut pada pakaian hitam, sementara sepatu hak tetap menjadi pusat perhatian.",
        ),
        h(
          "dl",
          {},
          h(
            "div",
            {},
            h("dt", {}, "Terlihat di foto"),
            h(
              "dd",
              {},
              "Celana jins hitam dengan kantong ritsleting; sepatu hak hitam berujung lancip dengan tekstur seperti suede.",
            ),
          ),
          h(
            "div",
            {},
            h("dt", {}, "Alternatif"),
            h(
              "dd",
              {},
              "Saat cuaca dingin, mantel cokelat muda berkancing ganda dan berikat pinggang memberi kesan lebih rapi.",
            ),
          ),
          h(
            "div",
            {},
            h("dt", {}, "Batasan"),
            h(
              "dd",
              {},
              "Atasan tidak terlihat, jadi saran ini belum memperhitungkan pakaian yang akan dikenakan sebagai lapisan dalam.",
            ),
          ),
        ),
        h(
          "p",
          {
            class: "small muted",
            style: { marginTop: "var(--space-5)" },
          },
          "Contoh ilustratif yang diadaptasi dari percakapan penata gaya dalam dataset FitMe — bukan hasil AI langsung.",
        ),
      ),
    ),
  ),

  h(
    "section",
    { class: "section cta-band" },
    h(
      "div",
      { class: "shell" },
      h("h2", {}, "Sudah punya pakaian yang ingin dipadukan?"),
      h(
        "a",
        { class: "btn btn-accent", href: primaryHref },
        signedIn ? "Mulai analisis" : "Buat akun gratis",
      ),
    ),
  ),
);
}
