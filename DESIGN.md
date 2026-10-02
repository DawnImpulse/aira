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
    textColor: "#ffffff"
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
- **Stage Black** (#000000): the intro and the closing "Build it." stage, so film grain stays invisible except where light falls.
- **Channel beams:** five soft diagonal beams in Channel Hues 210 (blue), 15 (coral), 180 (teal), 285 (purple) and 330 (pink). Green and amber are left out so the Signal Rule holds even on the website.
- **Feature cards** carry one of those hues each: a 20% top wash, a 30% border, no outer glow. Editor & themes uses 255 (indigo). The Features page gives each section its hue on the same terms, adding 195 (cyan) for Terminals and 345 (rose) for AI commit messages; page heads carry one soft wash (Features 210, Guide 180, Feedback 330).
- **Agent chips** carry each agent's own brand colour (from `src/lib/agents.ts`) as a 16% to 7% fill and a 42% border; logos stay unaltered, single-colour logos are drawn in Site Ink. Agents with a grey brand colour get grey chips.
- **Stage Pool** (#000000 at 82–90%): every line of text over the beams sits on a dark pool sized to the text block, or on a black chip (the mono footnote).

### Named Rules
**The Channel Rule.** Project hues say *which*, never *what*. A project's color never signals running, failed or done; that is the status palette's job.

**The Signal Rule.** Green, red and amber mean exactly one thing each, everywhere: running, failed, needs attention. Never use them for decoration or for project identity.

**The Glass Exception.** Glass appears exactly once: the website nav, after the page scrolls, because content passes under it (72% Site Glass, 18px blur, 1.5 saturation, a 9% white border; solid Site Nav where backdrop-filter isn't supported). Never on cards, never in the app.

**The Lit Text Rule.** On the website, no text sits directly on light. Words over the beams get a Stage Pool or a chip, checked against the brightest pixel behind each line (WCAG 2.2 AA).

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
- **Funnel Display** for headings: Display (640, 40 to 92px, −0.03em, centered on the intro stage), Site Finale and Site Page Title (620, 42 to 76px), Site Headline (620, 34 to 56px, −0.02em), Site Title (600, 22px).
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
- **Window Frame** (`box-shadow: 0 0 0 1px #2a2a31, 0 30px 80px -30px rgb(0 0 0 / 0.85)`; a longer 120px blur on the hero): website only, for app screenshots shown as floating windows on 12px Frame corners.
- **Glass Nav** (`box-shadow: 0 12px 32px -16px rgb(0 0 0 / 0.7)`): website only, the nav once it floats over scrolled content.

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
- **Nav:** a pill (14px corners) floating 12px from the top, clear over the top of every page and frosted glass once anything scrolls under it (The Glass Exception). Brand, then Features, Guide and Feedback (the current page marked with a Signal Blue dot), GitHub, and a Signal Blue "Build from source" button that drops out under 640px.
- **Intro stage:** full viewport on Stage Black with a black fade along the top edge for the clear nav, the centered Display headline, Site Lead, a Signal Blue "Build from source" button and a mono footnote chip. The headline rises first, then the beams light one at a time; everything settles by about 2.7s and is static under reduced motion.
- **Intro recording:** right under the stage, overlapping it slightly, a 66rem window-framed recording (the Window Frame shadow) of the whole board: hopping between spaces, Git across repos, the ports list. It follows the same rules as every recording below.
- **Feature cards:** 18px Card corners on Console Black with their hue wash. One wide lead card (agents) sets its copy beside the recording; the rest are half cards in a 2 × 3 grid with copy over the recording, the last one a text card ("And the rest.") linking to the Features and Guide pages. Recordings are plain rounded media (12px Frame corners, no ring, no shadow), never a card inside a card.
- **Recordings:** muted, looping MP4s of the real app with demo data (`bun run clips`). Frames are grabbed at 2× without a cursor while every move, click and focus region is logged; a second pass composites each 30fps frame through a spring camera that zooms in on the action (up to 1.6× on wide clips, 2× on half-width ones) and back out, with a drawn cursor that dips and ripples Signal Blue on each click. Roughly 1 to 2 MB each. A lazy still (a zoomed key moment) sits underneath until playback starts; they play only while 40% visible, every one has a 36px pause/play button whose pause sticks, a hidden caption describes it, and nothing autoplays under reduced motion.
- **Agent chips:** pill chips (46px, Pill corners) with logo, name and a tracking mark: filled for exact status, half-filled for exact status through an opt-in hook file, a ring for terminal activity. Shapes, not colours, carry the meaning, and a legend explains them. Three centered rows (5 · 4 · 4) on wide screens stagger like bricks; narrow screens wrap freely. Where scroll timelines exist the chips rise in one after another; elsewhere they simply sit there. A "not affiliated" line follows.
- **Features page:** one section per feature, copy (sticky on wide screens) beside a hue-washed media panel holding the recording and any detail screenshots at their natural size with short captions; sides alternate. Bullets are a few words each, spaced well apart. Screenshots sit plain on the panel: dialog and popover crops bring their own border and shadow, so they never get another frame.
- **Guide page:** a sticky "On this page" list that marks the section in view, then reference tables (keys in raised `kbd` caps, settings with defaults, runners, agents, providers, confirmations) on Console Black with Hairline rows; wide tables scroll inside a focusable region.
- **Feedback page:** one form: a Bug / Idea / Question / Other pill radio group, a required message, optional name and email, and a status line that says plainly whether anything was sent. The form posts to whatever endpoint is set as its `action`; with none set, nothing is sent and the text stays.

## 6. Do's and Don'ts

### Do:
- **Do** let state read at a glance: a dot, one word and a count per row (Working – Claude Code · now, 3 running · 1 failed).
- **Do** keep controls at 24 to 28px and corners at 6 to 10px (14px only for dialogs).
- **Do** step tone (Night Ink → Console Black → Raised Graphite) before reaching for a border, and a border before a shadow.
- **Do** reserve motion for work in progress (a 0.8s spinner, slowed to 2.4s under reduced motion) and for a finished agent's breath.
- **Do** put dark ink (#06101f) on Signal Blue fills so labels meet WCAG 2.2 AA.
- **Do** mirror every new color role in the light theme.
- **Do** show features as recordings of the real app, with demo data and a pause control.

### Don't:
- **Don't** pulse, blink or breathe a running state. Running is the normal case and stays steady, because routine running states stay quiet.
- **Don't** use a project hue for status, or a status color for identity.
- **Don't** add colored side stripes to cards, rows or alerts. The project bracket and its space bars are the only vertical stripes in the system; hue appears only on the bracket and the selected space's bar, and never means status.
- **Don't** cast shadows from resting panels, cards or rows.
- **Don't** introduce gradients, glass or blur on app chrome. On the website, glass is the nav's alone.
- **Don't** ship a webfont in the app or uppercase anything but 11px section labels.
- **Don't** make a control taller than 28px inside panels; size belongs to content, not chrome.
- **Don't** put website text straight onto the beams; use a Stage Pool or a chip.
- **Don't** add coloured outer glows or ring-plus-wide-shadow frames to cards; the hue wash and border carry the colour.
- **Don't** autoplay anything with sound, or anything that keeps moving without a pause control.
