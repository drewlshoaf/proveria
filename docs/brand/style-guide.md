# Proveria — Brand & Style Guide

**For developers, designers, and anyone producing surfaces in the Proveria brand.**

May 2026 · v1

---

## A letter to the developer

Hi —

This guide describes how Proveria should look and feel across everything you build for us — web pages, dashboards, emails, the docs site, the eventual product UI. The aim is to keep all of it pulling in the same direction without making you memorize a manifesto.

The short version: **we are a trust product, so the visual system should feel like one.** That means quiet, deliberate, technical, and confident. Not playful. Not loud. Not start-up-trendy. The closest reference points are documentation sites for serious infrastructure (Stripe docs, Linear, Vercel marketing in its quieter moments, the Anthropic model cards), legal briefs, and well-typeset technical books. We borrow tone from all three.

A few principles that flow from that:

- **One accent, used sparingly.** A single deep teal (`#0D7C7C`) is the only chromatic color in the system. It marks the things you should actually click and the things that are actively in motion. Everything else is white, off-white, or a quiet neutral gray. When the accent shows up, it should feel like a deliberate decision, not decoration.
- **Type carries the design.** Inter at 400 and 500 weight, with tight tracking on headlines, generous line-height on body, and a clear scale. There is no bold weight, no italics for emphasis (italics are only for quoted technical phrasing). The type does the work that color and ornament would do in a less restrained system.
- **No ornament.** No shadows, no gradients, no decorative SVGs, no rounded card corners. Borders are 1px and neutral. Cards are flat. Sections alternate between pure white and a warm off-white (`#FAFAF9`) for rhythm — that's the only "panel" we use.
- **Generous whitespace.** Vertical rhythm is large: 64px / 96px / 128px section padding is typical. The page should breathe. Cramped layouts read as marketing; spacious layouts read as documentation, which is closer to what we are.
- **Monospace is content, not chrome.** We use JetBrains Mono whenever we are showing something the protocol or the system actually produces — a fingerprint, a seal record, a CLI snippet, a verification artifact. Monospace is a signal that "this is the literal thing," not "this is styled to look technical." Don't use mono for decoration.
- **Plain language, precise terms.** Copy across the brand prefers concrete words over abstractions — "seal," "receipt," "fingerprint," "match," "no match." Avoid marketing-ese ("revolutionary," "industry-leading," "best-in-class"). We are credible because we are precise; precision reads as confidence on a trust product. (See the voice section below.)

If a design decision is not covered in this guide, the rule of thumb is: **what would a serious documentation site do?** That is almost always our answer.

— Drew

---

## 1. Brand voice & tone

### What we are

A neutral verification layer. Technical, precise, opinionated about what we do and what we don't, honest about being early. We talk like a senior engineer explaining a system to a peer — clear, specific, no fluff.

### What we are not

A model provider. A data broker. A marketing-led security tool. A consumer-facing brand. We are not trying to be exciting; we are trying to be trustworthy.

### Voice rules

- **Concrete over abstract.** "Seal a 100 MB dataset in ~2-6 seconds" > "lightning-fast performance."
- **Precise over punchy.** "Chunk-level non-membership against a sealed, normalized set" > "prove what isn't in your data" (the second is fine in the hero; the first belongs in the body).
- **Scoped claims, not absolutes.** "Designed so plaintext is not required by the service" > "forecloses misuse."
- **No marketing words.** Avoid: revolutionary, world-class, best-in-class, AI-powered, seamless, frictionless, cutting-edge, next-generation, game-changing.
- **Honesty about early-stage status.** We do not have SOC 2 yet. We say so. That is the brand.
- **Sentence case everywhere.** Headlines, buttons, navigation, eyebrows — all sentence case. Title Case is reserved for proper nouns. (Including button text: "Request early access," not "Request Early Access.")

### Tone register, by surface

