---
name: Aira
description: A Mac code editor that keeps every open project's servers, agents and git running side by side.
colors:
  signal-blue: "#6aa8ff"
  running-green: "#3fcf6e"
  fault-red: "#ff6b6b"
  attention-amber: "#e6b450"
  night-ink: "#0b0b0c"
  console-black: "#0f0f11"
  raised-graphite: "#16161a"
  hover-graphite: "#1c1c21"
  pressed-graphite: "#24242a"
  hairline: "#222227"
  rule: "#34343c"
  lamp-white: "#e6e6ea"
  muted-steel: "#8d8d96"
  faint-steel: "#5c5c65"
  signal-blue-light: "#2563eb"
  running-green-light: "#1a9a4a"
  fault-red-light: "#d93636"
  attention-amber-light: "#a86b00"
  daylight: "#ffffff"
  daylight-panel: "#f7f7f8"
  daylight-hover: "#eeeef1"
  daylight-pressed: "#e4e4e9"
  daylight-hairline: "#e3e3e8"
  daylight-rule: "#cfcfd6"
  daylight-ink: "#1c1c21"
  daylight-muted: "#6b6b75"
  daylight-faint: "#9c9ca6"
  on-accent: "#06101f"
  accent-hover: "#8bbcff"
  site-ink: "#f3f3f6"
  site-prose: "#b8b8c1"
  site-dim: "#9a9aa3"
  site-ring: "#2a2a31"
  site-border-hover: "#4a4a55"
  site-soft: "#c9c9d1"
  site-nav: "#0e0e10"
  site-glass: "#0e0e10b8"
  site-code: "#0c0c0e"
  stage-black: "#000000"
  stage-pool: "#000000d1"
  agent-claude: "#d97757"
  agent-codex: "#7a9dff"
  agent-gemini: "#4796e3"
  agent-neutral: "#a1a1aa"
  agent-aider: "#14b014"
  agent-amp: "#f34e3f"
  agent-qwen: "#615ced"
  agent-crush: "#ff5fd2"
  agent-droid: "#ee6018"
typography:
  display:
    fontFamily: "Funnel Display, Funnel Sans, -apple-system, sans-serif"
    fontSize: "clamp(2.5rem, 1.2rem + 5.4vw, 5.75rem)"
    fontWeight: 640
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  site-finale:
    fontFamily: "Funnel Display, Funnel Sans, -apple-system, sans-serif"
    fontSize: "clamp(2.6rem, 1.4rem + 4.6vw, 4.75rem)"
    fontWeight: 620
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  site-page-title:
    fontFamily: "Funnel Display, Funnel Sans, -apple-system, sans-serif"
    fontSize: "clamp(2.6rem, 1.5rem + 4.2vw, 4.75rem)"
    fontWeight: 620
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  site-headline:
    fontFamily: "Funnel Display, Funnel Sans, -apple-system, sans-serif"
    fontSize: "clamp(2.1rem, 1.3rem + 2.9vw, 3.5rem)"
    fontWeight: 620
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  site-section:
    fontFamily: "Funnel Display, Funnel Sans, -apple-system, sans-serif"
    fontSize: "clamp(1.9rem, 1.4rem + 1.6vw, 2.5rem)"
    fontWeight: 620
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  site-title:
    fontFamily: "Funnel Display, Funnel Sans, -apple-system, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.2
  site-lead:
    fontFamily: "Funnel Sans, -apple-system, sans-serif"
    fontSize: "clamp(1.125rem, 1rem + 0.4vw, 1.3125rem)"
    fontWeight: 400
    lineHeight: 1.6
  site-body:
    fontFamily: "Funnel Sans, -apple-system, sans-serif"
    fontSize: "clamp(1rem, 0.95rem + 0.25vw, 1.0625rem)"
    fontWeight: 400
    lineHeight: 1.65
  site-small:
    fontFamily: "Funnel Sans, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  site-mono:
    fontFamily: "Martian Mono, ui-monospace, SF Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    fontVariation: "'wdth' 87.5"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
  mono:
    fontFamily: "SF Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "6px"
  md: "7px"
  lg: "8px"
  xl: "10px"
  2xl: "14px"
  key: "5px"
  frame: "12px"
  card: "18px"
  pill: "999px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "18px"
