# Trusted Model — Corporate Website Copy Guide

**Audience:** writers, designers, and anyone editing copy on `apps/corp`.
**Companion documents:** [docs/style-guide.md](./style-guide.md) (visual + voice), `apps/corp/components/site.tsx` (component truth).
**Last synced:** May 2026.

This guide inventories every page on the corporate site (`apps/corp/app`) and the copy it ships with. Use it as a single source of truth when restructuring navigation, drafting new sections, or auditing voice across the surface.

---

## 0. Voice & terminology checklist

These rules govern every string below. Cribbed from `docs/style-guide.md` § 1 and the project memory.

- **Sentence case everywhere.** H1s, H2s, eyebrows, buttons, nav links. "Request early access," never "Request Early Access."
- **One accent color, used sparingly.** Wordmark, links, primary buttons. Nothing else.
- **Plain, concrete words.** *seal · receipt · fingerprint · match · no-match · snapshot · seal record*. Avoid *revolutionary, frictionless, AI-powered, best-in-class*.
- **Scoped claims.** "Designed so plaintext is not required" beats "forecloses misuse." Always name protocol scope when proving something.
- **No marketing italics.** Italics are only for short quoted phrases.
- **Honest early-stage status.** We do not have SOC 2. We say so on Security and Trust.
- **Provenance v2 vocab.** The unit of commitment is a **Project / Snapshot** (depending on surface), never a *Batch* or *Model*. On consumer-facing pages today the active surface still uses *snapshot* and *seal*; if you're touching v2 Provenance copy, default to *Project*.
- **The protocol returns, not the service.** "The protocol returns one of four outcomes" beats "the service returns…"
- **Never anchor pricing on "free."** Say "run the open-source reference stack" instead.
- **Email signoff conventions.** Public address is `hello@trustedmodel.dev`; sales is `sales@`, security is `security@`, trust/procurement is `trust@`, privacy is `privacy@`, legal is `legal@`, founder is `drew@`.

---

## 1. Global chrome

Lives in [apps/corp/components/site.tsx](../apps/corp/components/site.tsx).

### Header (default)

- Wordmark (left): **Trusted Model** → `/`
- Nav (right, in order):
  - **Product** → `/product`
  - **Solutions** (dropdown — see `components/solutions-dropdown.tsx`)
  - **Pricing** → `/pricing`
  - **Security** → `/security`
- Primary CTA button: **Request access** → `/access`
- Mobile: hamburger → `<MobileMenu />`

### Header (compact, used on `/access`)

- Wordmark (left): **Trusted Model** → `/`
- Right-side link: **Back to trustedmodel.dev** → `/`

### Footer (default)

Four columns. Headings are 16px medium; links are 14px neutral-500.

**Column 1 — Trusted Model**
- Heading: *Trusted Model*
- Body: *Cryptographic corpus commitment and verification.*

**Column 2 — Product**
- Overview → `/product`
- Protocol spec → `/product/protocol-spec`
- Producer + consumer CLIs → `/product/cli`
- API reference → `/product/api`
- Pricing → `/pricing`
- Security → `/security`
- Trust → `/trust`

**Column 3 — Solutions**
- Training data integrity → `/solutions/training-data`
- Legal & IP → `/solutions/legal-ip`
- Research provenance → `/solutions/research-provenance`
- Journalism & publishing → `/solutions/journalism`
- Regulators & auditors → `/solutions/regulators`
- Docs → `/docs`

**Column 4 — Company & legal**
- About → `/about`
- Contact → `/contact`
- Request access → `/access`
- Privacy → `/legal/privacy`
- Terms → `/legal/terms`
- DPA → `/legal/dpa`
- hello@trustedmodel.dev → `mailto:`

Copyright row: **© 2026 Trusted Model. All rights reserved.**

### Footer (compact, used on `/access`)

Two columns.

**Column 1 — Trusted Model / Cryptographic corpus commitment and verification.**

**Column 2 — Company**
- About → `/about`
- Contact → `/contact`
- hello@trustedmodel.dev

Copyright row: same as default.

### Request form (`<RequestForm />`)

Used on `/` and `/access`. Single column, max-width 480px.

| Field | Type | Required | Options |
| --- | --- | --- | --- |
| Work email * | email | yes | — |
| Organization * | text | yes | — |
| Role * | select | yes | ML / AI research lead · Data / platform engineer · Legal / IP counsel · Security / compliance · Other |
| What's prompting your interest? | text | no | — |

Submit button label: **Request early access**.
Hidden subject: `Trusted Model — early access request`.
Posts to web3forms.

### Standard CTA labels (used across pages)

- **Request early access** — primary CTA on most marketing pages; routes to `/access` or the `#request-access` anchor.
- **Request access** — used on `/pricing` and the header.
- **Talk to sales →** — secondary, routes to `/contact`.
- **Talk to us →** / **Talk to us** — softer secondary; used on `/regulators` and `/docs`.
- **Read more →** — for "Use cases" cards on `/`.
- **See how it works ↓** — anchor jump on `/`.
- **Read the full architecture →** — `/` → `/product`.
- **See all capabilities →** — `/` → `/product`.
- **Read the quickstart →** — `/` Self-host tier and pricing tier CTA.
- **Read →** — generic card link.

Arrow conventions: `→` forward, `↓` same-page jump, `←` rare (back actions only).

---

## 2. `/` — Home

[apps/corp/app/page.tsx](../apps/corp/app/page.tsx). Renders the homepage in nine bands.

### Hero (white)
- **Eyebrow:** Prove what's in your data — without revealing it
- **H1:** Show what your data contains. Keep the data private.
- **Lead:** Trusted Model gives you a way to prove what's inside a private dataset — or prove what isn't — without anyone ever seeing the dataset itself. Useful when "trust us" isn't enough and full disclosure isn't an option.
- **Primary button:** Request early access (→ `#request-access`)
- **Secondary link:** See how it works ↓ (→ `#how-it-works`)
- **Sub-fineprint:** For AI teams, content owners, legal teams, and journalists. Open source. Self-host or use the managed service.

### "The problem" (off-white)
- **Eyebrow:** The problem
- **H2:** The questions are getting harder to answer.
- **Lead:** Did this AI model train on my content? Was this article in your dataset? Did you have this draft before publication? Today, answering means either revealing the dataset or asking the other side to take your word for it. Neither one scales.
- **Three columns:**
  1. *"Trust us" doesn't hold up.* — When a customer, a regulator, or a court asks what's in your dataset, a written promise isn't enough. You need something they can check for themselves — without having to take your word for it.
  2. *You can't show it to prove it.* — Confidential training data, embargoed research, unpublished drafts — the moment you hand them over to a verifier, you've lost the very confidentiality you were trying to protect.
  3. *Internal records can change.* — Files get edited. Logs get rewritten. Backups get replaced. "We had this on date X" needs to be a record anyone can verify — not just an assertion from inside your company.

### "How it works" (white, anchor `#how-it-works`)
- **Eyebrow:** How it works
- **H2:** Three steps. One claim anyone can check.
- **Lead:** All the heavy lifting happens on your computer, with your data. Trusted Model only ever sees a seal — never the content behind it.
- **Three numbered steps:**
  - **01 — Seal your dataset on your own machine.** Trusted Model turns your text into a small, tamper-proof seal — a fingerprint that uniquely identifies the content. Your files never leave your computer.
  - **02 — Publish the seal, keep the dataset.** Only the seal and a timestamp are shared. The dataset itself stays private. The seal acts as a fixed reference anyone can come back to later.
  - **03 — Anyone can check what's in it — without seeing it.** Someone with a piece of text in hand can ask: "is this in your dataset?" Trusted Model returns a yes-or-no answer with a receipt they can re-check themselves. They never see anything else; you never see what they checked.
- **Trailing link:** Read the full architecture → (`/product`)

### "Why Trusted Model" (off-white)
- **Eyebrow:** Why Trusted Model
- **H2:** Built to be trusted by the people who don't trust each other.
- **Lead:** Verification works only when both sides believe the verifier isn't taking a side. Trusted Model is the neutral party in the middle — not a model provider, not a data broker, not connected to either side of any claim.
- **Three columns:**
  1. *Private by design.* — Trusted Model never sees your data. Not the dataset you committed, not the text someone is checking against it. The architecture forecloses it — it's not a policy choice we could change.
  2. *Anyone can verify, anywhere.* — Receipts are self-contained. A regulator, a journalist, a licensee — anyone you choose to share a receipt with can confirm the answer themselves, even years later, even without a Trusted Model account.
  3. *Neutral and independent.* — We don't train AI models. We don't sell training data. We don't compete with the people on either side of the verification — we just make the verification possible.

### "Capabilities" (white, two-column)
- **Left column:**
  - Eyebrow: Capabilities
  - H2: What it does, in plain terms.
  - Four bordered items:
    1. Commit a dataset privately. — Seal any collection of text on your own machine and publish only the seal. The dataset itself never crosses the wire.
    2. Prove what's in it. — Anyone you choose can confirm that a specific piece of text is part of your dataset — without seeing anything else in it.
    3. Prove what isn't. — Just as importantly: prove that a specific piece of text is not part of your dataset. The hardest claim to make today becomes a checkable answer.
    4. Timestamped, always. — Every seal is anchored to a date and time. "We had this on date X" stops being a memo and starts being a record.
  - Link: See all capabilities → (`/product`)
- **Right column (sticks down):** Two simple command-line tools — one for the team that owns the data, one for whoever's checking against it. Your data stays on your computer the entire time.

### "Use cases" (off-white)
- **Eyebrow:** Use cases
- **H2:** Who's using it.
- **Lead:** The teams getting the most out of Trusted Model are the ones being asked the hardest questions — AI teams answering training-data questions, content owners proving prior art, and newsrooms standing behind their reporting.
- **Two cards (white inside off-white):**
  1. **Training data integrity** → `/solutions/training-data`
     - Body: For AI labs, dataset publishers, and content licensees who need to prove what was — or wasn't — in a training corpus. Commit the corpus once; let any future auditor, regulator, or licensee verify inclusion or exclusion of any text fragment without you ever revealing the corpus itself.
     - CTA: Read more →
  2. **Legal & IP** → `/solutions/legal-ip`
     - Body: For legal teams, content owners, and research groups handling priority claims, authorship disputes, and confidential drafts. A timestamped commitment establishes that you had a body of content on a specific date — usable as evidence in IP disputes, embargoed publications, and provenance challenges, without disclosing the content.
     - CTA: Read more →

### "Pricing" (white)
- **Eyebrow:** Pricing
- **H2:** Free to start. Managed when you're ready.
- **Lead:** Run it yourself for free, or let us host it for you. Either way, we never see your data.
- **Three tiers:**
  1. **Pilot** · $0 / open POC · *Self-host the open-source stack.* Run the docker-compose POC locally. Producer + consumer + API. — CTA: Read the quickstart →
  2. **Team** (featured, accent border) · Talk to us · *Managed API + audit retention.* For teams committing recurring corpora and serving external verifiers. — CTA: Request access
  3. **Enterprise** · Talk to us · *Custom SLA + dedicated commit anchoring.* For regulated buyers with custom retention, BAA/DPA, and procurement needs. — CTA: Talk to sales →
- **Footnote:** Managed pricing scales with how much you use it — not how many people are on the team.
- **Trailing link:** See full pricing details → (`/pricing`)

### "Be one of the first" — final CTA (off-white, anchor `#request-access`)
- **H2:** Be one of the first to try it.
- **Lead:** We're working with a small group of early customers through 2026 — AI teams, content owners, and legal teams putting Trusted Model to work on real questions. If that sounds like you, we'd love to hear from you.
- **Form:** `<RequestForm />`

---

## 3. `/product` — Product overview

