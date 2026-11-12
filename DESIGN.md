---
name: tally
description: Self-hosted expense splitting for friend groups, on paper, in earth tones.
colors:
  paper: "#f7f4ec"
  paper-2: "#fffdf7"
  paper-sunk: "#efeade"
  line: "#e0d9c8"
  line-2: "#cfc6b1"
  ink: "#23241d"
  ink-2: "#5c5f52"
  ink-3: "#68695d"
  moss: "#5c7355"
  moss-2: "#485c43"
  moss-wash: "#e6ece0"
  clay: "#94563c"
  clay-wash: "#f2e4dd"
  ochre: "#b08344"
typography:
  hero-amount:
    fontFamily: "ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum'"
  headline:
    fontFamily: "ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.25
  title:
    fontFamily: "ui-serif, Georgia, 'Times New Roman', serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
  amount:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.3
    fontFeature: "'tnum'"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  inner: "5px"
  field: "6px"
  base: "7px"
  chip: "8px"
  fab: "13px"
  sheet: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  card-x: "14px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.moss}"
    textColor: "{colors.paper}"
    rounded: "{rounded.base}"
    padding: "0 16px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "0 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.clay-wash}"
    textColor: "{colors.clay}"
    rounded: "{rounded.base}"
    padding: "0 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "12px 14px"
  segmented:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.base}"
    padding: "2px"
  segmented-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inner}"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.moss-wash}"
    textColor: "{colors.moss-2}"
    rounded: "{rounded.chip}"
  chip:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.chip}"
  fab:
    backgroundColor: "{colors.moss}"
    textColor: "{colors.paper}"
    rounded: "{rounded.fab}"
    size: "49px"
---

# Design System: tally

## Overview

**Creative North Star: "The Paper Tally"**

tally is a tally sheet kept on good paper: warm stock, dark ink, a few earth pigments, and every entry written so anyone at the table can check it. The working reference from the spec is "Notion's restraint, Linear's density, on paper, in earth tones." Calm and dense, not loud. The interface says very little, and every number on it can be traced back to the entries behind it.

The ground carries the material. A warm off-white paper (dark mode: warm ink-black) sits under two soft moss/ochre radial washes and a fractal-noise grain at 5.5% (10% in dark), drawn from one inline SVG with no image assets. Surfaces sit on that ground as flat raised cards or sunken fields, with no shadows. Moss is the structural colour of the app. It is not an accent sprinkled on top.

Values above are the default "paper" theme, keyed by their CSS custom property names (`--paper-2`, `--ink-3`, ...). Five more themes (dark, sakura, ocean, midnight, ember) redefine the same token names in `src/client/styles/tokens.css`. Every component reads tokens only, so a theme is just a new set of values.

**Key Characteristics:**

- Paper ground with grain and washes; flat raised cards; sunken fields.
- Moss carries structure (primary buttons, active nav, FAB, selection). Moss and clay are the owed/owe pair, and they differ in lightness as well as hue.
- System serif for screen titles and hero amounts; system sans with tabular numerals everywhere else. No webfonts.
- 44px minimum tap target on every control, whatever the visual density.
- Icons are authored inline SVG: 20px box, 1.6 stroke, `currentColor`.

## Colors

Warm paper neutrals, one structural green, and one earth red that means "owe".

### Primary

- **Moss** (`moss`): the structural colour. Primary buttons, the FAB, the active nav item, selected chips and segments, focus rings, chart fills. It also means "owed to you" / positive position.
- **Deep Moss** (`moss-2`): text on moss-wash, and the active nav label.
- **Moss Wash** (`moss-wash`): background of selected chips, the active rail item, success toasts.

### Secondary

- **Clay** (`clay`): negative positions ("You owe", "Asha owes"), errors, danger buttons. Darker than moss in every light theme, so the pair still reads in greyscale.
- **Clay Wash** (`clay-wash`): error toast and danger button fill.

### Tertiary

- **Ochre** (`ochre`): the third earth tone. Used for charts and the pinned-ledger star, never for meaning.

### Ledger identity