| Surface | Register |
| --- | --- |
| Homepage hero | Direct, confident, slightly elevated |
| Product / Security pages | Documentation-like; precise, scoped |
| Solutions pages | Concrete; problem-aware; speaks to a specific buyer |
| Pricing | Plain, declarative, no hedging |
| Error messages and form labels | Polite, exact, short |
| Email and outbound | Warm, short, human; never templated-sounding |

---

## 2. Color

### The palette

The whole system runs on **one accent color** plus a neutral gray scale and two off-white surfaces.

| Token | Value | Use |
| --- | --- | --- |
| `--color-accent` | `#0D7C7C` | Primary buttons, primary links, active nav, in-progress status, brand wordmark, all CTAs. **Nothing else gets color.** |
| `--color-bg` | `#FFFFFF` | Default page background |
| `--color-bg-panel` | `#FAFAF9` | Off-white panel; alternating sections, code blocks |
| `--color-ink` | `#0A0A0A` (`neutral-950`) | Default body text |
| `--color-ink-strong` | `#171717` (`neutral-900`) | Reserved for very strong emphasis (rare) |
| `--color-ink-secondary` | `#525252` (`neutral-600`) | Body lead paragraphs, secondary copy |
| `--color-ink-muted` | `#737373` (`neutral-500`) | Eyebrows, captions, footer text, "Status:" labels |
| `--color-ink-soft` | `#404040` (`neutral-700`) | Mono content, pull-quotes |
| `--color-form-label` | `#262626` (`neutral-800`) | Form labels |
| `--color-border` | `#E5E5E5` (`neutral-200`) | Default rule; section dividers, card outlines |
| `--color-border-input` | `#D4D4D4` (`neutral-300`) | Form input borders |
| `--color-border-focus` | `#404040` (`neutral-700`) | Form input focus |

### Color rules

- **One accent, no exceptions.** Do not introduce a second brand color. If you need a second visual signal (e.g., "in progress" vs. "complete"), use the accent vs. neutral-500 contrast (see `ComplianceStatus`).
- **No status colors.** No red for errors, no green for success, no amber for warnings. Use copy and weight to communicate state. The exception is form-validation, which can use a single muted red (`#B91C1C` / `red-700`) for error message text only — but no error-state background or border tints.
- **The accent never appears as a large fill.** It appears as button background, link text, 2px borders on emphasized cards, and the brand wordmark. A whole accent-colored section or hero would be wrong for this brand.
- **No gradients. Ever.** This is a deliberate brand rule.

---

## 3. Typography

### Families

- **Sans (UI + body):** **Inter** — weights 400 (regular) and 500 (medium). **No 600/700/800.**
- **Mono (artifacts):** **JetBrains Mono** — weight 400 only.

Both are loaded via `next/font/google` and exposed as CSS variables `--font-inter` and `--font-jetbrains-mono`, then plumbed into Tailwind's `--font-sans` and `--font-mono`.

### Scale

