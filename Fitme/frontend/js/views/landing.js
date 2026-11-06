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
        h("p", { class: "eyebrow" }, "Outfit analysis · Personal styling"),
        h(
          "h1",
          {},
          "Dress for the ",
          h("em", {}, "occasion."),
        ),
        h(
          "p",
          { class: "lede" },
          "Upload an outfit photo or choose items from your Digital Wardrobe. Select an occasion and discover a look that works for you.",
        ),
        h(
          "div",
          { class: "actions" },
          h(
            "a",
            { class: "btn btn-accent", href: primaryHref },
            "Analyze an outfit",
          ),
          signedIn
            ? h(
                "a",
                { class: "btn btn-ghost", href: "/history" },
                "Your history",
              )
            : h(
                "a",
                { class: "btn btn-ghost", href: "/login" },
                "Log in",
              ),
        ),
      ),
      h(
        "div",
        { class: "hero-plates", "aria-label": "Outfit photo examples" },
        plate(
          `${S}/0000080.jpg`,
          "Black leather leggings, red heels, and a sheer black blouse",
          "Evening",
          "plate-tall",
        ),
        plate(
          `${S}/0000320.jpg`,
          "Rust turtleneck, tweed skirt, and knee-high boots",
          "Work",
        ),
        plate(
          `${S}/0000232.jpg`,
          "Red heels, black leggings, and a red coat",
          "Weekend",
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
        h("p", { class: "eyebrow" }, "How it works"),
        h("h2", { id: "how" }, "Find outfit inspiration in three steps."),
      ),
      h(
        "ol",
        { class: "steps" },
        h(
          "li",
          {},
          h("h3", {}, "Choose an outfit"),
          h(
            "p",
            {},
            "Upload an outfit photo or choose items from your Digital Wardrobe.",
          ),
        ),
        h(
          "li",
          {},
          h("h3", {}, "Tell us about your occasion"),
          h(
            "p",
            {},
            "Choose an occasion and add the style or impression you want to convey.",
          ),
        ),
        h(
          "li",
          {},
          h("h3", {}, "Get your recommendation"),
          h(
            "p",
            {},
            "See styling suggestions and the reasoning behind them. Digital Wardrobe recommendations use your own clothes and are saved to your history.",
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
        "Black jeans with zip pockets and black heels",
        "Photo example",
      ),
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, "Sample recommendation"),
        h(
          "h2",
          { id: "example", class: "visually-hidden" },
          "Sample recommendation",
        ),
        h(
          "p",
          { class: "ask", style: { marginTop: "var(--space-4)" } },
          "“Help me choose a sweater to wear with my black jeans and heels.”",
        ),
        h(
          "blockquote",
          {},
          "A long-sleeved gray sweater. Textured cuffs and a crew neck soften the all-black look while keeping the heels as the focal point.",
        ),
        h(
          "dl",
          {},
          h(
            "div",
            {},
            h("dt", {}, "Seen in the photo"),
            h(
              "dd",
              {},
              "Black jeans with zip pockets; pointed-toe black heels with a suede-like texture.",
            ),
          ),
          h(
            "div",
            {},
            h("dt", {}, "Alternative"),
            h(
              "dd",
              {},
              "For cooler weather, a light brown double-breasted belted coat creates a more polished look.",
            ),
          ),
          h(
            "div",
            {},
            h("dt", {}, "Limitations"),
            h(
              "dd",
              {},
              "The top is not visible, so this suggestion does not account for the layer underneath.",
            ),
          ),
        ),
        h(
          "p",
          {
            class: "small muted",
            style: { marginTop: "var(--space-5)" },
          },
          "Illustrative example adapted from a stylist conversation in the FitMe dataset — not a live AI result.",
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
      h("h2", {}, "Ready to style your outfit?"),
      h(
        "a",
        { class: "btn btn-accent", href: primaryHref },
        signedIn ? "Start analyzing" : "Create a free account",
      ),
    ),
  ),
);
}
