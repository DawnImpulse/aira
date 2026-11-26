// Renders docs/og.jpg, the 1200×630 social card behind og:image: the home page's hero on white, with its
// blobs, the two-tone headline and the hero shot.
// Runs at the end of `bun run screenshots`; on its own (no dev server needed): node scripts/screenshots/og.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const docs = new URL("../../docs/", import.meta.url);
const inline = (file, type) => `data:${type};base64,${readFileSync(new URL(file, docs)).toString("base64")}`;
// The home page's three blobs (docs/index.html .blobs), one per project hue: [hue, left px, top px, size px].
const blobs = [[210, -260, -300, 760], [330, 760, -340, 760], [180, 420, 120, 640]]
  .map(([h, x, y, s]) => `<i style="--h:${h};left:${x}px;top:${y}px;width:${s}px;height:${s}px"></i>`).join("");

const html = `<!doctype html>
<style>
  @font-face { font-family: "Funnel Display"; src: url(${inline("fonts/funnel-display-latin.woff2", "font/woff2")}); font-weight: 300 800; }
  body { margin: 0; height: 630px; overflow: hidden; position: relative; isolation: isolate; background: #fff; color: #1c1c21; font-family: "Funnel Display"; text-align: center; }
  .blobs { position: absolute; inset: 0; z-index: -1; overflow: hidden; }
  .blobs i { position: absolute; border-radius: 50%; opacity: 0.8; background: radial-gradient(closest-side, hsl(var(--h) 85% 72% / 0.55), transparent 70%); }
  .blobs::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent 45%, #fff 75%); }
  header { display: grid; justify-items: center; padding-top: 44px; }
  .brand { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 30px; font-weight: 650; letter-spacing: -0.01em; }
  .brand img { width: 44px; height: 44px; border-radius: 12px; }
  h1 { margin: 18px 0 0; font-size: 72px; font-weight: 620; line-height: 1.05; letter-spacing: -0.025em; }
  h1 .ac { color: #1d4fc4; }
  .shot { position: absolute; left: 100px; top: 338px; width: 1000px; border-radius: 14px; background: #0b0b0c; box-shadow: 0 0 0 1px rgb(28 28 33 / 0.08), 0 40px 90px -30px rgb(28 28 33 / 0.45); }
</style>
<div class="blobs">${blobs}</div>
<header>
  <p class="brand"><img src="${inline("icon.svg", "image/svg+xml")}" alt="">Aira</p>
  <h1><span class="ac">All your projects,</span><br>running at once.</h1>
</header>
<img class="shot" src="${inline("screenshots/hero.webp", "image/webp")}" alt="">`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL("og.jpg", docs).pathname, type: "jpeg", quality: 90 });
await browser.close();
console.log("Wrote docs/og.jpg");
