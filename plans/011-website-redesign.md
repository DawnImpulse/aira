# Plan 011: Website redesign (white paper, static screenshots)

## Context
The site from plan 010 was a black Raycast-style stage with looping recordings. On 2026-11-25 the user asked for a redesign with WorkOS and codevry.com as references, videos replaced by static screenshots; on 2026-11-26 a Dribbble shot (Outcrowd, "Website for an Incident Management Platform", Resq.io) became the composition example, with one constraint: **background stays white**. The comp was approved with the fact strip kept.

Comp: https://claude.ai/artifact/QdTGKkjz3bWR4UaeAriXwh (templates mirrored in `notes.local/website-redesign-comps/`).

**Constraints (unchanged):** one static site in `docs/` (Vercel, no framework), product truth from `PRODUCT.md` (no users, testimonials, metrics), WCAG 2.2 AA, every image an existing asset from `bun run screenshots` or a kept still.

## Direction
- **Paper:** light-first, white (`daylight` tokens), dark palette via `prefers-color-scheme` from the same DESIGN.md roles.
- **One accent:** Signal Blue (`#2563eb` on light, `#6aa8ff` on dark). Project hues appear only inside screenshots. No per-card hues, no beams, no grain.
- **Type:** unchanged (Funnel Display, Funnel Sans, Martian Mono, self-hosted).
- **From the Dribbble shot:** floating pill nav; centred two-tone headline with two pill CTAs; product window overlapping the fold with two real crops floating over it; logo grid; one split card; hub diagram (four cards wired to one tile); bento with one accent-filled tile; five tilted icon cards; closing CTA lit from below.
- **From WorkOS:** feature page split sections with sticky copy; detail pairs.
- **From codevry.com:** the ruled fact strip under the hero window (Platform · License · Version · Price).
- **Not taken:** dark backgrounds, particles, the "AI" tile (Aira mark instead), fake metrics.

## Work
1. **`docs/site.css`** rewritten: tokens (light + dark), pill nav, buttons, page head, code block with copy, footer columns, feature-page split pattern. Old token names kept as aliases so the guide and feedback page styles need only small edits.
2. **`docs/index.html`** rebuilt from the comp with real links (`data-download`, `data-latest`), the copy-button markup `site.js` expects, and the existing meta head.
3. **`docs/features.html`**: same nine sections and bullets, each with a main still and its detail screenshots; no `<video>`.
4. **`docs/guide.html`, `docs/feedback.html`**: new nav and footer, tokens adjusted for light paper; content unchanged.
5. **`docs/site.js`**: drop the glass-nav sentinel and video playback; keep the release lookup and copy buttons.
6. **Recordings removed:** `docs/media/*.mp4`, `scripts/screenshots/clips.mjs`, the `clips` npm script. The `docs/media/*.webp` stills stay as static images (they are zoomed key moments of the real app).
7. **`DESIGN.md`**: website colour roles, elevation and "Website Surfaces" rewritten for the new site; `.impeccable/design.json` kept in sync.

## Verification
- Playwright (bundled Chromium is enough now, no H.264): all four pages at 1440, 768 and 390px, no horizontal overflow, no console errors.
- Contrast: every text/background pair from the token set at or above 4.5:1 (3:1 for display sizes); the one exception to watch is white on Signal Blue (`#2563eb`, 5.2:1 at 600 weight).
- Keyboard: skip link, focus rings, nav order; nothing hidden under the sticky pill (`scroll-padding-top`).
- Reduced motion: no transitions, tilted cards stay still.
- `git grep -n "\.mp4\|clip-btn\|\.clip\b" docs` returns nothing.

---

## Implementation status (2026-11-26)
Built as planned, with the hero reworked after the comp was approved:
- **Hero stage** is the app's main pane with all four tabs in its strip (`pane-editor`, `pane-claude`, `pane-browser`, `pane-terminal`, cropped to one box by `bun run screenshots`), cycling every two seconds while in view. No pause control, at the user's request; under reduced motion the first tab stays. The floating windows bob on their own periods. The Claude Code session carries a short transcript that `shots.mjs` writes into the mock pty (mock.js gives agent sessions no output).
- **Floating windows:** the spaces card is live markup (spinners at 0.8s, a Signal Blue halo beam round the working card, the finished card breathing), the Git panel (`pane-git`, cropped to its top 19rem) and the ports list. On phones the spaces card sits under the pane and the other two go.
- **Fact strip** kept: the Apple mark + macOS, "MIT (Open Source)", "Preview" + the release tag from the GitHub API, Free.
- **Background:** three drifting blobs in project hues that rotate through the spectrum over 24s; static under reduced motion.
- **Removed:** `docs/media/*.mp4`, `scripts/screenshots/clips.mjs`, the `clips` npm script. The `docs/media/*.webp` stills stay as static images.
- **Design hook exceptions recorded** (`.impeccable/config.json`): the accent glow on `docs/index.html` and `docs/features.html` (the chosen Dribbble look), the pane's own pause button inside its clipped frame, and the system font stack in the live spaces card.

**Verified** (Chromium via Playwright, local HTTP server): every image on all four pages decodes; no horizontal overflow at 1440 or 390px; no page errors; the tab cycle advances, the pause button holds it, and nothing cycles under reduced motion.

**Version on the site:** `site.js` asks the GitHub API for the latest release (CORS is open, 60 requests an hour per IP) and fills every `[data-latest]`. The static text behind it is stamped from the highest `v*` tag by `bun run site:version` (`scripts/site-version.mjs`); run it, after `git fetch --tags`, before publishing the site. The artifact preview can't reach the API, so it shows the stamped text.

**Open:** `.impeccable/design.json` still describes the plan-010 site (run `/impeccable document`); `og.jpg` is regenerated from the new hero shot but its headline card still uses the old dark composition; real-device and Safari checks.