- Six stored colours (`moss, clay, ochre, plum, sky, rose`) each have a `--ledger-<value>` solid and `--ledger-<value>-wash` tint, per theme in `tokens.css`. They show as Teal, Indigo, Slate, Plum, Sky, Rose, so they never read as owed or owe. Use them only through `LedgerMark` and the colour picker.

### Neutral

- **Paper** (`paper`): the page ground and the text colour on moss buttons.
- **Raised Paper** (`paper-2`): cards, list rows, unselected chips, the nav bar/rail.
- **Sunken Paper** (`paper-sunk`): inputs, selects, the segmented-control track, skeletons, avatars.
- **Line / Strong Line** (`line`, `line-2`): card borders and dividers / ghost button borders, excluded-member dashed borders, scrollbar thumbs.
- **Ink** (`ink`): primary text and neutral amounts.
- **Muted Ink** (`ink-2`): secondary text, direction words ("You are owed"), inactive segments.
- **Faint Ink** (`ink-3`): labels, metadata, timestamps. It is the lightest text allowed and still clears 4.5:1 on every paper surface in every theme.

### Named Rules

**The Sign-And-Word Rule.** Moss and clay never carry meaning alone. Every position shows its sign (+ − ±) and its direction in words. Colour only backs up what the text already says.

**The No False Signal Rule.** Moss and clay are reserved for balances and state. Decorative elements (avatars, ledger accents, chart series) do not use them in ways that could be read as owed or owe. Avatars are neutral; ledger accents use their own fixed swatches.

**The Faint Floor Rule.** No text sits below `ink-3`, and no text is faded with opacity. To make a state look quieter, change the border or the icon, not the legibility of the words.

## Typography

**Display Font:** system serif (`ui-serif`, Georgia, Times New Roman)
**Body Font:** system sans (`ui-sans-serif`, system-ui, -apple-system, Segoe UI)

**Character:** The serif is the "paper" voice: screen titles, sheet titles and hero amounts, like a heading in a ledger book. The sans does the dense work, with tabular numerals so amount columns don't shift during optimistic updates. Both are system fonts, which costs no webfont weight.

### Hierarchy

- **Hero amount** (serif, 500, 38px, line-height 1, -0.02em, tabular): the viewer's net position on home and in a ledger. One per screen. The paise step down to 0.55em, like the pence column in a ledger book.
- **Headline** (serif, 400, 22px): page titles in `PageHeader`, and the onboarding title (26px).
- **Title** (serif, 400, 19px): sheet and dialog titles. Empty-state titles use 17px.
- **Body** (sans, 500, 15px): row titles (expense description, ledger name). Buttons use 15px semibold; small buttons 14px medium.
- **Amount** (sans, 400, 16px, tabular): every amount in a list.
- **Label** (sans, 400, 13px): field labels, metadata rows, amount labels, section headings (13px semibold, `ink-2`).

### Named Rules

**The Amount Component Rule.** Money only ever reaches the screen through `<Amount>`. It renders the sign, the label and the direction words, and it shows no number at all when offline.

**The 16px Field Rule.** Inputs and selects are 16px so iOS doesn't zoom when one is focused. Don't shrink them to fit a toolbar; size the wrapper around them instead.

## Layout

Mobile first: a single column with a 16–20px gutter (`px-4`/`px-5`), and a bottom tab bar (`--bar-h` 66px) plus a floating add button that clears it. The app is a fixed frame: `html`, `body` and `#root` are 100% tall, and only `<main>` scrolls, so the tab bar never slides away with the Android URL bar. Safe-area insets are reserved through `pad-safe-*` utilities.

At 768px and up, the tab bar becomes a 232px left rail with the brand and an "Add expense" button at its top, and the FAB is hidden. Content sits in a centred column up to 720px. Sheets become centred dialogs up to 520px. The home page title is visually hidden at this width, because the rail already shows the brand; it stays the page's h1.

Rhythm: cards are 8px apart (`mb-2`); the card inset is 12px vertical by 14px horizontal; field groups are 12px apart (`mb-3`); a section label has 8px below it. Toolbars are one row of 44px controls with 8px gaps, with sort pushed to the right.

## Elevation & Depth