components:
  button:
    backgroundColor: "{colors.raised-graphite}"
    textColor: "{colors.lamp-white}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.hover-graphite}"
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-small:
    rounded: "{rounded.md}"
    padding: "0 6px"
    height: "24px"
  icon-button:
    textColor: "{colors.muted-steel}"
    rounded: "{rounded.sm}"
    size: "24px"
  icon-button-hover:
    backgroundColor: "{colors.pressed-graphite}"
    textColor: "{colors.lamp-white}"
  input:
    backgroundColor: "{colors.night-ink}"
    textColor: "{colors.lamp-white}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  segmented-track:
    backgroundColor: "{colors.hover-graphite}"
    rounded: "{rounded.lg}"
    padding: "2px"
  segmented-item-on:
    backgroundColor: "{colors.raised-graphite}"
    textColor: "{colors.lamp-white}"
    rounded: "{rounded.sm}"
    height: "24px"
  chip:
    backgroundColor: "{colors.pressed-graphite}"
    textColor: "{colors.muted-steel}"
    rounded: "{rounded.xs}"
    padding: "0 5px"
  popover:
    backgroundColor: "{colors.raised-graphite}"
    rounded: "{rounded.xl}"
    padding: "6px"
  menu-item:
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "28px"
  dialog:
    backgroundColor: "{colors.console-black}"
    rounded: "{rounded.2xl}"
  space-card-selected:
    backgroundColor: "{colors.raised-graphite}"
    rounded: "{rounded.xl}"
    padding: "5px 8px 6px"
  status-bar:
    backgroundColor: "{colors.console-black}"
    textColor: "{colors.muted-steel}"
    typography: "{typography.body-small}"
    height: "26px"
  site-nav-glass:
    backgroundColor: "{colors.site-glass}"
    rounded: "{rounded.2xl}"
    padding: "6px 7px 6px 16px"
  site-chip:
    backgroundColor: "{colors.console-black}"
    textColor: "{colors.site-ink}"
    rounded: "{rounded.pill}"
    padding: "0 17px 0 11px"
    height: "46px"
  tooltip:
    backgroundColor: "{colors.lamp-white}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.sm}"
    padding: "5px 8px"
---

# Design System: Aira

## 1. Overview

**Creative North Star: "The Switchboard"**

Every open project is a lit channel. The interface is a dark board of quiet, tonal surfaces where each project carries its own color and every server, agent and repository reports its state in a dot, a word or a count, readable without switching to it. Nothing on the board moves or glows until something needs the developer: a failure, a finished agent, a question waiting for input.

The feel is crisp, fast and utilitarian. Density is high and deliberate: 13px system type, 24 to 28px controls, 26px bars, gaps of 2 to 12px. Ornament is rejected outright; there are no gradients on chrome, no glass, no illustrated empty states, no decorative motion. Depth comes from stepping tone, not from shadows, and color is reserved for meaning: identity (which project), status (what is happening) and the single action accent.

The system serves PRODUCT.md's principles directly: "Everything running stays visible" and "Interrupt only when it matters". If a visual element doesn't help someone read the state of many running things at once, it doesn't belong.

**Key Characteristics:**
- Dark-first, with a complete light mirror (dark, light or follow macOS).
- Native Mac type: the system UI font and SF Mono, both user-configurable in Settings.
- Color as signal only: one accent, three status colors, 24 project hues for identity.
- Compact, quiet controls that brighten on hover and show a 2px Signal Blue focus ring.
- Flat tonal layers; shadows only on things that float.

## 2. Colors

A near-black neutral board, one cool accent for action, three status signals, and a 24-hue identity palette for projects.