[apps/corp/app/product/page.tsx](../apps/corp/app/product/page.tsx).

### Hero (white)
- **Eyebrow:** Product
- **H1:** Prove what's in your data — without showing the data.
- **Lead:** Producers seal their dataset on their own machine and publish only the seal. Verifiers check their own text against the seal, on their own machine, and get a receipt they can re-check themselves. Trusted Model brokers the seals and the receipts — and never sees the data behind them.

### "The flow" (off-white)
- **Eyebrow:** The flow
- **H2:** What happens when a dataset is sealed.
- **Lead:** The work happens on the producer's computer. Only the seal and the timestamp ever leave. The dataset stays where it lives.
- **Five numbered steps:**
  - **01 — Seal the dataset locally.** On your own computer, Trusted Model turns the dataset into a small, tamper-proof seal that uniquely identifies its contents. Your files stay where they are — only the seal travels.
  - **02 — Publish the seal.** The seal and a timestamp are registered with Trusted Model. The dataset itself stays private. Anyone you choose can now refer back to the seal — even years later.
  - **03 — Anyone can verify against it.** Someone with a piece of text in hand asks: "is this in your dataset?" Trusted Model returns a yes-or-no answer with a receipt the asker can re-check themselves. Nothing else about the dataset is revealed; nothing about what was asked goes back to you.
  - **04 — A verifier asks a question.** The verifier prepares their own text the same way the producer did and asks Trusted Model whether it's in the sealed dataset. The service returns one of four outcomes:
    - *Match.* — The text is in the sealed dataset. The receipt confirms it. The verifier knows it's a match; you know they asked.
    - *No match.* — The text is not in the sealed dataset. The receipt confirms it provably wasn't there — a much harder claim than "we don't see it."
    - *Partial match.* — Some parts of the text are in the dataset, others aren't. The receipt breaks it down piece by piece.
    - *Revoked seal.* — The seal has been withdrawn by its owner. You're told it's no longer current and pointed to the latest valid seal if one exists.
  - **05 — The verifier confirms the receipt.** The receipt is self-contained. Anyone can confirm it themselves — no Trusted Model account, no special access, no need to take our word for anything. The receipt is the evidence.
- **CodeBlock — performance numbers:**
  ```
  How long things take, in practice:
    Sealing a 100 MB dataset:       ~2-6 seconds
    Publishing the seal:            under a second
    A single chunk check:           under a second
    Confirming a receipt yourself:  a few milliseconds
  ```

### "Preparation" (white)
- **Eyebrow:** Preparation
- **H2:** Same input, same seal — every time.
- **Lead:** For two parties to agree on whether a piece of text is in a dataset, they need to agree on what counts as "the same piece of text." Trusted Model normalizes the text in a precisely defined way before sealing, so different machines and different tools always arrive at the same answer.
- **Two-column body:**
  - *What gets normalized.* — The rules are part of the protocol, not an implementation detail. Every seal records which version of the rules it used, so a verifier years later can reproduce the answer exactly. The current version handles:
    - Consistent line endings, spaces, and tabs — small formatting differences don't matter
    - Standard Unicode handling — visually identical characters are treated identically
    - Paragraph-aware splitting — chunks line up with how the document is structured
    - Deterministic ordering — the same dataset always produces the same seal
    - UTF-8 enforced — older encodings are converted with the conversion recorded
    - Replayable — anyone with the rules can reproduce the seal from the same data
  - *What you can prove.* — The protocol works on pieces, but those pieces compose into the questions people actually want to ask:
    - *"Is this paragraph in your dataset?"* — The asker hashes the paragraph on their own machine, asks for a receipt, and learns yes or no — without showing the paragraph to anyone but their own verifier.
    - *"Is this whole article in your dataset?"* — Each piece of the article is checked separately, and the results are rolled up to a document-level answer.
    - *"Prove this draft wasn't in your dataset on date X."* — A no-match receipt against the seal published on date X is the proof. The dataset can't be changed retroactively to include the draft after the fact.
    - *"Prove I had this content on date X."* — The seal published on date X is the proof. The timestamp is the anchor; the receipt is the evidence.
    - Trailing: The ability to prove a **no** — not just a yes — is the part that makes this useful in disputes. Most systems can confirm a match. Trusted Model can confirm an exclusion.
- **PullQuote:** Matches answer "did you have this?" Exclusions answer the harder one: "prove you didn't."

### "Policy" (off-white)
- **Eyebrow:** Policy
- **H2:** Retention, access, and audit.
- **Lead:** The protocol works the same for every seal. The settings around it — how long the seal is queryable, who's allowed to ask about it, who can see who asked — are choices each producer makes and each verifier can see before they ask.
- **Three items:**
  - *How long the seal stays live.* — Each seal carries its own retention policy. Keep it queryable indefinitely, expire it after a set time, or withdraw it explicitly. Verifiers see the policy before they ask.
  - *Who can check against it.* — Choose whether your seals are open to anyone, limited to specific verifiers, or shared bilaterally via a private key. Access is metadata — it doesn't change what the receipts prove.
  - *Who asked what.* — Every check is logged: who asked, against which seal, on which date. Producers see who's checked against their dataset; verifiers see their own full history of receipts.
- **CodeBlock — sample seal record:**
  ```
  A published seal, in plain terms:

    Dataset name:     research-corpus-q2
    Pieces sealed:    18,402
    Published on:     May 12, 2026
    Stays queryable:  90 days
    Who can check:    two specific verifiers
    Signed by:        the research lab's signing key
  ```

### "Visibility" (white)
- **Eyebrow:** Visibility
- **H2:** What both sides see.
- **Lead:** Logs and dashboards record metadata only — never the raw text. Both sides get a record of every question and every answer; neither side has to hand over the underlying content to get one.
- **Two-column lists:**
  - *What's logged for every check:*
    - When the seal was published, and by whom
    - What was checked against it — but only as fingerprints, never raw text
    - The yes-or-no answer, plus the receipt itself
    - The retention policy and access mode in effect at the time
    - Total time to answer the request
  - *What the dashboard shows:*
    - Active seals by dataset and retention status
    - Verification volume over time, by counterparty
    - Top verifiers checking against your seals
    - Match vs. no-match rate per dataset
    - Old seals still being queried
    - Response time, end-to-end
- **Caption:** Logs export to standard log systems. Receipts are self-contained JSON — drop them into your records system, send them to opposing counsel, or attach them to a board packet.

### "Components" (off-white)
- **Eyebrow:** Components
- **H2:** Three pieces. Each does one thing.
- **Lead:** The producer tool seals datasets. The consumer tool verifies against them. The Trusted Model service holds the seals and serves the receipts. That's it.
- **Three cards:**
  - **Producer CLI** — Run it on the machine that holds your dataset · Turn a folder of text files into a single seal · Publish the seal to Trusted Model · Sign the seal with your own key so verifiers can confirm it's really yours · Save the receipt as a JSON file you can hand to anyone.
  - **Consumer CLI** — Run it on the machine that holds the text you want to check · Check a piece of text against any published seal · Verify the receipt offline — no need to trust the server · Save the receipt for the record · Check against many seals at once.
  - **Trusted Model service** — Hosts published seals and serves receipts · Keeps an audit log of every check · Never sees your raw data · Available self-hosted via Docker Compose, or managed.

### "Deployment" (white)
- **Eyebrow:** Deployment
- **H2:** Run it yourself, or let us run it.
- **Lead:** The producer and consumer tools always run on your computer. Where the service runs is a choice — whatever fits the people who'll be verifying against your seals.
- **Three options:**
  - *Run it yourself.* — The full reference setup runs locally with `docker compose up`. Suits evaluation, internal use, and self-hosted deployments where you'd rather not depend on us at all.
  - *Let us host it.* — We run the service for you. Your data still never leaves your computer; you just don't have to operate the server. Useful when external verifiers — regulators, licensees, journalists — need to query without having to trust your infrastructure.
  - *Add an outside timestamp (coming soon).* — For high-stakes seals, the timestamp can be additionally anchored to an independent timestamp authority. Verifiers get a second, independent confirmation of when the seal existed.

### "Roadmap" (off-white, anchor `#roadmap`)
- **Eyebrow:** Roadmap
- **H2:** What we're building next.
- **Lead:** We don't claim features we haven't shipped. Here's what's done, what's in flight, and what's on the drawing board.
- **Four phases (each: `Phase N — Title (status)` mono label + body):**
  - **Phase 1 — Reference implementation (shipped).** The full producer + consumer + service stack, runnable today as a single Docker Compose command.
  - **Phase 2 — Managed service (in development).** Hosted version with retention policies, access controls, dashboards, and audit logging. For teams that need someone else to operate the server.
  - **Phase 3 — Outside anchoring (design stage).** Optional anchoring of seals to independent timestamp services. A second source of truth for the dates on each seal.
  - **Phase 4 — More than text (exploratory).** Extending the same approach to images, audio, and structured data. Same protocol shape, different prep rules per format.

### Final CTA (white)
- **H2:** Ready to seal and verify your first dataset?
- **Lead:** Run it locally, or talk to us about the managed version. Either way, we respond to every inquiry from a real human.
- **Buttons:** Request early access (→ `/access`) · Talk to sales → (→ `/contact`)

---

## 4. `/product/protocol-spec`

[apps/corp/app/product/protocol-spec/page.tsx](../apps/corp/app/product/protocol-spec/page.tsx).

### Hero
- **Eyebrow:** Product / How it works under the hood
- **H1:** What's actually happening when you seal and verify.
- **Lead:** A plain-language overview of the steps Trusted Model takes on each side of a verification. The full technical specification lives in the open-source repository; this page is the friendly version for security architects, legal teams, and anyone who wants to understand the mechanism before they trust it.

### Step 1 — Preparing the text (off-white)
- **Eyebrow:** Step 1 — Preparing the text
- **H2:** Same input, same seal — every time.
- **Lead:** For two parties to agree on whether a piece of text is in a dataset, they need to agree on what counts as "the same text." Trusted Model normalizes text in a precisely defined way so different machines and different tools always arrive at the same answer.
- **Four items:**
  - *Consistent encoding.* Text is normalized to a standard encoding so different machines treat the same character the same way.
  - *Whitespace cleanup.* Tabs, line endings, and runs of spaces are normalized — small formatting differences don't affect the result.
  - *Paragraph-aware splitting.* Documents are split on blank lines into paragraphs before being broken into smaller pieces. Paragraph boundaries stay consistent across runs.
  - *Stable ordering.* Pieces are processed in a deterministic order. The same dataset always produces the same seal — not approximately, exactly.

### Step 2 — Fingerprints and the seal (white)
- **Eyebrow:** Step 2 — Fingerprints and the seal
- **H2:** From a dataset to a short, tamper-proof seal.
- **Lead:** Every piece of text in the dataset is turned into a fingerprint — a short value that uniquely identifies the piece. All the fingerprints are combined into a single seal that represents the whole dataset.
- **Three items:**
  - *Whole-document fingerprint.* One fingerprint per document — used to answer "is this whole document in the dataset?"
  - *13-word phrase fingerprints.* Overlapping 13-word phrases are each fingerprinted — used to answer questions about partial overlap and which specific passages match.
  - *Single seal.* All the fingerprints are aggregated into one short seal that uniquely identifies the dataset. It's tamper-proof: change a single character anywhere and the seal changes too.
- **Footnote:** The math itself is standard — widely reviewed, used in countless products. Trusted Model's contribution isn't the math; it's the convention that lets independent parties agree on what each piece is and how to combine the fingerprints.

