# 0009 - The public landing page has its own visual system

Status: accepted
Date: 2026-11-26

## Context

`DESIGN.md` ("The Paper Tally") says system fonts only, no webfonts, and
`PRODUCT.md` says visitors should evaluate the real product, not a marketing
layer. Both were written for the app, where speed and calm matter most and the
person already knows what tally is.

The landing page at `site/` (GitHub Pages) has a different job: a stranger
lands on it from a shared link and has a few seconds to understand what tally
is and why it is not one more expense-splitting app. A page built from the
app's restrained system read as a document, not an invitation.

## Decision

**The landing page (`site/src/pages/index.astro` and its components) gets its
own visual system: Indian print ephemera (railway ticket, chai-stall bill,
matchbox labels, UPI standee, rubber stamps) tied together by a kolam line,
printed in a two-ink letterpress palette (vermilion, indigo, black on
newsprint), set in self-hosted Anek Latin / Anek Devanagari variable fonts.**

- The exception covers the landing page and the launch film only. The app keeps
  `DESIGN.md` unchanged: system fonts, earth tones, no webfonts in the bundle.
- The "real product" rule still holds in spirit: every claim on the page is a
  shipped feature, the screenshots strip is captured from the real demo, and
  the primary call to action is the live demo (`/demo`), not a sign-up.
- The launch film's soundtrack is generated in code in `video/` - no third-party
  audio, nothing to license.

## Consequences

- Two visual systems to keep honest. The landing page links into the app, so
  the change in look at that boundary is expected and fine; the copy uses the
  same `CONTEXT.md` terms on both sides.
- Fonts are subset and self-hosted on the site only; the app bundle gains
  nothing.
- Landing copy is hard-coded in Astro, not routed through `t()`. The `t()` rule
  is for the app; the site already worked this way.