Flat by default. Depth comes from tone: raised cards are lighter than the paper, fields are darker (sunken), and both have a 1px `line` border. The elevated surfaces are the FAB and toasts, the only things that float over scrolling content; they are the only ones with a shadow. Sheets and dialogs are separated from the page by a 38% black scrim, not by a shadow.

### Shadow Vocabulary

- **FAB lift** (`box-shadow: 0 4px 14px rgb(60 72 54 / 28%)`): the floating add button only.
- **Toast** (`shadow-sm`): the one toast surface, the only other elevated element.

### Named Rules

**The Browser Surface Rule.** Text selection is `moss-wash`, the caret is moss, and scrollbars are thin `line-2` thumbs. The parts the browser draws use the palette too.

**The One Shadow Rule.** Only the FAB and toasts, which float over scrolling content, get a shadow. Cards, buttons and dialogs never do.

## Shapes

Gently squared corners at a single base radius (7px) for buttons, cards, tabs and empty states. Fields are slightly tighter (6px). Segments inside a track are 5px, so they sit inside the 7px track with a 2px inset. Chips are 8px. Avatars are squircles (6px radius on 29–34px). The FAB is 13px, and the top corners of a bottom sheet are 14px (all four corners as a dialog). Borders are 1px everywhere; a dashed border means "excluded". Coloured side rules on cards are not used.

## Components

### Buttons

- **Shape:** base radius (7px), 1px border, at least 44×44px.
- **Primary:** moss fill, paper text, 15px semibold, 16px horizontal padding; hover shifts to `moss-2`.
- **Ghost:** transparent fill with a `line-2` border and ink text; hover fills `paper-sunk`. Used for secondary actions.
- **Danger:** clay-wash fill, clay border and text. Labels are action-specific ("Delete expense"), never "OK".
- **Loading:** a spinner appears beside the label, and the button is `aria-busy`. **Disabled:** 50% opacity.
- **Press:** every enabled button scales to 0.98 on press (150ms ease-out). Variant colours are classes, not inline styles, so hover reaches them.
- **Focus:** one 2px moss outline, 2px offset, on every interactive element (`focusRing`).

### Segmented control (Tabs, split mode)

- A sunken track (`paper-sunk`, 1px `line`, 2px inset) holding equal-width 44px segments. The active segment is paper-filled, ink, and semibold; inactive segments are `ink-2`. Used for the ledger tabs (as links) and for the split mode (as `aria-pressed` buttons).

### Chips

- **Category chip:** icon over label, 8px radius, raised-paper fill, `ink-2` label. When selected: moss-wash fill, moss border, deep-moss semibold label. They sit in a horizontally scrolling row with no visible scrollbar.
- **Participant chip:** avatar over name. Included: moss-wash fill with a solid moss border. Excluded: a dashed `line-2` border and a 40%-opacity avatar, with the name still at full legibility.

### Cards / Containers

- **Corner Style:** 7px.
- **Background:** raised paper with a 1px `line` border; no shadow.
- **Internal Padding:** 12px × 14px for rows; hero cards are larger.
- **Tappable rows** (`row-press`): the border lifts to `line-2` on hover (pointer devices only) and the row scales to 0.985 on press. A row that leads somewhere is one link, with a `forward` chevron and a short `ink-2` hint, not a row plus a repeated button.
- **Ledger accent:** a 10px swatch (3px radius) before the ledger's name, in the ledger's `--ledger-*` colour. Identity tile: `LedgerMark`.

### Inputs / Fields

- **Style:** sunken paper, 1px `line-2` border, 6px radius, 44px tall, 16px text. The label always sits above the field (13px, `ink-3`) and is never replaced by a placeholder. A rupee input has a fixed ₹ prefix inside it.
- **Focus:** the shared moss outline.
- **Error:** a 12px clay message under the field, `role="alert"`, inside the label so it's announced with the field.

### Navigation

- **Bottom bar (mobile):** raised paper, top border, four equal items with a 20px SVG icon over a 12px label. The active item is `moss-2`; the rest are `ink-3`.
- **Rail (768px+):** 232px wide with a serif brand, the primary "Add expense" button, then 15px rows. The active row has a moss-wash fill and is semibold.

