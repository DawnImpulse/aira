# Plan 010: Rebuild the IDE website (Raycast intro, Orca demos, coloured cards)

## Context
`docs/index.html` is a clean but conventional dark page with static screenshots. The user asked for a rebuild inspired by four sites and confirmed this direction in a shape brief (2026-10-02):
- **Raycast**: the intro screen (black stage, grainy diagonal light beams behind a centered headline, floating pill nav, single CTA + mono footnote) and its **coloured cards**.
- **Orca**: every feature shown as a looping video demo.
- **Tuple**: plain, specific, human copy. **Superset**: small mono/terminal touches.
- **Agent row**: confirmed, a Raycast-style row of 12 agent cards.
- The beams use the app's project hues and light up one at a time, matching DESIGN.md's north star "The Switchboard".

**Constraints:**
- Still one static file served from `/docs` by GitHub Pages (Jekyll on, no framework).
- Product truth comes from `PRODUCT.md`: no download, no metrics, no testimonials.
- WCAG 2.2 AA.

Repo convention: save this plan as `plans/010-website-rebuild.md` before implementing.

## 1. Demo clips, recorded from the real UI with demo data
Extend `scripts/screenshots/`. Reuse `open()`, `scene()`, `byTitle`, `project` (`scene.mjs`) and `mock.js`. Like `bun run screenshots`, it needs `bun run dev` on :1420.

### `scripts/screenshots/clips.mjs` (new)
- Add a `package.json` script: `"clips": "node scripts/screenshots/clips.mjs"`.
- **Capture:** Playwright 1.63 `page.screencast.start({ size: { width: 2880, height: 1800 }, quality: 92, onFrame })`.
  - Fallback is raw CDP `Page.startScreencast` plus `screencastFrameAck`.
  - Never use `showActions()`; it draws boxes and labels.
- **Encode:** resample the frames to a steady 30 fps by repeating the last frame per 33 ms slot, and pipe them to ffmpeg:
  `ffmpeg -y -f image2pipe -c:v mjpeg -framerate 30 -i - -vf "crop=W:H:X:Y,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -preset slow -crf 21 -profile:v high -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -an docs/media/NAME.mp4`
  - MP4 only.
  - BT.709 tags, so the blacks match the page.
- **Legible text:** crop width in CSS px equals the largest display width, encoded at 2× with no scaling.
  - Lead card: 1520×950.
  - 2×2 cards: 1088×680.
  - Compute crops from `boundingBox()` × 2, rounded to even numbers.
- **Stills:** a still per clip goes through cwebp to `docs/media/NAME.webp`.
- **Size budget:** ≤ 600 KB per clip, about 3 MB total. Every regeneration stays in git history, so keep it small.
- **Fake cursor:** an injected arrow that follows real `mousemove` events. Glide it with about 24 `p.mouse.move` steps 16 ms apart, then `loc.click()`. Type with `keyboard.type(text, { delay })`.
- **Hook events:** push them at least 1.1 s apart; `src/lib/terminals.ts` polls once a second.

### `mock.js` (all opt-in via `window.__demo`, so `bun run screenshots` is unchanged)
- `pty_spawn` streams output line by line (~90 ms per line) instead of sending one chunk.
- A new `kill_pid` handler records the pid, and `ports_list` drops recorded pids.
  - `freePort()` (`src/lib/ports.ts`) asks via `plugin:dialog|ask`, which the mock already answers `true`.
  - It then calls `kill_pid` and refreshes at +0.5 s and +3.5 s.
- A new `git_commit` handler empties that repo's `files`; GitPanel calls `refreshStatus()` after a commit.
- `ai_commit_message` resolves after ~900 ms so the spinner shows.

### Selectors (from `src/components`)
- Theme: the `.segmented` buttons "Dark", "Light", "System".
- Star: title "Star (show in Spaces view)".
- Sidebar tabs: role="tab" buttons "Projects", "Spaces", "Scripts".
- Commit: `.btn.primary` "Commit".
- Ports search: placeholder "Search a port, e.g. 3000". Free button: `.icon-btn.red`.

### Clips (5–8 s each, loop-friendly)
1. `agents` (lead):
   - `+` menu → Claude Code → its card shows Working.
   - Subagents appear one at a time.
   - Gemini's card in checkout-v2 is Done and breathing.