### Step 3 — Receipts (off-white)
- **Eyebrow:** Step 3 — Receipts
- **H2:** Four pieces of paper, in plain terms.
- **Lead:** Four kinds of "documents" travel through the system. None of them contains raw content. All of them are checkable by anyone with the right reference materials.
- **Four items:**
  - *The seal record.* What the producer publishes. Includes the seal itself, when it was made, who signed it, how long it stays live, and who can check against it.
  - *The match receipt.* What the service returns when a verifier's piece is in the dataset. Self-contained — the verifier can confirm it themselves with just the published seal.
  - *The no-match receipt.* What the service returns when a verifier's piece is provably not in the dataset. Same structure as a match receipt — checkable offline.
  - *The verification receipt.* The signed record the verifier saves. Includes everything asked, everything returned, and the verdict. Verifiable by anyone, anywhere, with no Trusted Model account.
- **PullQuote:** The receipt is the artifact. The service is the broker. The verification is math anyone can re-check.

### What it gives you (white)
- **Eyebrow:** What it gives you
- **H2:** What the design buys you — and what it doesn't.
- **Five items:**
  - *Reproducible.* Two parties starting from the same dataset arrive at the same seal — every time, on different machines, without coordination.
  - *No raw content over the wire.* Producers send fingerprints. Verifiers send fingerprints. The service never receives raw content from either side.
  - *Both match and no-match.* Most systems can confirm a match. This one also proves a no-match — provably, mathematically. That's the part that makes it useful in disputes.
  - *Verifiable offline.* Receipts can be checked without contacting Trusted Model. The math is the trust anchor, not our servers.
  - *Versioned.* The format is versioned so a receipt from today still checks correctly five years from now. Verifiers refuse to mix incompatible versions silently.
- **Footnote (limit-of-protocol):** What it does **not** do: it doesn't decide whether two semantically similar but differently worded texts are "the same." Trusted Model works at the level of exact pieces. Paraphrases, translations, and reformatted content won't match. That's a feature for evidentiary use and a limit for semantic search.

### "For the people who need the full document" (off-white)
- **Eyebrow:** For the people who need the full document
- **H2:** The actual specification.
- **Lead:** The page you just read is the friendly summary. The normative technical specification — the part that says exactly which hash function is used, exactly how the seal is assembled, exactly what the on-the-wire format looks like — lives in the open-source repository. That's where you go when you're implementing a verifier from scratch or writing a compliance memo that needs to cite specifics.
- **CodeBlock:**
  ```
  Open source repository:
    github.com/trustedmodel/spec

  Includes:
    - The full text preparation rules
    - The fingerprint format and the seal construction
    - Receipt format and signing details
    - Reference implementations for verifiers
  ```

### Final CTA (white)
- **H2:** See it run, or build against it.
- **Lead:** The fastest way to understand it is to run it. The quickstart spins up the whole thing locally with a single command and walks through a real seal and verification.
- **Buttons:** Run the quickstart (→ `/docs/quickstart`) · CLI reference → · API reference →

---

## 5. `/product/cli`

[apps/corp/app/product/cli/page.tsx](../apps/corp/app/product/cli/page.tsx).

### Hero
- **Eyebrow:** Product / CLIs
- **H1:** The producer and consumer CLIs.
- **Lead:** Two command-line tools, one product. The producer CLI seals a dataset from disk. The consumer CLI verifies an artifact against a snapshot. Both run locally; neither uploads raw content. The full docs live under `/docs`.

### Producer CLI section (off-white)
- **Eyebrow:** Producer CLI
- **H2:** Seal a dataset from disk.
- **Lead:** The producer CLI walks a folder of `.txt` files, prepares them locally, derives document and 13-word passage fingerprints, seals the dataset, and sends only the fingerprint leaves and the claimed root to the API. The API rebuilds the tree, checks the root matches, persists the snapshot, mints a local timestamp attestation, and returns a receipt.
- **Two-column "Uploaded vs Not uploaded":**
  - Uploaded: Fingerprint type and hash · Occurrence count per fingerprint · Fingerprint per chunk · Snapshot metadata (model, version, snapshot id) · Claimed seal
  - Not uploaded: Raw text · Filenames or paths · Source positions · Document titles
- **Commands list:**
  - `trusted-model-producer commit` — Walk a folder of .txt files, prepare locally, fingerprint, seal the dataset, and register the seal with the API. Saves a commitment receipt JSON.
  - `trusted-model-producer job` — Look up the status of an async commit job by id. Useful with `--no-wait` when you want to submit and recover later.
- **Sample CodeBlock:** commit invocation against the seeded example corpus.
- **Footnote:** Limits: at most 50,000 unique fingerprint keys per corpus; each file must be ≤ 1 MB. Full reference at `/docs/producer-cli`.

### Consumer CLI section (white)
- **Eyebrow:** Consumer CLI
- **H2:** Verify an artifact against a snapshot.
- **Lead:** The consumer CLI reads one local `.txt` file, prepares it, derives a document fingerprint and overlapping 13-word passage fingerprints, and sends only those fingerprints to the API. The API runs the document fingerprint and each passage against the published seal, returns match receipts for matches and no-match receipts for absences, and the CLI verifies every proof locally before saving the receipt.
- **Two-column "Uploaded vs Not uploaded":**
  - Uploaded: Snapshot id · Document fingerprint hash · Passage fingerprint hashes · fullProofs flag
  - Not uploaded: Raw text · Filename · Reconstructable snippets
  - Caption: Matched snippets are reconstructed and printed only locally from the artifact you supplied.
- **Commands list:**
  - `trusted-model-consumer snapshots` — List every sealed snapshot the API knows about — useful for figuring out which snapshot id to verify against.
  - `trusted-model-consumer verify` — Read one local .txt file, prepare, fingerprint, request match or no-match receipts against a snapshot, verify locally, and save a verification receipt JSON.
  - `trusted-model-consumer job` — Look up the status of an async verify job by id. Counterpart to the producer-side job command.
- **Footnote:** Limits: up to 10,000 passage fingerprints per submission. Full reference at `/docs/consumer-cli`.

### Final CTA (off-white)
- **H2:** Try it locally in about a minute.
- **Lead:** The quickstart spins up the API, worker, and Redis with Docker Compose, commits the example corpus, and verifies three artifacts (exact, partial, no-match) end to end.
- **Buttons:** Read the quickstart (→ `/docs/quickstart`) · API reference → (→ `/product/api`)

---

## 6. `/product/api`

[apps/corp/app/product/api/page.tsx](../apps/corp/app/product/api/page.tsx).

### Hero
- **Eyebrow:** Product / API
- **H1:** HTTP API reference.
- **Lead:** The CLIs are the convenient path. The API underneath is small, stable, and easy to integrate with from any language. Two primary operations — commit and verify — plus health and metadata endpoints. Everything else is implementation detail.

### Endpoints (off-white)
- **Eyebrow:** Endpoints
- **H2:** The full surface.
- **Lead:** Authentication is a per-side API key — producer or consumer. Endpoints are scoped to their side. Job-based endpoints return quickly with a job id and are polled to completion.
- **Endpoint list** (method · path · auth · summary):
  - `GET /health` (auth: none) — Liveness probe. Returns ok and the build version. No auth.
  - `POST /commitments` (auth: producer key) — Register a new seal. Body carries the fingerprints, snapshot metadata, and the claimed seal value. Returns a job id.
  - `GET /commitments/jobs/:jobId` (auth: producer key) — Poll a sealing job. Returns queued, processing, completed (with receipt fields), or failed (with error code).
  - `GET /snapshots` (auth: consumer key) — List committed snapshots known to this API. Returns snapshot id, model, version, chunk count, and timestamp per snapshot.
  - `GET /snapshots/:id` (auth: consumer key) — Fetch metadata for a single snapshot, including seal, format version, signer fingerprint, and retention.
  - `POST /verifications` (auth: consumer key) — Submit a verification job. Body carries snapshot id, document fingerprint, passage fingerprints, and fullProofs flag. Returns a job id.
  - `GET /verifications/jobs/:jobId` (auth: consumer key) — Poll a verify job. Returns inclusion or no-match receipts per fingerprint, plus the offline-verifiable receipt fields.

### Examples (white)
- **Eyebrow:** Examples
- **H2:** Two requests, two responses.
- **Lead:** Concrete shapes — the abridged JSON your client will exchange with the API on a commit and a verify. Full schemas are in the protocol spec.
- **Three labeled CodeBlocks:** Commit (request) · Commit (response) · Verify (response). Each shows the literal JSON.

### Conventions (off-white)
- **Eyebrow:** Conventions
- **H2:** How the API behaves.
- **Five items:**
  - *Content type.* JSON in and JSON out. UTF-8 encoded. Server-Sent Events are not used.
  - *Idempotency.* POST /commitments and POST /verifications accept an Idempotency-Key header; replaying with the same key returns the original job id instead of starting a new job.
  - *Async by default.* Commit and verify are queued (BullMQ) and return a job id. Use the matching jobs/:jobId endpoint to poll. The CLIs handle polling for you; raw API integrators do it themselves.
  - *Timestamps.* All timestamps are ISO-8601 UTC. The API rejects requests with clearly skewed Date headers (>5 minutes) to avoid bad signing material.
  - *Versioning.* The format is versioned. The API surface is versioned independently. Backwards-incompatible API changes ship under a new path prefix.

### Errors (white)
- **Eyebrow:** Errors
- **H2:** What can go wrong, and what we tell you.
- **Seven items (mono headings):**
  - `400 — bad input` — Malformed body, missing required field, format version mismatch, or fingerprint count over the per-request limit.
  - `401 — auth failure` — Missing or invalid API key. Producer and consumer keys are scoped to their respective endpoints; using the wrong one returns 401, not 403.
  - `404 — snapshot not found` — The snapshot id you asked about does not exist on this API. Use GET /snapshots to enumerate.
  - `409 — duplicate snapshot` — Snapshot ids are immutable. POST /commitments with an existing snapshot id fails 409; pick a new id.
  - `422 — merkle root mismatch` — The fingerprints you submitted do not add up to the claimed seal. The request is rejected. Re-run the producer CLI.
  - `429 — rate limited` — Standard token-bucket rate limit by API key. Includes Retry-After. Limits are configurable on the managed tiers.
  - `5xx — server error` — Logged on our side. Receipts are never partially issued: if you get a 5xx, the commit or verify did not persist.

### Final CTA (off-white)
- **H2:** Build directly against the API.
- **Lead:** The CLIs are reference clients. The API is small enough to integrate against directly from any language — TypeScript, Python, Go, Rust, anything that speaks HTTP and strong fingerprints.
- **Buttons:** Read the product spec (→ `/product/protocol-spec`) · CLI reference → (→ `/product/cli`)

---

## 7. `/security`

[apps/corp/app/security/page.tsx](../apps/corp/app/security/page.tsx). Many crypto-primitive names (`fingerprints`, `secure`, `strong encryption`, `encrypted in transit`, `older encryption`, `digital signing`) currently render as placeholder words. When filling them, follow [[feedback-writing-precision]] and name primitives precisely (e.g., SHA-256, Ed25519, AES-256-GCM, TLS 1.2+).

### Hero (white)
- **Eyebrow:** Security
- **H1:** What Trusted Model does — and does not — see.
- **Lead:** The architecture forecloses most of the questions a security review normally asks. We never see your dataset, we never see your artifacts, we only ever handle fingerprints and metadata. This page covers what that means in practice, and what you should still ask us about.
- **Date + contact:** Last updated: May 2026 · Questions? security@trustedmodel.dev