### Icons

- One authored set in `ui/Icon.tsx`: ledgers, balances, insights, you, back, forward, down, close, plus, more, search, check. 20px grid, 1.6 stroke, round caps and joins, `currentColor`, always `aria-hidden`. Icon-only buttons are 44px and carry an `aria-label`, with a `paper-sunk` hover fill.

### Mark

- A drawn tally of five (four strokes and a strike) in moss, from `ui/Mark.tsx`. It sits before the wordmark in the rail, on the home header and on the welcome screen. It is the product's only emblem.

### Action placement

**The Next-Step Rule.** The action that resolves a number sits beside that number. The ledger position card carries "Settle" (filled when the viewer owes, ghost when owed). The expense sheet carries "Edit expense" next to the total. Destructive actions sit last in the sheet, with specific labels ("Delete expense"). Per-ledger rows that lead somewhere are whole-row links, not rows with repeated buttons. Banner actions are underlined text, not bordered buttons.

### Sheet

- A bottom sheet on mobile (slides up in 180ms ease-out); a centred dialog at 768px+ (fade plus scale from 0.97). Paper ground with grain, a sticky header with the serif title and a 44px close button. Escape closes only the topmost overlay.

### Amount

- The signature component: it holds the sign, the direction words and the colour together. As a hero, a serif 38px number sits under its direction words. Inline, the direction words sit beside a 16px tabular number. In neutral tone (totals and shares) it shows no direction words and uses ink.

### Primitives

Use these from `components/ui`; do not hand-roll the markup.

- **`SectionHeading`**: the one section title (13px semibold, `ink-2`), with an optional right-aligned action.
- **`Card`**: the one panel or list-row surface. `interactive` adds row press feedback.
- **`Segmented`**: one-of-N choice that is not a route (2 to 4 options, `aria-pressed`). **`Tabs`** is the route version and looks identical.
- **`IconButton`**: 44px icon-only control with a required `label`. `pressed` for toggles, `badge` for an active count.
- **`Badge`**: the one pill (neutral, moss or clay). **`FilterChip`**: one applied filter, removable.
- **`SearchField`**: always-visible search with a clear button.
- **`Notice`**: the one inline message box (`info`, `warn`, `danger`).
- **`LedgerMark`**: a ledger's identity tile. Decorative; the name is always shown beside it.

**One primary per view.** At most one filled moss `Button`; everything else is `ghost`, and destructive actions are `danger` in their own row at the bottom.

**Toolbar.** Search, filter and sort share one row directly above the list: a full-width `SearchField` and one `IconButton icon="filter"` that opens a "Filter and sort" `Sheet`. Applied filters show as `FilterChip`s under the toolbar with a result count.

**Motion tokens.** `--dur-fast` (150ms) for presses and menus, `--dur` (180ms) for entrances, `--ease-out`. Use the `.chip-press` class for hand-rolled chips (hover tint, press to 0.98), and `.menu-in` for menus and popovers (opacity plus a 4px drop).

## Do's and Don'ts

### Do:

- **Do** route every amount through `<Amount>` with a label; positions get a sign and direction words.
- **Do** keep all text at `ink-3` or darker; check new token values at 4.5:1 against `paper`, `paper-2` and `paper-sunk` in all six themes.
- **Do** draw icons as inline SVG (20px box, 1.6 stroke, round caps, `currentColor`).
- **Do** keep every control at least 44×44px, even in dense rows.
- **Do** use the segmented track for any one-of-N choice with four or fewer options.
- **Do** read colours from tokens only; a theme must be able to redefine everything.

### Don't:

- **Don't** add shadows to cards, buttons or dialogs. The FAB is the only exception.
- **Don't** use coloured left/right border stripes on cards or rows; use a swatch or a badge.
- **Don't** fade a state with `opacity` on text. Change the border style or the icon instead.
- **Don't** tint decorative elements moss or clay; those colours mean owed and owe.
- **Don't** use Unicode glyphs or emoji as interface icons. Emoji are user content only (ledger and category icons).
- **Don't** load webfonts; the serif/sans pair is system-only by design.
- **Don't** set inputs or selects below 16px.
