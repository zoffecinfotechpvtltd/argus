# Component Spec

Build these before any individual page. Every page in `05-page-specs.md`
reuses these — get them right once.

Invoke your `frontend-design` skill (and `ui-ux-promax` skill, if present in
this project) while building this file. All values below are defaults —
the skill may refine spacing/detail, but must not reintroduce glow,
gradient fills, or glassmorphism, and must not change the accent-color
usage rule (see Ground Rules in the README).

## Button
- **Primary**: `--color-accent` background, white text, `--radius-md`, no gradient, no shadow at rest. On hover: `--color-accent-hover`, `--shadow-sm`. On active: `--color-accent-active`.
- **Secondary**: `--color-bg-surface` background, `--color-border` 1px border, `--color-text-primary` text. Hover: `--color-bg-subtle`.
- **Ghost**: transparent background, text-only, hover shows `--color-bg-subtle`.
- **Destructive**: same shape as primary, `--color-critical` background.
- All buttons: `--text-sm`, weight 500, `--space-3` vertical / `--space-4` horizontal padding, visible focus ring (`--focus-ring`) on keyboard focus.
- Disabled: 40% opacity, no hover state, `cursor: not-allowed`.

## Input / form field
- `--color-bg-surface` background, `--color-border` 1px border, `--radius-md`.
- Label above field, `--text-sm` weight 500, `--color-text-secondary`.
- Helper text below, `--text-xs`, `--color-text-muted`.
- Focus: border becomes `--color-accent`, plus `--focus-ring`.
- Error: border becomes `--color-critical`, helper text becomes `--color-critical` and states what's wrong in plain language (see writing rules below).

## Table (used by Inventory, AuditLog, Reports, Users)
- Header row: `--text-xs`, weight 500, `--color-text-muted`, uppercase optional, sticky on scroll, 1px bottom border `--color-border-strong`.
- Body rows: `--text-sm`, `--color-text-primary`, 1px bottom border `--color-border`, `--space-3` vertical padding.
- Row hover: `--color-bg-subtle` background — no border-color change, no shadow.
- Selected row: `--color-accent-subtle` background.
- Never color a full row for status — status lives in a pill in its own column (see Badge below).

## Badge / status pill
- Shape: `--radius-full`, `--text-xs`, weight 500, `--space-1` vertical / `--space-3` horizontal padding.
- Background = the semantic `-subtle` token, text = the solid semantic token. E.g. online → bg `--color-success-subtle`, text `--color-success`.
- Never use the brand accent color for a status pill — status and brand are different signals.

## Card
- `--color-bg-surface` background, `--color-border` 1px border, `--radius-lg`.
- No shadow at rest on in-page cards; `--shadow-sm` only for cards that float above content (dropdowns, popovers).
- Padding: `--space-5`.
- Card title: `--text-md` weight 600. Card body: `--text-sm`.

## Stat card (Dashboard)
- Big number: `--text-2xl`, `--font-mono`, weight 600.
- Label above number: `--text-xs`, `--color-text-muted`.
- Delta: `--text-xs`, weight 500, colored by semantic token (success/critical) with a small ▲/▼ glyph — not a colored background chip.
- Optional sparkline below: single stroke, `--chart-1` or the relevant semantic color, no fill, 1.5px stroke width, no axis/gridlines.

## Nav sidebar
- Active item: `--color-accent-subtle` background, `--color-accent` text/icon, `--radius-md`. No glow, no animated pill sliding between items unless it's genuinely subtle (120ms, no bounce/spring easing).
- Inactive item: `--color-text-secondary`, hover shows `--color-bg-subtle`.
- Section labels (e.g. "Admin"): `--text-xs`, `--color-text-muted`, weight 500, uppercase, `--space-2` bottom margin.

## Tabs (DeviceDetail, Settings-adjacent)
- Underline style, not pill/segmented-control style.
- Active tab: `--color-text-primary`, 2px bottom border `--color-accent`.
- Inactive tab: `--color-text-secondary`, no border. Hover: `--color-text-primary`.

## Modal / slide-over
- Prefer a slide-over panel (from the right) for edit/add flows over a centered modal, especially in Inventory — it keeps table context visible.
- Overlay: `rgba(0,0,0,0.4)`, no blur unless performance-tested.
- Panel: `--color-bg-elevated`, `--shadow-lg`, `--radius-lg` on the leading edge only.

## Charts (recharts — keep the library, restyle only)
- Line/area charts: 1.5–2px stroke, no area-fill gradient — flat low-opacity fill (`10-15%` of the stroke color) if fill is needed at all.
- Gridlines: `--chart-grid`, 1px, horizontal only (drop vertical gridlines — they add noise).
- Tooltips: `--color-bg-elevated` background, `--shadow-md`, `--radius-md`, `--text-xs`.
- Legend: text labels with a small color dot, not colored background chips.

## Empty / error states (writing + visual)
- Empty state: one line stating what's missing, one line stating the action to take, one button. No illustration required — an icon + text is enough for an infra tool.
- Error state: state what happened and how to recover, in the interface's voice ("Couldn't load devices — retry" not "Oops! Something went wrong 😞").
