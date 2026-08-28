---
name: UST Rankings
description: Evidence-first rankings and course planning for the HKUST community.
colors:
  hkust-blue: "#003366"
  hkust-blue-mid: "#2b6297"
  hkust-gold: "#996600"
  hkust-yellow: "#CC9900"
  ink: "#020617"
  text: "#334155"
  muted: "#64748b"
  hairline: "#e2e8f0"
  surface: "#ffffff"
  field-bg: "#ffffff"
  soft-surface: "#f1f5f9"
  danger: "#ef4444"
  grade-red: "#ed1b2f"
  grade-orange: "#faa61a"
  grade-green-soft: "#a3cf62"
  grade-green: "#009a61"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(3.75rem, 8vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.05em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.2em"
  mono:
    fontFamily: "Roboto Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page-x: "clamp(16px, 4vw, 24px)"
  section-y: "clamp(48px, 8vw, 64px)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#f9fafb"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input-default:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
---

# Design System: UST Rankings

## Overview

**Creative North Star: "The Campus Ledger"**

UST Rankings should feel like a community-maintained academic ledger: independent, precise, transparent, and calm enough to trust during real enrolment decisions. The visual system borrows institutional cues from HKUST Blue and HKUST Gold, then restrains them inside a clean white-and-slate interface where evidence, rank, sample count, and state are always more important than decoration.

The current system is an operational web app, not a campaign site. Its craft comes from fast scan paths, crisp borders, readable density, tabular figures, compact controls, and small moments of polish: gradient institutional headers, gold title accents, grade-color badges, and view transitions that make navigation feel continuous without turning ranking work into spectacle.

**Key Characteristics:**

- Institutional blue/gold identity used sparingly over a white, slate, and gray working surface.
- Evidence-first hierarchy: titles, rank, grade, sample counts, and terms stay immediately scannable.
- Flat-by-default surfaces with borders; shadows appear mainly as state feedback.
- Rounded but not playful geometry: compact 6–8px controls, fuller pills only for search and identity affordances.
- Motion is purposeful navigation continuity, never ornamental animation.

## Colors

The palette is HKUST Blue and HKUST Gold over a neutral slate workspace, with ranking-grade colors reserved for evidence visualization.

### Primary

- **HKUST Blue**: The institutional anchor used for the site header, viewport theme color, histogram markers, and important campus-facing accents.
- **HKUST Blue Mid**: The header gradient bridge that keeps the blue field dimensional without adding a second brand hue.

### Secondary

- **HKUST Gold**: The official deeper gold used for the logo/title gradient and rare brand emphasis.
- **HKUST Yellow**: The brighter official yellow alternative used when gold needs more luminous digital presence; in the current title gradient it pairs with HKUST Gold.

### Tertiary

- **Grade Red, Grade Orange, Grade Soft Green, Grade Green**: Data colors for percentile grades and score distributions. These are semantic evidence colors, not decorative accents.

### Neutral

- **Ink**: Primary headings, button backgrounds, and high-emphasis text.
- **Text**: Main paragraph and supporting interface text.
- **Muted**: Secondary metadata, descriptions, placeholders, and helper copy.
- **Hairline**: Borders, dividers, and card outlines.
- **Surface**: Cards, footer, controls, and primary working surfaces.
- **Soft Surface**: Skeletons, tab backgrounds, hover fills, and low-emphasis panels.

### Named Rules

**The Evidence Color Rule.** Grade reds, oranges, and greens only represent ranking evidence or score distribution; do not use them as generic decoration.

**The Gold Rarity Rule.** HKUST Gold and HKUST Yellow are brand glints, not generic fill colors. Keep them rare enough that the UST Rankings title and key institutional cues remain special.

## Typography

**Display Font:** Inter (with system-ui fallback)  
**Body Font:** Inter (with system-ui fallback)  
**Label/Mono Font:** Roboto Mono for tabular and technical text where explicitly used

**Character:** The type system is crisp, modern, and utilitarian. It uses heavy negative-tracked headings for confidence, then relies on conventional readable body sizes and tabular figures for ranked data.

### Hierarchy

- **Display** (700, clamp from 60px to 72px, tight line-height): Product title moments such as the rankings masthead.
- **Headline** (700, 36–60px, tight line-height): Detail-page H1s and major page identities.
- **Title** (600, 24px, tight line-height): Card titles, section headings, and ranking result names.
- **Body** (400–500, 14–16px, relaxed line-height): Explanatory copy, descriptions, form copy, and dense operational reading.
- **Label** (700, 12px, wide tracking, uppercase when used as eyebrow): Eyebrows, metric labels, and compact metadata headings.
- **Tabular Figures** (usually 12–24px, tabular-nums): Ranks, scores, populations, sample counts, and chart labels.

### Named Rules

**The Scan First Rule.** Ranking screens must let a user read title, rank, grade, and evidence count before any secondary prose competes for attention.

## Layout

The app centers content inside a max-width 7xl shell, with page gutters of 16px on mobile and 24px from small screens upward. Most operational surfaces use a narrow, focused column by default (`max-w-sm`) and expand to a comfortable analysis width on large screens (`lg:max-w-2xl`), preventing ranking controls and cards from becoming stretched dashboards.

Spacing is simple and rhythmic: 8px for tight internal relationships, 12–16px for control/card gaps, 24px for card padding, 32px for major vertical stacks, and 48–64px for page-level breathing room. Responsive behavior prioritizes preservation of scan order: ranking cards move from compact mobile summaries to wider desktop rows without changing the evidence hierarchy.

## Elevation & Depth

This is a flat-by-default system. Depth is conveyed primarily through white surfaces, slate hairlines, tonal hover fills, and small state shadows. Static cards use a subtle shadow at most; interactive cards may lift to a medium shadow on hover while borders darken slightly.

### Shadow Vocabulary

- **Surface Rest** (`shadow-sm`): A barely-there card shadow for separating white cards from white or gradient-tinted backgrounds.
- **Interactive Hover** (`shadow-md`): Used on clickable ranking result cards to confirm the card is an actionable object.
- **Inset/Focus Ring** (`ring-2` with offset): Used for keyboard focus and validation, never as decoration.

### Named Rules

**The Flat Ledger Rule.** Surfaces rest flat. If a shadow appears, it must explain state, focus, or hierarchy.

## Shapes

The form language is gently rounded and practical. Cards use 8px corners, controls use 6px corners, tabs use smaller 4px active elements inside a 6px rail, and search/login affordances may become full pills. Borders are one-pixel slate or gray hairlines; clipping is rectangular and disciplined rather than organic.

## Components

### Buttons

- **Shape:** Compact rounded rectangle (6px radius), 40px default height.
- **Primary:** Near-black ink background with off-white text; used for direct actions that should not compete with HKUST Blue navigation.
- **Outline:** White background, gray hairline border, slate/ink text; used for secondary actions and recovery links.
- **Hover / Focus:** Hover darkens or tonally fills. Keyboard focus uses a 2px dark ring with offset.
- **Disabled:** Pointer events removed and opacity reduced to 50%.

### Chips / Badges

- **Style:** Full-pill badges for generic tags; larger grade badges use an 8px rounded square with white text, text shadow, and semantic grade fill.
- **State:** Grade badges are evidence markers and should remain visually loud; generic badges stay compact and neutral unless representing destructive state.

### Cards / Containers

- **Corner Style:** Gently rounded rectangle (8px radius).
- **Background:** White surface with ink text.
- **Shadow Strategy:** Resting cards use subtle shadow or just border; interactive cards can move to medium shadow on hover.
- **Border:** Gray/slate hairline, darkened on hover or focus for actionable cards.
- **Internal Padding:** 16px on compact cards, 24px on standard cards.

### Inputs / Fields

- **Style:** White field, gray hairline border, 6px radius, 40px height, 12px horizontal padding.
- **Search:** Search groups may become full pills and carry a leading icon inside the same field surface.
- **Focus:** Dark 1–2px ring with offset depending on primitive; focus should be high-contrast and visible.
- **Error / Disabled:** Error states use red border/ring; disabled states lower opacity and cursor affordance.

### Navigation

The global header is a horizontal HKUST Blue gradient with white text, a graduation-cap mark, and compact bold links. Navigation links are mostly unadorned at rest and underline on hover. The login/account affordance is a translucent white-outlined pill, keeping identity controls distinct from content links.

### Tabs

Tabs sit on a soft gray rail with compact triggers. Active tabs become white with ink text and a tiny shadow; inactive tabs remain muted. The pattern should feel like an instrument switch, not a marketing segmented control.

### Ranking Result Card

The ranking card is the signature component: rank/score on the left, entity title and evidence in the center, grade badge on the right. It must preserve this left-to-right evidence scan on desktop and a compact equivalent on mobile. The whole card is clickable, with border and shadow state changes confirming action.

## Do's and Don'ts

### Do:

- **Do** keep HKUST Blue as the primary institutional anchor for navigation, chart markers, and select accents.
- **Do** use HKUST Gold sparingly for brand emphasis and title moments.
- **Do** preserve tabular numerals for ranks, scores, populations, dates, and sample counts.
- **Do** show evidence metadata close to the ranked entity it qualifies.
- **Do** use borders and tonal surfaces before reaching for heavy shadows.

### Don't:

- **Don't** use grade red/orange/green for non-evidence decoration.
- **Don't** make ranking pages visually louder than the data they explain.
- **Don't** stretch operational ranking controls into overly wide, low-density layouts.
- **Don't** replace focus rings with hover-only feedback.
- **Don't** fabricate institutional endorsement, testimonials, or proof assets in visual treatments.
