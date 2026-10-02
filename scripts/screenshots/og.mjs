// Renders docs/og.jpg, the 1200×630 social card behind og:image: the home page's beams and headline over the hero shot.
// Runs at the end of `bun run screenshots`; on its own (no dev server needed): node scripts/screenshots/og.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const docs = new URL("../../docs/", import.meta.url);
const inline = (file, type) => `data:${type};base64,${readFileSync(new URL(file, docs)).toString("base64")}`;
// The home page's five channels (docs/index.html .beams), one per project hue: [hue, left %, width vmax].
const beams = [[210, 2, 13], [15, 22, 8], [180, 38, 17], [285, 60, 9], [330, 76, 12]]
  .map(([h, x, w]) => `<i style="--h:${h};--x:${x}%;--w:${w}vmax"></i>`).join("");

const html = `<!doctype html>
<style>
  @font-face { font-family: "Funnel Display"; src: url(${inline("fonts/funnel-display-latin.woff2", "font/woff2")}); font-weight: 300 800; }
  body { margin: 0; height: 630px; overflow: hidden; position: relative; isolation: isolate; background: #000; color: #f3f3f6; font-family: "Funnel Display"; text-align: center; }
  .beams { position: absolute; inset: 0; z-index: -1; overflow: hidden; }
  .beams i {
    position: absolute; top: -30%; left: var(--x); width: var(--w); height: 160%; rotate: 28deg;
    background: linear-gradient(90deg, transparent, hsl(var(--h) 72% 58% / 0.22) 22%, hsl(var(--h) 76% 64% / 0.55) 46%, hsl(var(--h) 82% 72% / 0.7) 50%, hsl(var(--h) 76% 64% / 0.55) 54%, hsl(var(--h) 72% 58% / 0.22) 78%, transparent);
    mask: linear-gradient(transparent, #000 28% 62%, transparent);
  }
  header { position: relative; display: grid; justify-items: center; padding-top: 50px; }
  header::before { content: ""; position: absolute; inset: 0 190px -50px; z-index: -1; background: radial-gradient(closest-side, rgb(0 0 0 / 0.92), rgb(0 0 0 / 0.86) 66%, transparent); }
  .brand { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 34px; font-weight: 650; letter-spacing: -0.01em; }
  .brand img { width: 50px; height: 50px; }
  h1 { margin: 20px 0 0; font-size: 68px; font-weight: 640; line-height: 1.04; letter-spacing: -0.03em; text-shadow: 0 1px 14px rgb(0 0 0 / 0.85); }
  .shot { position: absolute; left: 100px; top: 330px; width: 1000px; border-radius: 14px; box-shadow: 0 0 0 1px #2a2a31, 0 50px 120px -40px rgb(0 0 0 / 0.85); }
</style>
<div class="beams">${beams}</div>
<header>
  <p class="brand"><img src="${inline("icon.svg", "image/svg+xml")}" alt="">Aira</p>
  <h1>All your projects,<br>running at once.</h1>
</header>
<img class="shot" src="${inline("screenshots/hero.webp", "image/webp")}" alt="">`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL("og.jpg", docs).pathname, type: "jpeg", quality: 90 });
await browser.close();
console.log("Wrote docs/og.jpg");