### Data handling (off-white, anchor `#data-handling`)
- **Eyebrow:** Data handling
- **H2:** What we do — and don't — receive.
- **Lead:** Trusted Model handles two kinds of data: seal metadata (root hashes, scheme versions, chunk counts, timestamps) and verification metadata (which verifier asked, which passage fingerprints, match or no-match verdict). It never handles raw dataset content or raw artifact content.
- **Three subsections:**
  - *What we collect.* On the managed tiers, we store seal records (root hash, scheme version, chunk count, retention policy, signer key fingerprint), verification audit events (timestamp, verifier identity, passage fingerprints queried, receipt issued), and the operational metadata required to run the service — account identity, billing records, support correspondence.
  - *What we don't have.* We don't have raw dataset content. We don't have raw consumer artifacts. We don't have anything that could be reconstructed back to plaintext — fingerprints are verifiably one-way, and the product is structured so that the only thing crossing the network is the fingerprint set and the receipt payload.
    Second paragraph: We don't train any model on customer data. There is no model — Trusted Model is a verification product, not an ML system. There is no fine-tuning dataset and no inference layer that ever reads customer content, because there is no customer content to read.
  - *How long we keep it.* Retention is per-seal and configurable by the producer. Team-tier default is `1 year`. Business supports up to `7 years`. Enterprise supports indefinite. Audit events follow the same retention as the underlying seal they pertain to. Receipts a verifier already holds remain valid offline regardless of registry retention.

### Encryption and signing (white, anchor `#encryption`)
- **Eyebrow:** Encryption and signing
- **H2:** Encrypted at rest, in transit, and signed by the producer.
- **Lead:** Encryption is the floor; verifiable signing is what makes seals unforgeable. We use both, and we're specific about the primitives.
- **Four items (placeholders to be filled with real primitives):**
  - *Fingerprints.* Every chunk fingerprint is computed with `fingerprints`. The seal uses the same hash function for internal node computation. fingerprints is the floor of modern verifiable practice; we don't deviate.
  - *Signing.* Commitments and receipts are signed with `secure`. The producer holds the signing key; Trusted Model never sees it. Verifiers check signatures against the producer's published verifying key.
  - *At rest: `strong encryption`.* Managed-tier persistent data — seal records, audit logs, account information — is encrypted at rest using `strong encryption` with keys managed by the cloud provider's KMS. Self-host customers handle this in their own infrastructure.
  - *In transit: `encrypted in transit`.* All client-to-server communication uses `encrypted in transit` with modern cipher suites. We do not accept connections below `older encryption`.

### Access controls (off-white, anchor `#access-controls`)
- **Eyebrow:** Access controls
- **H2:** Who can ask, who can answer.
- **Lead:** Access on the managed tiers is identity-gated and audit-logged. But the deeper layer is structural — the product doesn't have content to leak in the first place.
- **Two-column body:**
  - *Within your organization.* Producers control who can ask about their seals. Three access modes are supported:
    - `public` — any verifier can query
    - `allowlist` — only specific verifier identities
    - `private` — brokered through a shared secret agreed bilaterally
    - Trailing: Producers can revoke access at any time. Audit events record who asked what, when — useful in disputes about whether a verifier ever attempted to query, and what they learned.
  - *Within Trusted Model.* Trusted Model staff access to the managed registry is restricted to a small operations group. All staff access is:
    - Authenticated through SSO with hardware-backed MFA required
    - Logged with staff identity, timestamp, action, and customer affected
    - Subject to internal review on a quarterly cadence
    - Auto-revoked when staff change roles or leave the company
    - Trailing: Because the registry only ever holds fingerprints and metadata, even an unauthorized access event does not surface plaintext — there's no plaintext to surface. The verification design is the primary control; operational access controls are defense in depth.

### Infrastructure (white, anchor `#infrastructure`)
- **Eyebrow:** Infrastructure
- **H2:** Where the managed registry runs.
- **Lead:** The managed tiers run on a major US cloud provider in `us-east` and `us-west` regions for redundancy. EU-resident deployment is on the roadmap. Self-host customers run wherever they want.
- **Four items:**
  - *Network isolation.* Production runs in dedicated VPCs with no public ingress to internal services. The only public-facing surface is the load balancer that fronts the API. Internal services communicate over private subnets with least-privilege security groups.
  - *Secrets management.* Application secrets and operational credentials are managed in the cloud provider's secret manager with rotation enabled where supported. No secrets in source control; no secrets in long-lived environment variables.
  - *Logging and monitoring.* Application logs, audit events, and security telemetry flow to centralized logging with retention matching the customer policy. Anomaly detection runs against access patterns; alerts route to on-call.
  - *Vulnerability management.* Automated dependency scanning runs on every build. Critical vulnerabilities are remediated within 24 hours; high within 7 days. We plan to engage an independent firm for annual penetration testing once the managed tiers reach general availability.

### Compliance (off-white, anchor `#compliance`)
- **Eyebrow:** Compliance
- **H2:** Where we are on the compliance roadmap.
- **Lead:** We're going to be honest about this. Trusted Model is early. We don't have a SOC 2 report yet. The product's structural properties — no plaintext, no model — close most of the questions on the standard compliance review before they're asked, but certifications still matter and we'll pursue them as the project matures.
- **Five `ComplianceStatus` rows (Status renders in mono; accent if in-progress, neutral-500 otherwise):**
  - **SOC 2 Type I** · Not yet engaged · We're a young project. We have not engaged a SOC 2 readiness platform or auditor yet. We'll start the process when customer demand justifies the spend, and we'll publish the report when it's real, not before.
  - **GDPR** · Architecture aligned; manual workflow until Phase 2 (in progress) · The product's design — no plaintext upload, fingerprint-only metadata — substantially reduces GDPR exposure on the managed tiers. A formal data subject rights workflow ships with the Phase 2 managed registry. Until then, requests are handled manually with response times aligned to GDPR.
  - **HIPAA** · Not currently supported · We don't market to healthcare and don't carry a BAA today. Customers handling PHI should not deploy the managed tiers for that purpose. The Self-host tier runs entirely on customer infrastructure, which may be a fit — but we cannot offer a BAA on it.
  - **ISO 27001** · Not currently certified · Not on the immediate roadmap. We'll evaluate certification when European enterprise customer demand justifies the investment.
  - **EU AI Act** · Architecture aligned with provenance and logging requirements (in progress) · The AI Act's emerging guidance around training data transparency and provenance maps naturally onto the product — verifiable seals and no-match receipts are exactly what "prove what was and wasn't in the training set" requires. We'll publish a dedicated compliance reference once implementing guidance from regulators stabilizes.

### Subprocessors and incident response (white, anchor `#subprocessors`)
- **Eyebrow:** Subprocessors and incident response
- **H2:** Vendors that touch metadata, and what happens when something goes wrong.
- **Two-column body:**
  - *Subprocessors.* A short list of vendors are used to operate the managed tiers. None of them ever sees raw customer content, because no part of Trusted Model does. The full subprocessor list, with data residency and contracted security obligations, is on the trust page. Customers are notified of subprocessor changes at least 30 days before a new vendor goes live, allowing time for objection or contract review. Trailing link: Read the trust page →
  - *Incident response.* If we detect a security incident affecting customer metadata, we follow a documented response process:
    - *Detection and triage:* Security incidents are assessed within 1 hour of detection
    - *Customer notification:* Customers affected by a confirmed incident are notified within 72 hours, in line with GDPR Article 33 requirements
    - *Investigation:* We conduct a full root cause investigation and produce a written incident report
    - *Disclosure:* Public disclosure on our trust page within 30 days for incidents that meet a materiality threshold
    - *Remediation:* Specific remediation steps and timelines are communicated to affected customers in writing
  - Trailing: We've had zero security incidents to date. We'll update this section if and when that changes. **Note:** the style guide warns against "zero incidents to date" boilerplate ([[feedback-writing-precision]]) — consider rewording or removing once the product matures.

### Get in touch (off-white, anchor `#contact`)
- **Eyebrow:** Get in touch
- **H2:** Questions, vulnerability reports, or compliance reviews.
- **Lead:** We respond to every security inquiry. Procurement teams, security researchers, and customers running their own reviews — reach out and we'll get you what you need.
- **Three columns:**
  - General security questions → security@trustedmodel.dev
  - Vulnerability disclosure → security@trustedmodel.dev — caption: We commit to acknowledging vulnerability reports within 48 hours and providing initial assessment within 7 days.
  - Compliance and procurement reviews → security@trustedmodel.dev — caption: We can provide DPA, security questionnaire responses, and architecture documentation on request.

---

## 8. `/trust`

[apps/corp/app/trust/page.tsx](../apps/corp/app/trust/page.tsx).

### Hero
- **Eyebrow:** Trust
- **H1:** Subprocessors, documentation, and audit reports.
- **Lead:** Everything procurement teams need to evaluate Trusted Model as a vendor on the managed tiers. Subprocessor list, DPA, security questionnaire responses, the protocol document. If something you need isn't here, email security@trustedmodel.dev and we'll get it to you.
- **Date:** Last updated: May 2026

### Subprocessors (off-white)
- **Eyebrow:** Subprocessors
- **H2:** Vendors that process managed-tier data.
- **Lead:** The complete list of third-party vendors with any access to managed-tier data. None of them ever sees raw dataset or artifact content, because Trusted Model itself never does. Customers are notified at least 30 days before a new subprocessor is added.
- **Table columns:** Vendor · Purpose · Data processed · Data location · Security posture · Notes
- **Rows:**
  1. **Amazon Web Services** · Managed cloud infrastructure (compute, storage, database, KMS) · Seal records, audit metadata, account information · `us-east-1`, `us-west-2` · SOC 2 Type II, ISO 27001 · No raw dataset or artifact content — the product does not surface plaintext
  2. **Stripe** · Payment processing · Billing contact, payment method, transaction history · US · PCI DSS Level 1, SOC 1 / SOC 2 Type II · No verification data
  3. **Postmark** · Transactional email · Recipient email addresses, notification content · US · SOC 2 Type II · No verification data
  4. **Plausible Analytics** · Web analytics · Anonymized website usage data · EU (Germany) · GDPR-native, no cookies, no PII · Marketing site only
  5. **Sentry** · Error monitoring · Application error logs · US · SOC 2 Type II · Protocol payloads excluded by configuration
  6. **Linear** · Internal issue tracking · Internal team usage; customer support tickets · US · SOC 2 Type II · No verification data
  7. **PagerDuty** · Incident response · On-call routing, incident metadata · US · SOC 2 Type II · No verification data
- **Footnote:** This list is current as of May 2026. Subprocessor changes are announced via email to customer admin contacts at least 30 days before going live. To subscribe to subprocessor change notifications, email trust@trustedmodel.dev.

### Documentation (white)
- **Eyebrow:** Documentation
- **H2:** Procurement and security documentation.
- **Lead:** The documents most security and procurement teams ask for during a vendor review. Some are public; some require a signed NDA before we share. We respond to documentation requests within 2 business days.
- **Seven document blocks (`Title` · body · `Access:` line):**
  - **Data Processing Agreement (DPA)** — Our standard DPA covers the data processing relationship between Trusted Model and customer organizations on the managed tiers, including obligations under GDPR Article 28 and equivalent provisions. The scope is narrow because the product never transmits raw content. — *Access:* Public download, DPA.pdf
  - **Protocol specification** — The full protocol document — text preparation rules, fingerprinting, verifiable construction, proof format, signing scheme. Versioned alongside the implementation. Useful for security architects evaluating the verification design. — *Access:* Public, github.com/trustedmodel/spec
  - **Security questionnaire responses (SIG, CAIQ)** — We maintain pre-completed responses to the Standardized Information Gathering (SIG) questionnaire and the Cloud Security Alliance's Consensus Assessments Initiative Questionnaire (CAIQ). — *Access:* NDA required. Email security@trustedmodel.dev with your organization name and we'll send the latest version within 2 business days.
  - **Architecture and data flow documentation** — A technical document describing how seals and receipts flow through the managed registry, including the trust zones and the boundaries that the product enforces structurally. Useful when paired with the protocol document. — *Access:* NDA required for the detailed version. Public summary on the Security page.
  - **Subprocessor change history** — A log of all subprocessor additions, removals, and changes since launch. Useful for customers tracking the evolution of the vendor relationship over time. — *Access:* Public, available on request from trust@trustedmodel.dev.
  - **Privacy policy** — How Trusted Model handles personal data on the managed tiers, including data subject rights and contact information for privacy inquiries. — *Access:* Public, privacy policy.
  - **Terms of service** — The legal terms governing use of the managed Trusted Model service. The Self-host tier is governed by the open-source license. — *Access:* Public, terms of service.