2. `spaces`: click storefront → checkout-v2 → ui-kit (tabs and Files/Git view change), star a space, open the Spaces tab.
3. `scripts`:
   - Start → dev, storybook and db turn green, and the Next.js log streams.
   - Run test → it turns red with "Exited with code 1".
4. `git`: Git tab → open the pricing.ts diff → Generate (spinner, then message) → Commit → the list empties.
5. `ports`: "5 ports" → type `9090` → free it → the row disappears.
6. `editor`: open a file → Settings → Light, held at least 2 s → Dark. If the budget is tight, cut this clip.

## 2. Page rebuild (`docs/index.html`)
**Keep:** the self-hosted Archivo, the tokens, the skip link, `#top`/`#content`, the copy-button logic (status region, hidden without JS), focus styles, the hero still with its `srcset`.

1. **Pill nav** (Raycast):
   - Fixed, with a solid background.
   - `html { scroll-padding-top }` so focused items are never hidden under it (WCAG 2.4.11).
   - Logo, Features, Agents, Install, GitHub; the button is "Build from source".
2. **Intro stage, CSS only:**
   - **Beams:** five thin `<i>` beams, unevenly spaced (`--w` 4–9 vmax), each with `rotate: 28deg`.
     - A gradient across each beam, plus a mask along it; no `filter: blur`, which stutters on iOS.
     - On a black `.beams` base, so the grain shows only in the light.
   - **Hues:** 210 blue, 15 coral, 180 teal, 285 purple, 330 pink, taken from `PROJECT_COLORS`, so they stay clear of the status colours.
   - **Grain:** an inline SVG `feTurbulence` tile with `mix-blend-mode: overlay`.
   - **Readability:** a radial dark pool behind the text.
   - **Motion:** the headline fades in, then each beam lights with opacity and scale, staggered 0.35 s. All motion ends by about 2.8 s, so WCAG 2.2.2 needs no control.
   - **Reduced motion:** the beams are simply lit.
   - **Text:** headline "All your projects, running at once.", a sub-line, "Build from source" plus "View on GitHub", and the mono footnote "macOS · open source, MIT · early preview v0.1".
3. **Product window:** the existing `screenshots/hero.webp` still in a framed window with a glow. No video here; the agents clip lives in its card.
4. **Feature cards**, tinted at ≤ 15% with a hue border glow, each with a squircle, title and one plain sentence:
   - **Layout:**
     - **Agents** (wide, coral), with the video beside the copy.
     - A 2×2 of **Spaces** (blue), **Scripts** (teal), **Git** (purple) and **Ports** (pink).
     - **Editor & themes** (wide, indigo 255), which takes over the old list of editor details.
   - **Video markup:** `<figure class="clip">` holding a lazy `<img>` still (no `poster` attribute, which would load eagerly), then `<video muted loop playsinline preload="none">`, then a visible ≥ 32 px play/pause button on a solid backing, then an `sr-only` `<figcaption>` describing the recording (WCAG 1.2.1).
   - **Playback script:**
     - An IntersectionObserver plays when `intersectionRatio ≥ 0.4` and pauses otherwise.
     - A user's pause sticks (`data-held`).
     - `play()` rejections are caught, and button labels are set from the `play`/`pause` events.
     - Reduced motion: no autoplay, the button only.
5. **"Works with" agent row**, after Raycast's extension row:
   - **Markup:** `<div id="rail" role="region" aria-labelledby tabindex="0">` with scroll-snap, wrapping `<ul role="list">` of 12 `<li style="--c:…">` cards.
   - **Controls:** Previous and Next buttons (`aria-controls="rail"`), hidden until JS runs. No auto-scroll and no text cycling.
   - **Colours:** from `src/lib/agents.ts`. The mono agents (OpenCode, Cursor, Copilot, Goose) get neutral graphite cards, which is accurate.
   - **Logos:** copy `src/assets/agents/*` to `docs/agents/`.
     - Shrink `aider.png` (192 px, 29 KB) with sips.
     - The `currentColor` SVGs render as CSS masks filled with `--ink`.
     - Logos stay unaltered and ≤ 40 px.
   - **Tracking labels**, from `observe`, `exactStatus` and `repoFiles`:
     - "Exact status, no setup" for Claude Code (plus "subagent tree", the only live-verified one), Gemini CLI, OpenCode and Qwen Code.
     - "Exact status with an opt-in hook file" for Codex, Copilot CLI, Goose and Droid, with the `repoFiles` path in mono.
     - "Hook file; status from terminal activity" for Cursor Agent.
     - "Terminal activity" for Aider, Amp and Crush.
   - **Legal line:** "Not affiliated; names and logos belong to their owners", linking NOTICE.md on GitHub (Jekyll would turn a local `.md` into HTML).
