# Typography Setup

## Why not Inter
Inter isn't wrong, it's just the default everyone reaches for. At this level of
polish, pick something with slightly more character that still holds up at
13px in a dense table.

## Fonts to self-host

| Role | Font | Source |
|---|---|---|
| UI / body / headings | **Geist** (weights: 400, 500, 600) | `https://vercel.com/font` or `fontsource/geist` npm package |
| Data / mono (IDs, IPs, timestamps, code) | **Geist Mono** (weights: 400, 500) | Same source, mono variant |

Self-host both (don't load from a CDN at runtime) — same reasoning as the
current app's self-hosted variable fonts: no external request, no FOUT on a
NOC display that's up 24/7.

**If Geist licensing or setup is a blocker**, fall back to:
- UI: **General Sans** (Fontshare, free) or **Hanken Grotesk** (Google Fonts, free)
- Mono: keep **JetBrains Mono** — it's already in the project and is genuinely good, no need to replace it.

## Type scale (matches `01-design-tokens.css`)

| Token | Size | Line height | Use |
|---|---|---|---|
| `--text-xs` | 12px | 16px | eyebrow labels, table meta text, timestamps |
| `--text-sm` | 13px | 18px | table body, secondary UI text |
| `--text-base` | 14px | 20px | default body/UI text |
| `--text-md` | 16px | 24px | card titles, form labels |
| `--text-lg` | 20px | 28px | section headers |
| `--text-xl` | 24px | 32px | page titles |
| `--text-2xl` | 32px | 40px | dashboard hero numbers |
| `--text-3xl` | 40px | 48px | marketing/landing only — do not use in-app |

## Weight usage
- **400 (regular)** — all body text, table content
- **500 (medium)** — labels, active nav item, table headers
- **600 (semibold)** — page titles, big stat numbers, section headers only

Don't go beyond 600 anywhere in the product UI — this isn't a marketing page, heavy weights read as shouting in a dashboard.

## Numeric/data text
Use `--font-mono` (Geist Mono) for: IP addresses, MAC addresses, device IDs,
API keys, timestamps in tables, and big stat numbers on the Dashboard (this
also gives you tabular figures so numbers align in columns). Everything else
uses `--font-ui`.