### Audits and certifications (off-white)
- **Eyebrow:** Audits and certifications
- **H2:** Where we are on third-party verification.
- **Lead:** We're early. We're transparent about what's been verified by independent auditors and what hasn't. Status updates as certifications are achieved.
- **Five `ComplianceStatus` rows:**
  - **SOC 2 Type I** · Not yet engaged · We have not engaged an auditor yet. We'll start the process when managed-tier customer demand justifies the spend, and we'll publish the report when it's real, not before.
  - **Penetration test** · Planned with the managed tier GA · We plan to engage an independent third-party security firm for a penetration test when the managed registry reaches general availability. Until then, the project is small enough that public source review and the product's structural properties are the primary security posture.
  - **Vulnerability disclosure program** · Active (in progress) · We accept vulnerability reports from security researchers and respond within 48 hours of receipt. Send to security@trustedmodel.dev.
  - **ISO 27001** · Not currently certified · Not on the immediate roadmap. We will evaluate certification when European enterprise customer demand justifies the investment.
  - **HIPAA** · Not currently supported · The managed tiers are not configured for healthcare workflows and do not carry a Business Associate Agreement. The Self-host tier can be deployed entirely on customer infrastructure if a customer's compliance team is willing to assume responsibility.

### Reach us (white)
- **Eyebrow:** Reach us
- **H2:** For procurement, compliance, and trust questions.
- **Lead:** We respond to every inquiry from procurement, security, and compliance teams. Reach out and we'll get you what you need within 2 business days.
- **Two-column contacts:**
  - **Trust and procurement** → trust@trustedmodel.dev — caption: For DPA requests, subprocessor change notifications, security questionnaires, and audit report requests.
  - **Security inquiries and vulnerability disclosure** → security@trustedmodel.dev — caption: For technical security questions, vulnerability reports, and incident response coordination.

---

## 9. `/pricing`

[apps/corp/app/pricing/page.tsx](../apps/corp/app/pricing/page.tsx).

### Hero (white)
- **Eyebrow:** Pricing
- **H1:** Open source first. Managed when you need it.
- **Lead:** The reference implementation is free to self-host. Managed tiers exist for teams that need retention, dashboards, audit logging, and SLAs — priced by usage, not by seats. No setup fees. No per-byte charges on your dataset.

### Tier cards (off-white)
- **H2:** Pick the tier that fits.
- **Lead:** Self-host is always free. Team and above are usage-based, billed monthly. Annual contracts are available with a 15% discount.
- **Three cards:**
  - **Self-host** · $0 · Open-source reference stack · Description: Run the POC locally with Docker Compose. Producer CLI, consumer CLI, API, worker, Redis, SQLite. No managed registry, no SLA, no retention guarantees — but every line of code is yours. · Features: Producer CLI and consumer CLI · API, worker, Redis, SQLite via Docker Compose · Local seals and receipts · Self-signed receipts (your key) · Community support via GitHub · **CTA:** Read the quickstart
  - **Team** (featured, badge "Most teams start here") · Talk to us · Managed registry + retention · Description: Hosted API, managed worker pool, audited registry, and dashboards. For teams committing recurring datasets and serving external verifiers without standing up infrastructure themselves. · Features: Everything in Self-host · Managed API + worker pool · Retention up to 1 year by default · Producer and verifier dashboards · Audit-grade verification logs · Email support with response targets · **CTA:** Request access
  - **Business / Enterprise** · Talk to us · Custom SLA + dedicated anchoring · Description: For regulated industries, IP-heavy practices, and AI labs that need indefinite retention, anchored seals, custom DPAs, and procurement support. · Features: Everything in Team · Indefinite retention available · External anchoring (timestamp authority / chain) · Custom DPA and procurement support · 99.9% uptime SLA · Dedicated support channel · **CTA:** Talk to sales →

### How usage works (white)
- **Eyebrow:** How usage works
- **H2:** Three meters. Everything else is unlimited.
- **Lead:** On the managed tiers, three things are metered: how often you commit new roots, how often anyone verifies against them, and how long you keep them live. Corpus size doesn't matter to us; we never see it.
- **Three meter cards (name · big-typeset cost in accent · body):**
  - **Commit** · 1 unit · Register a new seal with the managed registry. Most producers commit once per dataset revision — the unit cost is per registration, not per byte of dataset.
  - **Verify (passage)** · 0.01 unit · Generate and serve a single match or no-match receipt. Verifying a 1,000-passage artifact costs about 10 units. Receipts are returned as machine-readable JSON.
  - **Retention (per seal per month)** · 0.5 unit · Keep a seal queryable beyond the default retention window. Most seals expire on a fixed schedule; long-lived seals pay a small monthly carry.
- **CodeBlock (sample usage):**
  ```
  Sample monthly usage for an AI lab on Team tier:

    Commits:      4 dataset revisions × 1 unit       =     4 units
    Verifies:     30,000 passages across counterparties × 0.01
                                                    =   300 units
    Retention:    4 seals × 0.5 / month       =     2 units
                                                      ───────────
                                                      306 units / month
  ```

### Compare tiers (off-white)
- **Eyebrow:** Compare tiers
- **H2:** What's in each tier.
- **Lead:** Full feature comparison. If you're trying to figure out whether a capability you need is in the tier you're considering, it's here.
- **Comparison table** (columns: Self-host · Team · Business · Enterprise). Categories and rows:
  - **Product:** Producer CLI (✓ all) · Consumer CLI (✓ all) · Match and no-match receipts (inclusion + exclusion) (✓ all) · Offline receipt verification (✓ all)
  - **Registry:** Self-hosted registry (✓ all) · Managed registry (— Self-host, ✓ rest) · External anchoring (— Self-host/Team, ✓ Business/Enterprise)
  - **Access and audit:** Public, allowlist, and private modes (✓ all) · Audit log per verification (✓ all) · Dashboards (— Self-host, ✓ rest) · Retention (Self-host: you decide · Team: up to 1 year · Business: up to 7 years · Enterprise: indefinite) · SIEM-friendly log export (— Self-host, ✓ rest)
  - **Support and SLA:** Community support (GitHub) (✓ all) · Email support (— Self-host, ✓ rest) · Priority response (— Self-host/Team, ✓ Business/Enterprise) · Dedicated support channel (✓ Enterprise only) · Uptime SLA (Self-host: — · Team: 99.5% · Business: 99.9% · Enterprise: 99.95%)
  - **Compliance and procurement:** Standard DPA (— Self-host, ✓ rest) · Custom DPA (✓ Business/Enterprise) · Custom procurement support (✓ Business/Enterprise)

### Sizing (white)
- **Eyebrow:** Sizing
- **H2:** Most teams land in the tier that matches their use case.
- **Lead:** Volume scales with the number of seals you maintain and how many verifiers query them. The tiers are sized for typical usage — a handful of corpora updated monthly, verified by counterparties on request. If your shape is different, talk to us.
- **Two-column body:**
  - *Picking your tier* — How to think about which tier fits:
    - *Evaluating, internal use only:* Self-host fits perfectly. The reference Docker Compose stack is the same product the managed tiers run.
    - *Recurring seals + a handful of verifiers:* Team tier is the typical fit. Managed registry, dashboards, retention, and audit-grade logging without standing up infrastructure.
    - *Regulated buyers, audit retention, multi-year datasets:* Business tier. Longer retention, external anchoring, and a custom DPA path. Talk to sales for a fit conversation.
    - *AI labs, dataset publishers, IP-heavy practices:* Enterprise tier. Indefinite retention, dedicated anchoring, custom procurement.
    - Trailing: If you're not sure, start with Self-host. The CLIs and protocol are the same; moving to the managed registry later is a configuration change, not a migration.
  - *When to talk to sales* — A few situations where sales-assisted onboarding works better than self-serve:
    - You need a custom DPA, BAA, or compliance documentation for procurement review
    - You need seals anchored to an external timestamp authority or public chain
    - Your dataset must be queryable for more than a year
    - You expect sealing or verification volume above a few thousand per month
    - You need integration with an internal records management or evidence system
    - Trailing: For any of those, email sales@trustedmodel.dev or use the form below.

### Pricing FAQ (off-white)
- **Eyebrow:** Common questions
- **H2:** Pricing questions, answered.
- **Q&A pairs (10 total):**
  1. *What's the difference between Self-host and the managed tiers?* — Self-host is the open reference stack: producer CLI, consumer CLI, API, worker, Redis, SQLite, all running on your hardware. Managed tiers run the API and registry on our infrastructure with retention, dashboards, and SLAs. The protocol is the same; the operating model is different.
  2. *Do you ever see my dataset content?* — No. The producer CLI prepares and fingerprints content locally; only hashes and metadata are ever transmitted. The same is true on the consumer side. There is no plaintext path through Trusted Model — the architecture forecloses it, not just our policy.
  3. *What happens to seals when retention ends?* — The root and audit log are deleted from the managed registry. Existing receipts that consumers already hold remain valid and verifiable offline against the root they recorded — proofs don't expire just because the registry stops serving new ones. If you need indefinite retention, the Business and Enterprise tiers support it.
  4. *Can I verify against a seal after it's been revoked?* — If the producer revokes a seal, the registry returns a stale-root response to new verification requests. Receipts issued before revocation remain still valid — anyone holding one can still verify it offline.
  5. *Do you support multi-modal corpora?* — Not yet. The current text preparation spec covers text. Images, audio, and structured data are on the Phase 4 roadmap. The protocol shape is the same; what changes is the normalization rules per modality.
  6. *How do external verifiers trust the timestamp?* — On the managed tiers, the registry attests to the seal date. On Business and Enterprise, seals can additionally be anchored to an external timestamp authority or public chain — verifiers gain a second, independent proof of existence. Most regulated buyers want both.
  7. *Is there a free tier for the managed product?* — Not currently. The Self-host tier is the free path. If you need the managed registry, talk to us — we'll size it based on your commit and verify volume.
  8. *Can I cancel?* — Anytime. Self-host has no minimum. Managed contracts run their term and don't auto-renew unless you opt in. We don't lock you in beyond the value of the product.
  9. *How long does a typical pilot run?* — Most pilots are 4-8 weeks. Phase 1 is committing your first real dataset and verifying it end-to-end. Phase 2 is wiring it into your existing records or evidence workflow. We help with both.
  10. *Are nonprofits, academic groups, or open-source projects discounted?* — Talk to us. We'll work with qualified organizations on custom pricing — and the Self-host tier is always available.

### Final CTA (white)
- **H2:** Self-host today, or talk to us about a managed deployment.
- **Lead:** Self-serve is the Docker Compose POC. Sales-assisted is the managed registry. Either way, you'll be making verifiable claims in days, not quarters.
- **Buttons:** Request access (→ `/access`) · Talk to sales →

---

## 10. `/solutions/*` — shared template

All five solutions pages share the same six-section template. Only the verticalized copy differs. Common shape:

1. **Hero** (white, centered) — Eyebrow `Solutions / <vertical>` · H1 · 720px lead · Primary CTA button.
2. **The problem in <vertical>** (off-white) — Eyebrow · H2 (a hard truth in one sentence) · Lead · Three pain columns.
3. **The fit** (white) — Eyebrow · H2 (how the protocol fits the workflow) · Lead · Five item descriptions.
4. **What this looks like** (off-white) — Eyebrow · H2 · (optional lead) · Three `<ScenarioBlock>` scenarios (prompt + verification result + paragraph body).
5. **Deployment** (white) — Eyebrow · H2 · (optional lead) · Four numbered steps · footnote about Business/Enterprise upgrades or pricing.
6. **Final CTA** (off-white) — H2 (one-line call) · Lead · Buttons (Request early access · Talk to sales →).

`<ScenarioBlock>` chrome (defined in `site.tsx`):
- Artifact label: **ARTIFACT** (12px uppercase, wide tracking, neutral-500)
- Verification result label: **VERIFICATION RESULT** (same treatment)

Below: the per-vertical copy.

### 10.1 `/solutions/training-data`

- **Eyebrow:** Solutions / Training data integrity
- **H1:** Prove what was — and wasn't — in your training data.
- **Lead:** AI labs, dataset publishers, and content licensees need to answer match and no-match questions about training data without revealing the data itself. Trusted Model gives you a single seal to publish and verifiable receipts to serve — without ever exposing the dataset.
- **Primary CTA:** Request early access

**Problem section H2:** "Was my content in your training set?" is the question that won't go away.
**Lead:** Copyright litigation, regulator inquiries, and licensee audits are all converging on the same demand: prove what was in the training dataset, prove what wasn't, and do it without disclosing the dataset. The standard answers — internal logs, redacted samples, contractual assertions — don't survive the question.
**Pain columns:**
- *"Was this in your training set?"* — Content owners, regulators, and licensees are asking this question more often. The answers today rely on internal logs and good-faith assertions. Neither is checkable from outside the lab.
- *Confidential data is unverifiable data.* — A lab can't open its training dataset to every claimant. The dataset is the asset; revealing it forfeits the protection. So most labs say nothing — which protects the asset and forfeits credibility.
- *Internal records can change.* — Server logs can be rewritten. Cloud snapshots can be replaced. "This file existed on date X" is an assertion until someone outside the company can verify it.

**Fit section H2:** Built around the answer training-data buyers actually need.
**Lead:** The protocol's defaults aren't tuned for a generic use case — they're tuned for the training-data verification workflow: a one-time seal per dataset revision, repeated match and no-match receipts for licensees and claimants, audit-grade timestamping throughout.
**Items:**
- *Seal once, answer forever.* — When the training dataset is finalized, the producer tool turns it into a single tamper-proof seal. Publish the seal once; anyone with a future question can check against it indefinitely.
- *Match receipts for licensees.* — A content licensee samples a piece of their own content and checks it against the seal. They learn what's included — and the lab never has to show them anything else.
- *No-match receipts for accused content.* — An author claims their text was used in training. They check their text against the seal and get a receipt for every passage that provably wasn't there. The author gets the answer; the lab never reveals what was.
- *Trustworthy timestamps.* — Every seal records when it was published. "We had this dataset on date X" becomes a checkable fact, not a memo. Disputes about timing reduce to a quick receipt check.
- *Open-source tools.* — The producer and consumer tools are open source. A skeptical licensee can run the consumer tool themselves — they don't have to trust the lab, and they don't have to trust us. The math is the trust anchor.

**Scenarios H2:** Three real verification flows.
**Lead:** The shape is always the same — a verifier presents chunk fingerprints, the registry returns proofs against the committed root, both sides retain receipts. Here's what that looks like in the conversations that actually happen.
**Scenarios:**
1. **Licensee match check** — Artifact: licensee submits 12 articles → 462 passages. Verification result: 458/462 match · 4 no-match · receipt signed · passes. Body: The licensee confirms 458 of their 462 passages were in the sealed training dataset and identifies the four that weren't (likely a publication-date or formatting boundary). The lab never sees the licensee's content; the licensee never sees anything else from the dataset. Both sides have a receipt of the result.
2. **Author asserts unauthorized use** — Artifact: author fingerprints novel, 8,914 passages; seal pre-dates novel. Result: no match for all 8,914; seal published 2025-09-04; novel published 2025-11-12; receipt confirmed. Body: Because the seal predates the novel, and because every passage produced a no-match receipt, the lab has evidence the novel wasn't in the training dataset as of the seal date. The author keeps the receipt; the lab retains nothing about the author's content.
3. **Regulator dataset audit** — Artifact: regulator submits category samples (pii_health · pii_financial · copyrighted_news · copyrighted_books). Result: per-category receipts (e.g., pii_health 458/500 match · pii_financial 0/500 · copyrighted_news 120/500 · copyrighted_books 0/500). Body: The regulator now has a structured, signed answer to a specific question — which categories of content were present in the training dataset — without ever seeing the dataset itself, and without the lab ever exposing it.

**Deployment H2:** From sign-up to verifiable claims in days.
**Lead:** The producer side is mostly local work. The hardest part is usually picking the right text-preparation version and the right retention policy — both decisions we'll help you reason through during onboarding.
**Steps:**
- 01 — Initial setup (typically days 1-3). Run the self-hosted stack with Docker Compose, or sign up for the managed service. Generate a signing key so verifiers can confirm your seals are really yours, and pick your default retention and access settings.
- 02 — First dataset sealed (typically days 3-10). Run the producer tool against a real dataset. The dataset never leaves your machine; only the seal goes to the service. On the Business and Enterprise tiers, the seal is anchored to an outside timestamp authority too.
- 03 — First end-to-end check (typically week 2). Run the consumer tool against a sample you know was in the dataset and one you know wasn't. Both should produce receipts you can confirm yourself, offline.
- 04 — Open the door to verifiers (typically weeks 3-8). Publish the seal and your verifying key. Set up allowlists if you want to limit who can check. Brief your legal and communications teams on the workflow so they can route inquiries to it.
- Footnote: Custom DPA and external anchoring available for Business and Enterprise tiers.

**Final CTA H2:** Turn "trust us" into a receipt anyone can verify.
**Lead:** We're working with a small group of training-data design partners through 2026 — AI labs and dataset publishers piloting verifiable seals against real licensee and regulator workflows. If that's you, we'd like to hear from you.

### 10.2 `/solutions/legal-ip`

- **Eyebrow:** Solutions / Legal & IP
- **H1:** Defensible evidence for IP, priority, and trade secret claims.
- **Lead:** Legal teams, content owners, and research groups need to prove what they had, when they had it, and what they didn't — without disclosing the underlying material. Trusted Model turns confidential content into a checkable, timestamped seal that holds up adversarially.

**Problem H2:** "We had it first" needs to be a proof, not a memo.
**Lead:** Authorship disputes, trade secret matters, and copyright defense all hinge on facts about what content existed where and when. Today's evidence — internal records, timestamped emails, custodial backups — is admissible but contestable. The harder the opponent, the more the record gets attacked.
**Pain columns:** Priority is hard to prove. · Disclosure forfeits the asset. · Custodial logs are not evidence.

**Fit H2:** Built for the standards counsel actually has to meet.
**Items:** Timestamped seal, no disclosure. · Selective disclosure during dispute. · No-match receipts for accused infringers. · Audit-grade chain of custody. · Per-matter segregation.

**Scenarios H2:** Three patterns counsel keeps running into.
**Scenarios:**
1. **Priority claim on a manuscript** — Seal of a 142k-word manuscript on 2026-02-04 predates published article and the author's own publication. Receipt produces seal date, signer key, root hash, external anchor.
2. **Defense against infringement claim** — Counsel fingerprints claimant's 18 paragraphs and verifies against published seal of brief; 18/18 no-match.
3. **Trade secret disclosure boundary** — Plaintiff produces per-passage match receipts for specific contested content sealed prior to defendant's departure.

**Deployment H2:** From sign-up to defensible record in days.
**Steps:** 01 Initial deployment · 02 First matter sealed · 03 First verification workflow · 04 Operational rollout.
**Footnote:** Custom DPA, external anchoring, and indefinite retention available for Business and Enterprise tiers.

**Final CTA H2:** Make priority a proof, not a debate.

### 10.3 `/solutions/research-provenance`

- **Eyebrow:** Solutions / Research provenance
- **H1:** Preregister, prove, replicate — without disclosing.
- **Lead:** Research groups, journal editors, and replicators need defensible evidence that a dataset, hypothesis, or analysis existed on a specific date — without forcing disclosure of the work itself. Trusted Model turns timestamps into proofs and reproducibility into mechanism.

**Problem H2:** Preregistration and reproducibility are in tension with confidentiality.
**Pain columns:** Preregistration leaks the asset. · Reproducibility relies on goodwill. · Priority disputes get ugly fast.

**Fit H2:** Built for the workflow research groups actually run.
**Items:** Preregister without disclosing. · Per-publication seals. · Replicator-friendly proofs. · Negative results, safely. · Defensible chain of custody for review.

**Scenarios H2:** Three workflows research groups have actually asked for.
**Scenarios:**
1. Dataset preregistration — Seal of a 217k-passage dataset; verifying-key published with paper.
2. Replicator confirms a published dataset — 217,118/217,118 passages match against published seal.
3. Confidential priority claim — Lab A produces match receipts against seal dated 2025-08-12 predating Lab B's earliest record.

**Deployment H2:** From sign-up to first seal in days.
**Steps:** 01 Initial deployment · 02 First seal · 03 Establish the SOP · 04 Publish verifying keys.
**Footnote:** Discounted academic pricing available — talk to us.

**Final CTA H2:** Make priority and reproducibility checkable.

### 10.4 `/solutions/journalism`

- **Eyebrow:** Solutions / Journalism & publishing
- **H1:** Provenance for the documents your reporting rests on.
- **Lead:** Newsrooms and publishers need durable, defensible evidence of what they had, when they had it, and what they didn't — both for editorial defense and for the wave of licensing disputes that follow large-scale AI training. Trusted Model is the product that makes those questions checkable.

**Problem H2:** The attack on the record is the attack on the story.
**Pain columns:** Source documents need provenance. · Drafts get attacked retroactively. · Republication and licensing claims.

**Fit H2:** Built around how newsrooms actually move documents.
**Items:** Seal source documents at intake. · Seal drafts on a schedule. · No-match receipts for fabrication claims. · Selective disclosure for source protection. · Licensing claims with structural basis.

**Scenarios H2:** Three newsroom workflows.
**Scenarios:**
1. **Source document intake** — Seal 1,400 leaked pages verbatim before editing; produce match receipts for quoted pages later.
2. **Draft milestone chain** — Four committed milestones (first draft → lawyered → fact-checked → publication-ready) with per-editor signing keys.
3. **Republication / licensing claim** — 1,861/2,400 article-level passages match; receipts tied to seal dates predating model release.

**Deployment H2:** From sign-up to verifiable record in days.
**Steps:** 01 Initial deployment · 02 Intake workflow · 03 Draft milestone workflow · 04 External anchoring.

**Final CTA H2:** Make the record defensible, not testimonial.

### 10.5 `/solutions/regulators`

- **Eyebrow:** Solutions / Regulators & auditors
- **H1:** Targeted audit without forced disclosure.
- **Lead:** Regulators overseeing AI training data, copyrighted-work inclusion, and restricted-category exclusion need a way to ask specific questions and receive verifiable answers — without forcing total disclosure of the dataset or relying on self-attestation. Trusted Model is the product that makes that possible.
- **Primary CTA:** Talk to us about regulatory adoption (→ `/contact`) — note: this page uses a different primary CTA than the others.

**Problem H2:** Auditing modern training corpora requires a new technical tool.
**Pain columns:** You can't audit what you can't see. · Self-attestation is not evidence. · Sampling doesn't scale.