6. **"Build it."** over still beams: the terminal block with Copy and the GitHub link.
7. **Footer:** MIT, built with, "Screenshots and videos show demo projects."

**Copy:** Tuple-like, concrete and in the second person, with no hype. Mono is used only for footnotes, paths and labels.

## 3. Docs
- `DESIGN.md`: rewrite the website paragraphs and tokens to cover the intro beams, card hues (and why green and amber aren't used), agent cards, and media rules (muted loops, still image, pause button, captions, size budget). App sections are unchanged. Keep `.impeccable/design.json` in sync.
- `README.md`: no change.

## Verification
- With `bun run dev` up, run `bun run screenshots && bun run clips`.
  - ffprobe each MP4: H.264, BT.709, no audio, within budget.
  - Check the first frame is the full 2880 px width.
  - Read a still per clip back to check the text is legible.
- Serve with `python3 -m http.server 8000 -d docs`. Playwright with `channel: "chrome"` (the bundled Chromium can't play H.264), at 1440, 768 and 390 px; read each section's screenshot back.
- **Behaviour:**
  - Videos play only in view (`currentTime` advances), pause off-screen, and stay paused after a user pause.
  - Reduced motion: no autoplay, and the beams are static.
  - The row works by keyboard and buttons. The skip link and focus rings work, and nothing focused hides under the nav.
- **Contrast:** the audit script reports 0 failures. Add a pixel-sampled check over the beams, tinted cards and video (text set transparent → brightest pixel in each text box → ratio).
- **Layout and weight:** no overflow from 320 to 1920 px; targets ≥ 24 px; impeccable detector once; initial weight excluding videos ≤ ~600 KB.
- **Safari:** test against the deployed GitHub Pages URL, since `http.server` doesn't do Range requests.

---

## Implementation status (2026-10-02)
Built as planned, with these deviations:
- **Recording method:** Playwright's screencast and Chromium's CDP screencast both cap frames at CSS size (1×), so `clips.mjs` loops `Page.captureScreenshot` with `clip.scale: 2` instead. That captures 14–40 fps, resampled to a steady 30 fps, with BT.709 tags and a short fade at each end.
- **Card layout:** Git is a wide card (its panel only reads as a whole window), so Editor & themes became a half card. The order is Agents (wide), Spaces | Scripts, Git (wide), Ports | Editor.
- **Sizes:** six clips plus stills come to 3.3 MB. Agents (610 KB) and Git (707 KB) are over the 600 KB per-clip target, at crf 28 on 2368×1480. The quarter clips are 0.2–0.33 MB.
- **Contrast:** text over the beams needed a dark pool sized to each text block, plus a chip behind the mono footnote. The worst case after the fix is the headline at 4.34:1 (needs 3:1).
- **Detector:** card glows and framed media inside cards were removed after it flagged them as dark-glow, thin-border-wide-shadow and nested-cards. The 11 remaining notes are advisory, for `color-mix()`-derived colours that DESIGN.md documents by rule.

**Verified** (Chrome via Playwright, local server with Range support):
- Videos play only while ≥ 40% visible, pause off-screen, and a user's pause sticks.
- Reduced motion: no autoplay and no animations.
- The agent row moves with Previous and Next.
- Pixel-sampled contrast: 0 failures at 1440 and 390 px. Element contrast: 0 failures.
- No overflow from 320 to 1920 px, and no targets under 24 px.
- First load is 253 KB; videos load only when scrolled to.

**Not verified:** Safari playback (needs the deployed Pages URL), and real devices.

---

## Follow-up pass (2026-10-02, after review)
Asked for: smoother cursor and Recordly-style zoom in the recordings, a visible Start click, git zooming into each action, agents as chip rows, a nav that turns to glass on scroll, Features / Guide / Feedback pages, new fonts, and the rename to **Aira** (said "aye-ra").

**Recordings (`scripts/screenshots/clips.mjs`, rewritten).**
- **Pass 1:** clean 2× frames with no in-page cursor, plus a log of every mouse move, click and the region each step is about.
- **Pass 2:** each 30fps frame is composited in a blank page:
  - a critically damped spring camera that eases in on the active region and back out, dipping a little on long pans and following the cursor near the edges;
  - a drawn cursor with a press dip and a Signal Blue ripple on clicks.
- Glides are clock-timed, and the camera snaps once settled so held shots encode cheaply.
- `TRACE=1` logs each step, and a 3-minute watchdog per clip fails loudly instead of hanging.
- Sizes: 6.2 MB for the six MP4s (0.78–1.67 MB each) plus 0.45 MB of stills. That is over the old 600 KB target, the cost of zoom transitions.

**Site.**
- Shared `site.css` / `site.js` for four pages:
  - `index.html`
  - `features.html` (eight sections, each with its recording or screenshots)
  - `guide.html` (shortcuts, menus, settings, runners, agents, git, providers, confirmations; facts checked against the source)
  - `feedback.html` (posts to the form's `action`, which is empty for now; with no endpoint set, it says nothing was sent and keeps the text)
- Fonts are Funnel Display, Funnel Sans and Martian Mono, replacing Archivo.
- The nav is clear at the top and frosted glass after scroll ("The Glass Exception" in DESIGN.md).
- The agents section is now pill chips in 5 · 4 · 4 rows, with tracking marks, a legend and an "Any other CLI" chip.

**Rename.**
- Changed: the user-visible strings in the app (product name, window title, menus, dialogs, user agent and OpenRouter title), the website, README, PRODUCT.md and DESIGN.md.
- Kept, so existing settings, Keychain entries and repo hook files keep working: the bundle id `com.codevry.ide`, `ide-agent-events` hook files, `IDE_AGENT_EVENTS`, generated hook contents and the crate names.
- The GitHub repo and Pages URLs still say `ide`.
- `vite.config.ts` now ignores `docs/`, because any `.html` edit there full-reloaded the dev app, which broke a recording mid-run.

**Verified** (Chrome via Playwright):
- No overflow at 320 to 1920 px on all four pages, and no console errors.
- The nav is clear at the top and glass after scroll on every page.
- Video play and pause still behave as before, and reduced motion stays static.
- Pixel-sampled contrast: 0 failures on all pages at 1440 and 390 px. The worst case is the hero headline at 3.58:1 on phones (needs 3:1).
- First load: index 242 KB, guide 111 KB, feedback 59 KB.
- `tsc --noEmit` is clean.
- Detector: three cramped-padding heuristics remain and are judged false positives:
  - the bordered `.table` wrapper, whose cells carry the padding;
  - the `.feat` section, which has a top rule and 4 to 6.5rem of padding;
  - the padded `.feat-media` panel holding full-bleed media.

**Open:** Safari and real-device playback, the feedback endpoint, and renaming the GitHub repo (the site's URLs would follow).

### Second review (2026-10-02)
- **Hero:** the still under the headline is now a recording (`hero` in `clips.mjs`), 66rem wide. It tours the board: another space, Git across repos, the ports list, and back.
- **Agents clip:** stays in the Claude Code session. The prompt is typed, with one line per subagent as each appears in the sidebar. It no longer jumps back to `pricing.ts`.
- **Home grid:** the lead card puts copy beside a narrower recording. The rest is a 2 × 3 grid of half cards (git is now half-size, recorded at 1120×700), ending with an "And the rest." text card.
- **Mock:** reports all twelve agent CLIs as installed, so screenshots never show "not installed".
- **Features page:** bullets cut to the essential fact and spaced further apart. Screenshot crops lost the extra ring that made "triple boxes".
- **App:** every space in the Projects view gets a bar in front: a neutral grey that follows the theme when idle, the project colour when selected.
- **Video size:** all seven clips re-recorded, 7.5 MB in total.
- **`TODO.md`** added at the root for hand-kept todos.