The site uses a literal pixel scale (not Tailwind's t-shirt scale). Use these values; do not invent new ones.

| Token | px | Line height | Tracking | Weight | Use |
| --- | --- | --- | --- | --- | --- |
| `--text-display` | 48 (mobile 36) | 1.1 | -0.02em | 500 | H1 — page hero only |
| `--text-h2` | 32 | 1.15 | -0.02em | 500 | Section heading |
| `--text-h3` | 28 | 1.15 | -0.02em | 500 | Pricing tier price, large feature heading |
| `--text-lead` | 20 | 1.5 | normal | 400 | Lead paragraph below an H2; the "subtitle" voice |
| `--text-body` | 16 | 1.75 (`leading-7`) | normal | 400 | Standard body copy |
| `--text-body-tight` | 15 | 1.6 | normal | 400 / 500 | Buttons, list items in cards, secondary copy |
| `--text-form` | 16 | normal | normal | 400 | Form input text |
| `--text-meta` | 14 | 1.5 | normal | 400 | Eyebrows, captions, nav, footer links, "Last updated" |
| `--text-micro` | 12 | normal | wide (0.05em) | 500 | All-caps labels (e.g., "Artifact", "Verification result") |
| `--text-mono` | 14 | 1.5 | normal | 400 | Code blocks, fingerprints, artifacts |

### Type rules

- **Headlines: medium weight (500), never bold.** Inter at 500 with tight tracking does the work.
- **Tight tracking only on headlines.** `letter-spacing: -0.02em` on H1/H2/H3. Body text uses normal tracking.
- **Generous line-height on body.** `line-height: 1.75` (Tailwind's `leading-7`) on 16px body. Don't tighten this.
- **Sentence case everywhere.** See voice rules.
- **No italics for emphasis.** Italics are reserved for quoted technical phrasing (e.g., *"prove inclusion"*) and short reading-aloud cues. Don't use italics for "this is important."
- **No underlines except on hovered links.** Default links are colored, not underlined.
- **The mono font is not a style — it's a signal.** It says "this is a literal artifact." Don't reach for it because it "looks technical."

---

## 4. Layout

### Page frame

- **Max content width:** `1100px`. Centered. `px-6` on small screens; the max-width container handles it on desktop.
- **Section vertical padding:** `py-16` (64px) at minimum; `py-24` (96px) for most marketing sections; `py-32` (128px) for hero and final CTA sections.
- **Alternating sections:** white → `#FAFAF9` → white → `#FAFAF9` … This alternation is the only "structure" the page has visually. It replaces dividers, ornaments, and section icons.

### Header

- Sticky top, `h-14` (56px), white background, 1px bottom border (`--color-border`).
- Left: wordmark in accent color, `font-medium text-[18px]`, points to `/`.
- Right (desktop): nav links `text-[14px] text-neutral-700`, gap `gap-7`. Active nav link gets `font-medium` and accent color.
- Right: primary CTA button ("Request access" or "Request early access") in accent solid.
- Mobile: hamburger menu, full-screen overlay.

### Footer

- White background, 1px top border, `py-16`.
- 4-column grid on desktop (Brand · Product · Solutions · Company & legal), 1 column on mobile.
- Column heading: 16px medium. Links: 14px `neutral-500`.
- Copyright row: 14px `neutral-500`, separated by a 1px top rule, `mt-12 pt-6`.

### Grids

- **Three-column features:** `md:grid-cols-3 gap-10`. Used for the "three reasons" / "three problems" pattern.
- **Two-column cards:** `md:grid-cols-2 gap-6`. Used for use-case cards with a bordered white panel inside an off-white section.
- **Pricing:** `md:grid-cols-3 gap-6`. Featured tier gets a 2px accent border; others get the standard 1px neutral border.

---

## 5. Components

The canonical marketing implementation now lives in the separate
`proveria-corp` repository. The patterns below describe the shared brand
components in design terms.

### Eyebrow

`<Eyebrow>` — a small 14px `neutral-500` label above an H2. Sentence case. Examples: "The problem", "How it works", "Security", "Pricing". This is the only thing that sits above a section heading.

### Headlines

- **H1:** `text-[48px] md:text-[36px-on-mobile] font-medium leading-[1.1] tracking-[-0.02em]`. Used once per page, in the hero.
- **H2:** `text-[32px] font-medium leading-[1.15] tracking-[-0.02em]`. Used as the title of each major section.
- **Section lead paragraph:** Immediately after an H2, the lead paragraph is `text-[20px] leading-[1.5] text-neutral-600`. Width caps at ~720px / ~820px to maintain readable measure.

### Buttons

- **Solid (primary):** accent background, white text, `rounded`, `px-5 py-3`, `text-[15px] font-medium`. Used for primary CTAs ("Request early access", "Request access", "Talk to sales →").
- **Link (secondary):** accent text, no background, `text-[15px] font-medium`. Used for tertiary actions ("See how it works ↓", "Read more →").

The arrow conventions:
- `→` after a forward link
- `↓` after a same-page jump
- `←` rarely; only for explicit "Back" actions

### Cards

- 1px `neutral-200` border, no background change inside white sections; inside off-white sections, cards use white background.
- Padding: `p-8` for content cards, `p-6` for code/artifact blocks.
- **No rounded corners** on cards. The visual rhythm comes from sharp edges.
- **No shadows.** A 2px accent border is the only "emphasis" treatment (used on the featured pricing tier).

### Code blocks

`<CodeBlock>` — `overflow-x-auto whitespace-pre border border-neutral-200 bg-[#FAFAF9] p-4 font-mono text-[14px] leading-6 text-neutral-700`.

Used for: showing a seal record in plain terms, performance benchmarks, CLI output, JSON-looking artifacts.

### Pull quotes

`<PullQuote>` — `border-l-2 pl-6 text-[20px] leading-[1.5] text-neutral-700`. The left border is the accent color. Sparing use — one per page at most.

### Scenario blocks

`<ScenarioBlock>` — used on solutions pages to show a "prompt" and a "verification result" side by side. Each block:

- 1px `neutral-200` border, white background, `p-6`
- "Artifact" and "Verification result" labels in 12px uppercase, wide-tracked, `neutral-500 font-medium`
- The artifact and result are rendered in mono, 14px, `neutral-700`

This is the pattern that makes solutions pages feel concrete rather than abstract.

### Compliance status

`<ComplianceStatus>` — a row pattern used on the Security page. Status text is rendered in mono, and is colored accent when in progress, otherwise `neutral-500`. This is the only place we use the accent for status, and we use it sparingly.

### Forms

- Single column, max-width `480px`, centered.
- Field labels: 14px `neutral-800`, with `mb-2` to its input.
- Inputs / selects: `h-11 w-full rounded border border-neutral-300 px-3 text-[16px] outline-none focus:border-neutral-700`.
- Submit button: full-width, accent solid, `mt-2`.
- Required indicator: a trailing ` *` in the label.

---

## 6. Iconography & imagery

- **No decorative icons.** No icon library. The brand does not use icons to label features.
- **No stock photography.** No people-in-an-office images, no abstract gradients, no rendered "data" visuals.
- **No product screenshots in marketing pages** until the managed UI is actually shippable. Where a screenshot would go, render a CodeBlock or a ScenarioBlock with real-looking output instead.
- **Diagrams**, when needed, should be simple, monochrome, and feel hand-drawn or technical-paper-style. Black lines on white. No drop shadows, no 3D.

---

## 7. Motion

- **None on first load.** No hero animations, no scroll-triggered reveals, no loading spinners on full-page navigations.
- **Hover transitions:** standard 150ms ease on links and buttons. Color shifts only — no scale, no transform.
- **Form interactions:** the focus border change on inputs is the only state animation.
- **Mobile menu:** open/close is instant or a brief opacity fade, no slide-from-side.

The brand's motion philosophy is the same as its visual one: do less.

---

## 8. Don't list

A short list of things that would feel off-brand if you saw them on the site:

- A second brand color
- Bold (700) or extra-bold (800) text anywhere
- Italics used for general emphasis
- A gradient (background, button, or text)
- A drop shadow on any element
- Rounded card corners (large radii)
- An icon next to a list item
- A stock photo of any kind
- An animated hero or marquee
- "Trusted by [logos]" carousel until we actually have logos to put there
- All-caps for anything other than the 12px micro labels
- A button with anything other than the accent color
- Emoji in marketing copy
- The wordmark in any color other than the accent

---

## 9. Drop-in tokens (CSS)

A standalone CSS file with the design tokens is included at [brand-tokens.css](./brand-tokens.css). Drop it into any non-Tailwind project to inherit the look. For the current marketing app implementation, see the separate `proveria-corp` repository.

---

## 10. When in doubt

Ask: *"Would a serious documentation site do this?"*

If the answer is yes, ship it.
If the answer is "documentation sites don't have this," delete it.
If the answer is no, find the documentation-site version of the same idea.