**Fit H2:** Built for an audit regime that's specific and structural.
**Items:** Audited entity seals; regulator verifies. · Targeted, not exhaustive. · Defensible chain of custody. · Public-mode seals for population-level oversight. · Receipts admissible across jurisdictions.

**Scenarios H2:** Three audit patterns.
**Scenarios:**
1. **Restricted-category audit** — Regulator submits 487/502/124/90 passages across four restricted categories; every chunk returns a no-match (exclusion) receipt.
2. **Copyrighted-work registry verification** — Trade group registry of 8.4M fingerprints across 142k works; 87,512 fingerprints match across 9,418 works.
3. **Cross-border inquiry** — Regulator A queries public-mode seal of entity in Jurisdiction B; no MLAT process required for the technical inquiry.

**"How the audit regime operates" H2** (replaces Deployment label): From mandate to verified finding.
**Steps:** 01 Regulatory mandate (varies) · 02 Regulated entity commits (days) · 03 Regulator verifies (continuous) · 04 Audit findings (as required).
**Footnote:** Regulators with active oversight mandates: contact us about standards consultation and adoption support.

**Final CTA H2:** Make audit a checkable record.
**Buttons:** Talk to us · Request access →

---

## 11. `/docs` — Docs index

[apps/corp/app/docs/page.tsx](../apps/corp/app/docs/page.tsx). Layout uses the 820px column (narrower than marketing pages).

- **Eyebrow:** Documentation
- **H1:** Trusted Model docs.
- **Lead:** Practical references for running the POC, integrating the CLIs, and reading the protocol. If you're just here to try it, start with the quickstart.
- **DocsNav active link:** index
- **Section cards (each a hoverable bordered block linking to the doc):**
  - **Quickstart** → `/docs/quickstart` — Get the POC running end-to-end in about a minute. Install, bring up the API + worker + Redis with Docker Compose, run the demo script, see receipts land in `./output`.
  - **Producer CLI** → `/docs/producer-cli` — Commit a private text corpus to the API without uploading raw text. Commands, flags, sample invocations, receipt format, and common failures.
  - **Consumer CLI** → `/docs/consumer-cli` — Verify a local artifact against a committed snapshot. Match receipts, no-match receipts, full vs. sampled, and the verification receipt format.
  - **API reference** → `/product/api` — Build directly against the HTTP API. Two primary operations — commit and verify — plus health and metadata endpoints. Stable, small, easy to integrate.
  - **Protocol spec** → `/product/protocol-spec` — Canonicalization rules, fingerprint construction, seal, inclusion and no-match receipt formats, receipt structure. The normative wire spec.
- **Status block:**
  - H2: Status
  - Body: The reference stack is open-source and runs end-to-end locally. The managed registry is in active development; feature parity with Self-host plus retention, dashboards, and SLAs. See the roadmap.
  - CodeBlock:
    ```
    Format version:   v1
    Hash function:    strong fingerprints
    Signing:          digital signing
    Reference stack:  Node 20 + pnpm, open-source
    Deployment:       docker compose up
    ```
- **Closing CTAs:** Start with the quickstart (button → `/docs/quickstart`) · Talk to us → (→ `/contact`)

---

## 12. `/docs/quickstart`

[apps/corp/app/docs/quickstart/page.tsx](../apps/corp/app/docs/quickstart/page.tsx).

- **Eyebrow:** Documentation
- **H1:** Quickstart
- **Lead:** Get the Trusted Model POC running end-to-end in about a minute. The demo script will seal the seeded dataset, list snapshots, and run three verifications (exact, partial, no-match) with receipts landing in `./output`.
- **DocsNav active link:** quickstart
- **Sections (each opens with `H2` at 20px medium):**
  - **Prerequisites** — list: Node 20+ · pnpm 9+ · Either Docker (easiest) **or** a local Redis (`brew install redis`).
  - **1. Install + build** — CodeBlock: `pnpm install` / `pnpm -r build`.
  - **2. Start the backend** — Lead: Pick one of the two options below. Both result in an API listening on `http://localhost:4000` and a SQLite database at `./data/trusted-model.sqlite`.
    - *Option A — Docker Compose (recommended)* — CodeBlock: `docker compose up -d redis api worker` / `curl -fsS http://localhost:4000/health`.
    - *Option B — Local processes* — CodeBlock starting `redis-server --port 6379` and `node apps/api/dist/index.js` / `node apps/worker/dist/index.js`.
  - **3. Run the full demo** — CodeBlock: `./scripts/demo.sh`. Body: The script runs in order, then the four numbered steps:
    1. Waits for `/health`.
    2. Producer seals `./examples/producer-corpus`.
    3. Consumer lists snapshots.
    4. Consumer verifies `exact-match.txt`, `partial-match.txt`, and `no-match.txt` (the last with `--full-proofs`).
    Trailing: Receipts land in `./output`.
  - **4. Tear down** — CodeBlock: `docker compose down -v` / `rm -rf ./data ./output`.
  - **Next steps** — bulleted links to Producer CLI guide, Consumer CLI guide, Protocol spec.

---

## 13. `/docs/producer-cli`

[apps/corp/app/docs/producer-cli/page.tsx](../apps/corp/app/docs/producer-cli/page.tsx).

- **Eyebrow:** Documentation
- **H1:** Producer CLI
- **Lead:** Commit a private text corpus to the Trusted Model API without uploading the raw text.
- **DocsNav active link:** producer-cli
- **Sections:**
  - **What it does** — paragraph + two-column "Uploaded vs Not uploaded":
    - Uploaded: fingerprint type · fingerprint hash · occurrence count · leaf hash · snapshot metadata · claimed root
    - Not uploaded: raw text · filenames · paths · source positions · document titles
  - **Commands** — CodeBlock: `trusted-model-producer commit <corpusPath> [flags]` / `trusted-model-producer job <jobId> --api <url>`. Trailing: In the unbuilt repo, invoke as `node apps/producer-cli/dist/index.js <command> ...`.
  - **commit** — flag table (`<corpusPath>`, `--api`, `--api-key`, `--model`, `--version`, `--snapshot`, `--out`, `--no-wait`). Limits: at most 50,000 unique fingerprint keys; each `.txt` file ≤ 1 MB.
  - **Sample commands** — two CodeBlocks (sealed example corpus; submit without waiting + recover later).
  - **Receipt** — paragraph + key-fields table (commitmentId, jobId, producerId, producerName, modelName/Version, snapshotId, policyId, merkleRoot, attestationId, attestationTimestamp, apiBaseUrl, localRootVerified). Trailing: If `localRootVerified` is `false`, the CLI exits non-zero — your local tree disagrees with what the server registered.
  - **Common failures** — list:
    - `merkle root mismatch` — Your submitted leaves don't hash up to the claimed root. Usually a corrupted leaf in transit; rerun.
    - `snapshotId already registered` — Pick a new `--snapshot` value; snapshot ids are immutable.
    - `leafHash mismatch for <key>` — A leaf's stored hash doesn't equal strong fingerprints(type:hash:count). Rebuild the CLI.
    - `no usable .txt artifacts found` — The folder has no `.txt` files (or all were empty after text preparation).
    - `file exceeds 1 MB limit` — Split the file or trim it.
  - **Privacy summary** — what producer retains after commit · what API server stores · trailing: "Neither side has the raw text once it leaves the producer's filesystem."
  - **Next:** Consumer CLI guide →

---

## 14. `/docs/consumer-cli`

[apps/corp/app/docs/consumer-cli/page.tsx](../apps/corp/app/docs/consumer-cli/page.tsx). Mirrors the producer page.

- **Eyebrow:** Documentation
- **H1:** Consumer CLI
- **Lead:** Check whether a local `.txt` artifact (or pieces of it) appears in a committed Trusted Model snapshot without uploading the raw text.
- **DocsNav active link:** consumer-cli
- **Sections:**
  - **What it does** — paragraph + Uploaded vs Not uploaded:
    - Uploaded: snapshot id · document fingerprint hash · shingle fingerprint hashes · fullProofs flag
    - Not uploaded: raw text · filename · matched snippets
    - Caption: Matched snippets are reconstructed and printed **only locally** from the artifact you supplied.
  - **Commands** — CodeBlock: `trusted-model-consumer snapshots --api <url>` / `verify <artifactPath> [flags]` / `job <jobId> --api <url>`.
  - **snapshots** — flag table (`--api <url>` required). Lists every committed snapshot the API knows about.
  - **verify** — flag table (`<artifactPath>`, `--api`, `--snapshot`, `--out`, `--full-proofs`, `--no-wait`). Limits: up to 10,000 shingle fingerprints per submission.
  - **Sample commands** — five CodeBlocks: list snapshots · exact-match verify · partial-match verify · no-match verify with `--full-proofs` · async submit + recover.
  - **What the report shows** — CodeBlock prints the document and shingles report layout, including sample matched snippets.
  - **Receipt** — paragraph + table (`sampleMatchedSnippets`, `proofsVerifiedLocally`). Trailing: If `proofsVerifiedLocally` is `false`, the CLI exits non-zero — the receipt is still saved, but one or more proofs don't trace to the snapshot root.
  - **Common failures** — list:
    - `snapshot not found` — The snapshot id doesn't exist on this API. Run snapshots to list.
    - `artifact is empty` — File prepares to zero tokens. No fingerprints to send.
    - `artifact exceeds 1 MB limit` — Split the file.
    - `job not completed yet` — When calling job `<jobId>` early — wait and retry; default polling timeout is 60s.
  - **Privacy summary** — what consumer retains · what server learns · trailing: "The server never sees the artifact's raw text, filename, or any reconstructable snippet."
  - **Previous:** ← Producer CLI guide

---

## 15. `/about`

[apps/corp/app/about/page.tsx](../apps/corp/app/about/page.tsx).

### Hero (white)
- **Eyebrow:** About
- **H1:** We're building the verification layer for the AI era.
- **Lead:** Trusted Model is an independent project building verifiable dataset verification — so that "did this dataset contain that text?" becomes a question with a checkable answer, not a debate.

### "Why this, why now" (off-white)
- **Eyebrow:** Why this, why now
- **H2:** The questions about AI training data aren't going away.
- **Three paragraphs:**
  1. Every quarter brings another wave of "was my content in your training set?" lawsuits, regulator inquiries, and licensee audits. Every quarter the answers rely on the same combination of contracts, internal logs, and good faith — none of which hold up adversarially.
  2. The math behind this — verifiable seals, match and no-match receipts, consistent text preparation — has existed for decades. It's not novel. What's been missing is a product opinionated enough to actually deploy: one that specifies how text gets normalized, how pieces get fingerprinted, how receipts get checked, and how the service stays out of the plaintext path.
  3. Trusted Model is that product. The reference implementation is open source. The managed registry is for teams that need a third-party-operated piece of the puzzle. Everything else stays local, where it should.

### "Get in touch" (white)
- **H2:** Get in touch.
- **Lead:** For early access, customer conversations, partnership inquiries, or anything else, reach out. We respond to every email from a real human.
- **CTAs:** Request early access (button → `/access`) · Talk to sales → (`/contact`) · drew@trustedmodel.dev (mailto)

---

## 16. `/access`

[apps/corp/app/access/page.tsx](../apps/corp/app/access/page.tsx). Uses **compact header & footer** (no nav, just back link).

### Hero (white)
- **Eyebrow:** Privacy-preserving dataset verification
- **H1:** Be among the first to deploy Trusted Model.
- **Lead:** Trusted Model lets producers seal a private text dataset and verifiers prove match or no-match of their own text — all without anybody uploading raw content.

