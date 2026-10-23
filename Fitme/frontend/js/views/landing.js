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
          "Dress for the room you're ",
          h("em", {}, "walking into."),
        ),
        h(
          "p",
          { class: "lede" },
          "Upload an outfit photo or use your Digital Wardrobe, choose an occasion, and explore outfit ideas made for you.",
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
                "Sign in",
              ),
        ),
      ),
      h(
        "div",
        { class: "hero-plates", "aria-label": "Example outfit photos" },
        plate(
          `${S}/0000080.jpg`,
          "Black leather leggings, red suede pumps and a sheer black blouse",
          "Evening",
          "plate-tall",
        ),
        plate(
          `${S}/0000320.jpg`,
          "Rust turtleneck, tweed pencil skirt and tan knee boots",
          "Work",
        ),
        plate(
          `${S}/0000232.jpg`,
          "Red pumps, black leggings and a crimson coat",
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
        h("h2", { id: "how" }, "Outfit ideas in three simple steps."),
      ),
      h(
        "ol",
        { class: "steps" },
        h(
          "li",
          {},
          h("h3", {}, "Choose your clothes"),
          h(
            "p",
            {},
            "Upload an outfit photo or use clothes from your Digital Wardrobe.",
          ),
        ),
        h(
          "li",
          {},
          h("h3", {}, "Tell us your plans"),
          h(
            "p",
            {},
            "Choose the occasion and add the style or impression you want.",
          ),
        ),
        h(
          "li",
          {},
          h("h3", {}, "Explore your outfit ideas"),
          h(
            "p",
            {},
            "See suggestions with clear reasons. Recommendations from your wardrobe use your own clothes and are saved in your history.",
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
        "Black skinny jeans with zip pockets and black suede pointed pumps",
        "Example input",
      ),
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, "What a recommendation looks like"),
        h(
          "h2",
          { id: "example", class: "visually-hidden" },
          "Example recommendation",
        ),
        h(
          "p",
          { class: "ask", style: { marginTop: "var(--space-4)" } },
          "“Help me find a sweater to wear with my skinny black jeans and pumps.”",
        ),
        h(
          "blockquote",
          {},
          "A heather-grey long-sleeved sweater. Ribbed cuffs and a round neck soften the sleek black base while keeping the pumps the focal point.",
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
              "Black skinny jeans with zip pockets; black pointed pumps with a suede-like finish.",
            ),
          ),
          h(
            "div",
            {},
            h("dt", {}, "Alternative"),
            h(
              "dd",
              {},
              "When it's colder, a tan belted double-breasted coat adds structure.",
            ),
          ),
          h(
            "div",
            {},
            h("dt", {}, "Limitation"),
            h(
              "dd",
              {},
              "No top is shown, so the advice can't account for what you'd already layer underneath.",
            ),
          ),
        ),
        h(
          "p",
          {
            class: "small muted",
            style: { marginTop: "var(--space-5)" },
          },
          "Illustrative example adapted from a stylist conversation in the FitMe outfit dataset — not a live model result.",
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
      h("h2", {}, "Have an outfit in mind?"),
      h(
        "a",
        { class: "btn btn-accent", href: primaryHref },
        signedIn ? "Start an analysis" : "Create a free account",
      ),
    ),
  ),
);
}