### Primary
- **Signal Blue** (#6aa8ff; #2563eb in light): the one action and focus color. Primary buttons, focus rings, links, selected menu items, the selected tab's indicator and the shell prompt. Never used for status.

### Secondary
- **Channel Hues** (hsl(n × 15°, 72%, 60%) for n = 0…23): the project identity palette. New projects take the first unused hue, stepping 75° at a time so neighbors stay distinct. A hue marks identity only: the project bracket, its squircle, its header icon and the project bar tint (16% over the panel, with a 45% border).

### Tertiary
- **Running Green** (#3fcf6e): a script or terminal that is alive. Steady, never pulsing.
- **Fault Red** (#ff6b6b): a script that exited with an error, destructive actions (Stop, Remove, Force close).
- **Attention Amber** (#e6b450): needs a look but isn't broken: changed-file counts, a port blocked by another process.

### Neutral
- **Night Ink** (#0b0b0c): the window background and input wells.
- **Console Black** (#0f0f11): panels, the status bar, dialogs, code blocks.
- **Raised Graphite** (#16161a): anything one step up: buttons, popovers, the selected space card, the active segmented item.
- **Hover Graphite** (#1c1c21) and **Pressed Graphite** (#24242a): hover and pressed fills; the segmented track.
- **Hairline** (#222227) and **Rule** (#34343c): panel dividers, then control and card borders.
- **Lamp White** (#e6e6ea): primary text. **Muted Steel** (#8d8d96): secondary text, idle icons, meta. **Faint Steel** (#5c5c65): idle dots and disabled hints.
- The light theme mirrors every role: Daylight (#ffffff), Daylight Panel (#f7f7f8), Daylight Ink (#1c1c21), Daylight Muted (#6b6b75), with the status colors deepened for contrast on white.

### Website
- **Paper:** the website is light-first on Daylight (#ffffff) with Daylight Panel (#f7f7f8) for set-off cards, Daylight Hairline (#e3e3e8) and Daylight Rule (#cfcfd6) for borders, Daylight Ink (#1c1c21) for headings, #4d4d57 for prose and Daylight Muted (#6b6b75) for meta. Under `prefers-color-scheme: dark` every role swaps to its dark-theme twin; nothing is defined for one theme only.
- **One accent:** Signal Blue Light (#2563eb) on paper, Signal Blue (#6aa8ff) in the dark theme. It lands on the primary button, the first line of the hero headline, eyebrows and links, the hub tile, one bento tile and one deck card. Its text colour is #1d4fc4 on paper (#8bbcff in the dark theme) so links meet 4.5:1.
- **Accent Glow** (Signal Blue at 22%, 25% in the dark theme): a soft blurred shadow under the primary button and the accent surfaces, and the wash behind the closing CTA. It is the one coloured shadow on the site, taken from the Resq.io reference the user chose, and never appears in the app.
- **Project hues** appear only inside screenshots and inside the hero's live spaces card (the sidebar bracket, the breathing finished card). The page's own chrome never uses them; green, red and amber stay with the Signal Rule.
- **Hero blobs:** three large radial blobs in Channel Hues 210, 330 and 180 drift behind the hero copy at 55% opacity and turn slowly through the spectrum (a 24s hue rotation), fading to paper before the stage. They are static under reduced motion.
- **Pictures of the app** keep the app's own dark palette: the cycling main pane, the floating Git and ports windows and the live spaces card are #0b0b0c / #0f0f11 surfaces with Lamp White text whatever the page theme, because they are the app, not the page.

### Named Rules
**The Channel Rule.** Project hues say *which*, never *what*. A project's color never signals running, failed or done; that is the status palette's job.

**The Signal Rule.** Green, red and amber mean exactly one thing each, everywhere: running, failed, needs attention. Never use them for decoration or for project identity.

**The Glass Exception.** Glass appears exactly once: the website's floating pill nav, because content passes under it (86% paper, 14px blur, a Hairline border; solid paper where backdrop-filter isn't supported). Never on cards, never in the app.

**The Picture Rule.** On the website, anything that shows the app keeps the app's dark palette and its own motion (spinners at 0.8s, the working card's halo beam, the finished card's 4s breath). The page around it stays on paper with one accent. A picture of the app is never restyled to match the page.

**The Contrast Debt.** White text on Signal Blue measures 2.4:1 in the dark theme, below the WCAG 2.2 AA bar PRODUCT.md commits to. Text on Signal Blue is dark ink (#06101f) in new work, as the website already does; the app's primary button still needs this fix.

## 3. Typography

**Display Font:** none in the app (the website alone uses Funnel Display, see below)
**Body Font:** the macOS system UI font (-apple-system, SF Pro), user-selectable
**Label/Mono Font:** SF Mono (with Menlo), user-selectable, used by the editor and terminals

**Character:** native and invisible. The app reads like part of macOS, so the content (code, logs, status) carries the personality, not the type.

### Hierarchy
- **Headline** (600, 18px): the empty-state title in the main area. The largest type in the app.
- **Title** (600, 15px): dialog titles; 13px/600 for space-card and project titles in the sidebar.
- **Body** (400, 13px): everything by default: tree rows, tabs, menus, settings.
- **Body Small** (400, 12px): card meta lines, the project bar, the status bar, secondary rows.
- **Label** (600, 11px, 0.04 to 0.06em, uppercase): section labels such as Scripts, Terminals and menu group headers. Chips step down to 10.5px.
- **Mono** (400, 13px default): editor, diff, terminals and inline paths; size follows the user's setting.

The website (`docs/`) is a separate brand surface with three faces, all self-hosted variable Latin subsets (`docs/fonts/`, SIL OFL) that never appear in the app:
- **Funnel Display** for headings: Display (640, 40 to 92px, −0.03em, centered on the intro stage), Site Finale and Site Page Title (620, 42 to 76px), Site Headline (620, 34 to 56px, −0.02em), Site Section (620, 30 to 40px, the guide's many section headings), Site Title (600, 22px).
- **Funnel Sans**, its text companion, for everything read: Site Lead (18 to 21px), Site Body (16 to 17px, line-height 1.65), Site Small (14px), buttons and labels at 500 to 650.
- **Martian Mono** at 87.5% width for the technical voice only: code, keys, the stage footnote, labels such as "On this page", all at 13px (its large x-height reads like 14 to 15px of a normal mono).

Display and text faces are cut from one family so they pair without competing; the mono is the contrast. Reading tints on Night Ink: Site Ink (headings), Site Soft (leads, nav links), Site Prose (paragraphs) and Site Dim (meta, 7:1).

### Named Rules
**The Native Type Rule.** The app never ships a webfont. UI text uses the system font, code uses the monospace the user picked, and sizes stay in pixels on a fixed, dense scale.

**The Uppercase Label Rule.** Uppercase appears only on 11px section labels and always with 0.04em tracking or more. Never uppercase a sentence, a button or a heading.

## 4. Elevation

The system is flat and tonal. Surfaces step from Night Ink to Console Black to Raised Graphite, and a 1px Hairline or Rule separates them. Shadows exist for exactly one job: lifting layers that float above the board (popovers, menus, dialogs, tooltips).

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 32px rgb(0 0 0 / 0.5)`; 0.14 alpha in light): popovers, menus, dialogs and tooltips.
- **Pressed-in Tab** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.2)`): the active item of a segmented control, lifting it just off its track.
- **Window Frame** (`box-shadow: 0 1px 2px rgb(16 16 24 / 0.06), 0 30px 70px -28px rgb(16 16 24 / 0.4)`; in the dark theme a #2a2a31 ring and a 90px black blur): website only, for app screenshots shown as floating windows on 12px Frame corners, and for the hero's floating cards.
- **Card Lift** (`box-shadow: 0 1px 2px rgb(16 16 24 / 0.05), 0 12px 30px -16px rgb(16 16 24 / 0.25)`): website only, the pill nav, the hub cards and the deck cards. Resting bento tiles and the agents grid use a Hairline instead.
- **Accent Glow** (`box-shadow: 0 10px 30px -10px` Signal Blue at 22%, longer under accent surfaces): website only, see Colors › Website.

### Named Rules
**The Float-Only Rule.** Resting surfaces never cast shadows. If a panel, card or row needs separation, step its tone or add a Hairline; a shadow means "this floats above everything else".

## 5. Components

Compact and quiet: controls are 24 to 28px tall, corners are 6 to 10px, and idle icons sit in Muted Steel until hovered.

### Buttons
- **Shape:** gently rounded (7px), 28px tall, 10px side padding, icon and label centered with a 5px gap.
- **Default:** Raised Graphite fill, 1px Rule border, Lamp White label. Hover steps to Hover Graphite.
- **Primary:** Signal Blue fill and border; hover brightens it about 8%. Label color is the open Contrast Debt above.
- **Small:** 24px tall, 6px padding, 12px label.
- **Disabled:** 45% opacity, default cursor.
- **Icon button:** a 24px square, 6px corners, no border, Muted Steel glyph. Hover fills it with Pressed Graphite and brightens the glyph. Green and red variants are reserved for Run and Stop.

### Chips and Status Dots
- **Chips:** Pressed Graphite fill, Muted Steel 10.5px text, 4px corners, 16px line. Used for counts and tags such as file counts on the Git tab.
- **Status dots:** 8px circles. Running Green for alive, Fault Red for failed, Faint Steel for stopped, and a 1.5px hollow ring for never run. Dots never pulse.

### Inputs / Fields
- **Style:** a Night Ink well with a 1px Rule border, 7px corners and 6px 8px padding, full width.
- **Focus:** the border turns Signal Blue. Keyboard focus anywhere else shows a 2px Signal Blue outline.

### Segmented Control
- **Style:** a Hover Graphite track (8px corners, 2px padding) holding 24px items with 6px corners. The active item gets Raised Graphite, Lamp White text and the Pressed-in Tab shadow. It carries Projects/Spaces/Scripts, Files/Git and theme pickers.

### Popovers, Menus and Dialogs
- **Popover:** Raised Graphite, 1px Rule border, 10px corners, 6px padding, Float shadow. It opens 4px from its anchor and scrolls past 360px.
- **Menu item:** 28px minimum height, 6px corners, Hover Graphite on hover. The selected item turns Signal Blue.
- **Dialog:** Console Black, 14px corners, Float shadow, over a 45% black scrim. A 15px/600 title row sits above an 18px-padded body.
- **Tooltip:** inverted, with Lamp White fill and Night Ink 11.5px text, 6px corners. It appears after 350ms with a 2px rise over 120ms.

### Navigation
- **Sidebar:** three segmented tabs (Projects, Spaces, Scripts) above the project groups. Rows are 13px body text; section labels follow the Uppercase Label Rule in the project's hue.
- **Tabs:** a strip of 13px tabs in Muted Steel, divided by Hairlines, each with a close or dirty glyph. The active tab joins the editor surface (Night Ink, Lamp White text) under a 2px Signal Blue top line. Preview tabs are italic until pinned.
- **Status bar:** 26px tall, Console Black, 12px Muted Steel text. Memory, ports and terminal counts sit on the right.

### Space Card (signature)
A space card is 10px-cornered and borderless at rest, filled Hover Graphite on hover, and Raised Graphite with a Rule border when selected. In the Projects view a space bar sits in front of it (see below), so idle spaces still read as items. It shows a branch line with ahead/behind counts, the changed-file count in Attention Amber, and one row per agent: status word, agent name and age. Claude Code's subagents nest beneath with guide lines. When an agent finishes while its space is out of view, the card breathes: a project-hue wash rises and fades on a 4s exp(sin) curve, modelled on Apple's breathing status LED, until the space is opened. A working agent's card gets a moving border beam that is disabled under reduced motion.

### Project Bracket and Project Bar (signature)
Each project group in the sidebar is held by a 3px rounded vertical bar in its hue, symmetric so it centers on a collapsed header. Inside it, every space card carries its own **space bar**: 3px, rounded, inset 6px top and bottom inside the card's left edge, neutral when idle (halfway between Rule and Faint Steel: a blackish grey in the dark theme, a light grey in the light one) and the project hue only on the selected space. In the Spaces view, where there is no bracket, a starred space's card takes the hue as its own 3px left edge instead. Above the main and right panels, a 26px project bar tinted 16% with the hue names the project and space, followed by the space's git line or the scripts summary.

### Website Surfaces
The composition follows the Resq.io reference (Outcrowd on Dribbble) on white paper, with WorkOS's feature pattern and codevry.com's ruled fact strip. Everything that was a recording is now a still or live markup.
- **Nav:** a Pill-cornered bar floating 12px from the top, sticky, 64rem wide at most, white glass with a Hairline border and the Card Lift shadow (The Glass Exception). Brand, then Features, Guide and Feedback (the current page filled Daylight Hover), GitHub, and a Signal Blue "Download for Mac" button. Under 760px the links drop out.
- **Hero:** centred. The Display headline's first line is the accent ("All your projects," / "running at once."), then Site Lead naming Aira (aye-ra), a primary pill and a plain pill, and a mono footnote with the release tag. Three hero blobs drift behind (see Colors › Website).
- **Stage:** under the copy, a 58rem frame holding the app's main pane with four tabs always in its strip (pricing.ts, the Claude Code session, the browser tab in device view with a phone, a tablet and a laptop, a shell). Each tab is a three-second muted clip of real work (`docs/media/pane-*.mp4`, 20 to 110 KB, with its first frame as the poster in `docs/screenshots`, both from `bun run screenshots`): Claude Code's transcript streaming in while the tab's spinner turns, the three devices scrolling together, a build command typed and run in the shell, a line typed into pricing.ts. Clips play one after another while the frame is in view, with the right panel folded so the pane shows at about 0.8× and the top 16:10 of each tab. Local checks need a server with Range support (Chrome refuses video without it). There is no pause control, by the user's decision (2026-11-26); under reduced motion the first tab stays put. Three windows float over the frame and bob slowly on their own periods (5.5 to 7s, ±0.4rem): the project's spaces card (live markup, bottom left), the Git panel across repositories (top right) and the ports list (bottom right). Under 860px the spaces card sits under the pane and the other two go.
- **Spaces card (live):** the hero's one piece of markup that is a picture of the app: the storefront bracket and three space cards in the app's dark tokens. Claude Code's spinners turn at the app's 0.8s, the working card carries a Signal Blue halo beam running round its border every 3.2s, and the finished checkout-v2 card breathes on the app's 4s rhythm. All of it stops under reduced motion.
- **Fact strip:** four ruled cells on 12px Frame corners under the stage: Platform (the Apple mark, macOS), License (MIT, open source), Version ("Preview" plus the release tag from the GitHub API) and Price (free).
- **Agents grid:** Claude Code on a full-width lead row (Daylight Panel, a Signal Blue "Primary support" badge, one line on what it gets), then the other eleven agents and "Any other CLI" in a ruled 6-column grid (3, then 2 columns on phones): logo, name and a mark, filled for primary support, a ring for "testing required". Shapes, not colours, carry the meaning, and a legend plus a "not affiliated" line follow.
- **Split card:** one Daylight Panel card, 20px corners, with the agents story beside its window-framed screenshot and the launcher menu floating over the corner. Detail pairs (a small accent square, a bold line, one sentence) sit in two columns.
- **Hub:** the 11rem Signal Blue tile with the app icon in the middle, two Card-Lift cards each side (Scripts and Git left, Agents and Ports right), wired in by dashed Rule lines whose dashes flow toward the tile. Each card's icon sits on a tile in its own Channel Hue (180, 285, 15, 330) that breathes slowly; the Aira tile pulses and a blue-teal halo runs round it. The one place on the site where project hues appear on page chrome, because the cards stand for the parts of a project. On phones the wires disappear and the tile comes first.
- **Git tiles:** two cards stacked in the slot beside the tall Spaces tile, each with copy on the left and its picture on the right. "Commit across every repo" holds the Git panel crop (the changes tree); "Generate drafts the message" holds a live Generate block in the app's dark palette: the button spins, the message types in, Commit lights up, then it loops; static with the finished message under reduced motion.
- **Bento:** a 12-column grid of 20px tiles. One is filled Signal Blue with white copy (Spaces); the rest are paper or Daylight Panel with a real screenshot inside, on 10px corners with the Card Lift shadow. Portrait sidebar crops are capped at 19rem wide.
- **Deck:** five 18px cards in a row (two columns on phones), each with a 3rem accent-soft icon tile, a bold label and one line. They sit at ±1.5° and the even ones 12px lower; one is lifted in Signal Blue. Hover straightens a card; under reduced motion and on phones they stand straight.
- **Build from source:** copy beside a dark terminal card (the code block keeps Console Black whatever the theme) with a Copy button and the clone commands.
- **Finale:** the closing headline, two pills and the mono footnote, lit from below by the Accent Glow wash.
- **Footer:** the brand and a one-line description, then Product, Source and Built-with columns, and a fine-print row with the copyright and "Screenshots show demo projects."
- **Features page:** one section per feature, copy (sticky on wide screens) beside one or two short muted clips (`docs/media/feat-*.mp4`, 15 to 185 KB, posters in `docs/screenshots`), each cropped to the part of the app the feature lives in: the sidebar for spaces and scripts, the storefront card for agents, the Git panel for git, the commit box for Generate, the ports list alone on a transparent ground, the whole window for the theme switch, the main pane for the editor, shell, browser and capture. Crops under 800px wide are grabbed at 2× so text stays crisp on Retina screens; wider ones at 1× to keep the frame rate. Clips play at their recorded CSS size, never scaled up, loop while 30% in view, and stay on their poster under reduced motion. Tall crops stop where the feature does: the sidebar clip ends under ui-kit, the Git clip under the changes tree. Bullets are a few words each, spaced well apart.
- **Guide page:** a sticky "On this page" list that marks the section in view, then reference tables (keys in raised `kbd` caps, settings with defaults, runners, agents, providers, confirmations) on Daylight Panel with Hairline rows; wide tables scroll inside a focusable region.
- **Feedback page:** one form: a Bug / Idea / Question / Other pill radio group, a required message, optional name and email, and a status line that says plainly whether anything was sent. The form posts to whatever endpoint is set as its `action`; with none set, nothing is sent and the text stays.

## 6. Do's and Don'ts

### Do:
- **Do** let state read at a glance: a dot, one word and a count per row (Working – Claude Code · now, 3 running · 1 failed).
- **Do** keep controls at 24 to 28px and corners at 6 to 10px (14px only for dialogs).
- **Do** step tone (Night Ink → Console Black → Raised Graphite) before reaching for a border, and a border before a shadow.
- **Do** reserve motion for work in progress (a 0.8s spinner, slowed to 2.4s under reduced motion) and for a finished agent's breath.
- **Do** put dark ink (#06101f) on Signal Blue fills so labels meet WCAG 2.2 AA.
- **Do** mirror every new color role in the light theme.
- **Do** show features as screenshots of the real app with demo data; the only moving pictures are the hero's tab cycle (with a pause control) and its live spaces card.

### Don't:
- **Don't** pulse, blink or breathe a running state. Running is the normal case and stays steady, because routine running states stay quiet.
- **Don't** use a project hue for status, or a status color for identity.
- **Don't** add colored side stripes to cards, rows or alerts. The project bracket and its space bars are the only vertical stripes in the system; hue appears only on the bracket and the selected space's bar, and never means status.
- **Don't** cast shadows from resting panels, cards or rows.
- **Don't** introduce gradients, glass or blur on app chrome. On the website, glass is the nav's alone and gradients belong to the hero blobs and the finale wash only.
- **Don't** ship a webfont in the app or uppercase anything but 11px section labels.
- **Don't** make a control taller than 28px inside panels; size belongs to content, not chrome.
- **Don't** give website cards a project hue, a hue wash or a coloured border; the one accent and a Hairline carry every card, and the Accent Glow stays with the accent surfaces.
- **Don't** restyle a picture of the app to match the page (The Picture Rule).
- **Don't** autoplay anything with sound, or anything that keeps moving without a pause control.