### Three-line value props (divided list)
- *Seal a dataset without revealing it.* — Fingerprints and a verifiable root. Raw content never leaves your machine.
- *Prove inclusion or exclusion offline.* — Verifiers receive receipts they can check locally — no trust in the registry required.
- *Open source first.* — The reference stack runs on Docker Compose. Managed registry available when you need retention and SLAs.

### Reassurance paragraph
The reference implementation is open source. The managed registry is for teams that need retention, dashboards, and SLAs. Either way, we never see your dataset.

### Form section (off-white, centered)
- **H2:** Request early access
- Form: `<RequestForm />`

---

## 17. `/contact`

[apps/corp/app/contact/page.tsx](../apps/corp/app/contact/page.tsx).

### Hero (white)
- **Eyebrow:** Contact
- **H1:** Reach the right person.
- **Lead:** We respond to every email from a real human. Pick the channel that fits and we'll route you to whoever can help fastest.

### Channels (off-white)
- **Eyebrow:** Channels
- **H2:** Pick the right channel.
- **Six cards (title · body · contact link[s]):**
  1. **Sales and demos** — For sales conversations, demo requests, custom pricing, and procurement support. Most useful if your organization needs the managed registry, custom retention, or external anchoring. — sales@trustedmodel.dev
  2. **Early access and pilots** — For early access requests and design partner inquiries. The fastest path is the early access form — we respond within a week. — Request early access → (`/access`)
  3. **Security and procurement** — For security reviews, vulnerability disclosure, DPA requests, and compliance documentation. Response within 48 hours for security inquiries; 2 business days for procurement. — security@trustedmodel.dev · trust@trustedmodel.dev
  4. **Customer support** — For existing customers needing help with their deployment, integration, or account questions. Tier-appropriate response targets apply. — support@trustedmodel.dev
  5. **Press and analyst** — For press inquiries, analyst briefings, and media requests. Response within 2 business days. — press@trustedmodel.dev
  6. **General inquiries** — For everything that doesn't fit elsewhere — partnerships, integrations, speaking engagements, careers, or anything we haven't anticipated. — hello@trustedmodel.dev

### Remote-first footer block (white, centered)
- **Heading:** Trusted Model
- **Sub-line:** Remote-first
- **Body:** We're a small, remote-first team. Most of our work is asynchronous; we don't have a physical office for visitors. For deliveries, certified mail, or anything requiring a physical address, email hello@trustedmodel.dev and we'll provide one.

---

## 18. `/legal/privacy`

[apps/corp/app/legal/privacy/page.tsx](../apps/corp/app/legal/privacy/page.tsx). Single-column 820px layout.

- **Eyebrow:** Legal
- **H1:** Privacy policy
- **Lead:** How Trusted Model handles personal and operational data on the managed tiers. The protocol's structural property — no raw content ever crosses the wire — closes most of the questions this kind of policy normally has to answer. We're specific about what's left.
- **Last updated:** May 12, 2026

**Sections (each `H2` 20px medium):**
1. **Scope** — This Privacy Policy applies to the managed Trusted Model service operated at `trustedmodel.dev` and to the marketing website. The Self-host distribution runs entirely on customer infrastructure and is governed by the open-source license — Trusted Model does not process any data on your behalf in that configuration.
2. **Categories of data we process** — Four bullet categories: *Commitment metadata* (root hash, scheme version, chunk count, timestamp, signer key fingerprint, retention policy, access mode) · *Verification metadata* (verifier identity, queried chunk fingerprints as hashes only, inclusion or exclusion verdict, proof payload, timestamp) · *Account & billing data* (admin contact name, work email, organization, payment method, invoice history) · *Operational telemetry* (request logs, error reports, service performance metrics with redaction applied to any protocol payload).
3. **What we do not process** — We do not receive, store, or transmit raw dataset content, raw consumer artifacts, or any reconstructable plaintext. The protocol is constructed so the only thing crossing the network is hashes and metadata. This is structural, not policy.
4. **Why we process it** — Operate the registry · manage the customer relationship and meet tax/accounting obligations · detect outages, improve reliability, respond to security incidents.
5. **Retention** — Commitment + verification metadata: per-seal config (30 days minimum to indefinite, tier-dependent) · Account + billing: life of the customer relationship + tax/accounting period (typically seven years) · Operational telemetry: 90 days unless an active incident requires longer.
6. **Subprocessors and international transfers** — Public list on trust page. Customers notified at least 30 days before a new subprocessor goes live. International transfers covered by SCCs or equivalent.
7. **Your rights** — Access, correction, deletion, portability, objection. Requests processed manually until Phase 2 managed registry ships, response times aligned to GDPR. Send to privacy@trustedmodel.dev.
8. **Security** — Encryption at rest (`strong encryption`), encryption in transit (`encrypted in transit`), signing with `digital signing`, role-gated staff access. Full posture on the security page.
9. **Changes to this policy** — Material changes announced by email to customer admin contacts at least 30 days before they take effect.
10. **Contact** — privacy@trustedmodel.dev · trust@trustedmodel.dev.

---

## 19. `/legal/terms`

[apps/corp/app/legal/terms/page.tsx](../apps/corp/app/legal/terms/page.tsx).

- **Eyebrow:** Legal
- **H1:** Terms of service
- **Lead:** The legal terms governing use of the managed Trusted Model service. These Terms are written to be readable. If something is unclear, write to us before you accept.
- **Last updated:** May 12, 2026

**Sections:**
1. **The agreement** — These Terms govern your use of the managed Trusted Model service. By signing up or by using the service on behalf of an organization, you agree to these Terms on that organization's behalf. The open-source Self-host distribution is governed by its accompanying license, not these Terms.
2. **The service** — Trusted Model operates a managed registry that records structural commitments to text corpora and serves match and no-match proofs against them. The protocol is local-first: the registry only ever holds hashes and metadata. We do not host raw customer content, and we cannot generate proofs that we did not legitimately issue.
3. **Acceptable use** — Four bullet prohibitions: do not commit content without legal right; do not misrepresent the time, scope, or signer of a seal; do not compromise the registry, falsify receipts, or interfere with verification; do not evade lawful disclosure obligations including duty-to-preserve. We reserve the right to suspend service for breach.
4. **Fees and payment** — Managed tiers billed monthly in arrears or annually in advance, per the order form. Late payments may suspend service following written notice. We don't mark up cloud or anchoring costs.
5. **Customer responsibilities** — You are responsible for the contents of the corpora you commit, for protecting your signing keys, and for the accuracy of any public claims you make about a seal.
6. **Our responsibilities** — Operate the registry with commercially reasonable care; maintain the security posture described on the security page; publish material subprocessor changes at least 30 days in advance; honor configured retention.
7. **Confidentiality** — Each party will protect the other's confidential information with the care it uses for its own.
8. **Data processing** — Standard DPA at `/legal/dpa`, incorporated by reference. Custom DPAs available — contact trust@trustedmodel.dev.
9. **Warranties and disclaimers** — Substantial conformity with documentation. No warranty of uninterrupted operation, legal sufficiency of receipts in a particular jurisdiction, or outcomes in disputes. Otherwise as-is.
10. **Limitation of liability** — No indirect/consequential damages; aggregate liability capped at 12 months of fees; standard carve-outs for fraud / willful misconduct / non-waivable damages.
11. **Term and termination** — 30 days' written notice for material breach plus opportunity to cure. Retention honored; previously issued receipts remain structurally valid offline.
12. **Governing law** — Delaware law; state and federal courts of Delaware; non-waivable local-law rights preserved.
13. **Changes** — Material changes announced by email to customer admin contacts at least 30 days before they take effect.
14. **Contact** — legal@trustedmodel.dev.

---

## 20. `/legal/dpa`

[apps/corp/app/legal/dpa/page.tsx](../apps/corp/app/legal/dpa/page.tsx).

- **Eyebrow:** Legal
- **H1:** Data Processing Agreement
- **Lead:** Standard DPA covering the data processing relationship between Trusted Model and Customer organizations on the managed tiers. For most mid-market customers this version is suitable without modification. Custom DPAs are available on the Business and Enterprise tiers.
- **Last updated:** May 12, 2026

**Sections:**
1. **Roles** — Customer is controller; Trusted Model is processor. Trusted Model's use of operational data is as controller of that data only.
2. **Scope of processing** — Only the data categories described in the Privacy Policy (seal metadata, verification metadata, account data, operational telemetry). Local-first design means raw corpus content and raw consumer content are not processed in any form.
3. **Instructions** — Process per documented Customer instructions, including configuration choices (retention policy, access mode, allowlists, signing keys). Trusted Model will inform Customer if an instruction would violate applicable law.
4. **Confidentiality** — Staff bound by written confidentiality obligations. Role-gated, audit-logged, reviewed quarterly.
5. **Security measures** — Bulleted list: strong encryption at rest with managed keys · strong encryption in transit; older protocols refused · producer-side digital signing of every seal · SSO + hardware-backed MFA for staff access · centralized audit logging with anomaly detection · annual third-party penetration testing (planned with GA).
6. **Subprocessors** — Current list on the trust page. 30-day notice before adding or replacing a subprocessor that processes Customer's personal data.
7. **International transfers** — SCCs (EU 2021/914) or UK IDTA as applicable.
8. **Privacy requests** — Trusted Model assists Customer in responding to individual requests within statutory timelines; forwards direct requests to Customer without undue delay.
9. **Personal data breaches** — Notification without undue delay, within 72 hours of awareness, with information needed for Customer to meet GDPR Article 33 obligations.
10. **Return or deletion** — On termination, return or delete per Customer's choice, subject to retention required by law and to the structural property that previously issued receipts remain offline-verifiable.
11. **Audits** — Trusted Model will provide information necessary to demonstrate Article 28 compliance and contribute to audits on reasonable notice and during normal business hours.
12. **Contact** — Custom DPA, security questionnaire responses, and audit report requests: trust@trustedmodel.dev.

---

## 21. Cross-page micro-copy index

A list of repeating UI strings — keep them consistent if you edit them.

| String | Locations |
| --- | --- |
| Request early access | hero CTAs on `/`, `/access`, `/product`, every solutions hero, every solutions final-CTA |
| Request access | header CTA · `/pricing` Team-tier card · `/regulators` final CTA |
| Talk to sales → | `/`, `/about`, `/product`, `/pricing`, every solutions final CTA |
| Talk to us → | `/docs`, `/about`, `/regulators` final CTA |
| Read the quickstart | `/` Pilot tier · `/pricing` Self-host card · `/product/cli` final CTA · `/docs` button |
| CLI reference → | `/product/api`, `/product/protocol-spec` |
| API reference → | `/product/cli`, `/product/protocol-spec` |
| Read the trust page → | `/security` subprocessors block |
| See full pricing details → | `/` pricing band |
| See how it works ↓ | `/` hero |
| See all capabilities → | `/` capabilities band |
| Read more → | `/` use-case cards |
| Read the full architecture → | `/` how-it-works band |
| Run the quickstart | `/product/protocol-spec` final CTA |
| Back to trustedmodel.dev | compact header on `/access` |
| Read the product spec | `/product/api` final CTA |
| ARTIFACT / VERIFICATION RESULT | all `<ScenarioBlock>` instances on every solutions page |
| Last updated: <date> | top of `/security`, `/trust`, every `/legal/*` page |
| © 2026 Trusted Model. All rights reserved. | footer (both variants) |
| Cryptographic corpus commitment and verification. | footer Column 1 (both variants) |

---

## 22. Edit log conventions

When you touch this guide:

- Update the per-page section in the same edit as the page change. Don't drift.
- If you add a new page, add it to this guide **and** to the appropriate footer column in `site.tsx`.
- If you rename an existing route, search this file for the old path and update both the heading and the internal cross-references.
- "Last synced" at the top of this file is the source of truth for freshness — bump it whenever you make non-trivial edits.
