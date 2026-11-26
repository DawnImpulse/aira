// Shared by every page: the release lookup, copy buttons and the landing hero's tab cycle. Loaded with `defer`.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Download buttons point at the latest release page; with JavaScript they link the versioned DMG itself
// (Aira_X.Y.Z_universal.dmg) and the version shows next to them. Unauthenticated API: 60 requests an hour
// per IP, so a failure just leaves the static text.
fetch("https://api.github.com/repos/DawnImpulse/aira/releases/latest")
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((rel) => {
    const dmg = rel.assets.find((a) => a.name.endsWith(".dmg"));
    if (dmg) for (const a of document.querySelectorAll("a[data-download]")) a.href = dmg.browser_download_url;
    for (const s of document.querySelectorAll("[data-latest]")) s.textContent = rel.tag_name;
  })
  .catch(() => {});

// Copy a code block without its "$ " prompts. Without JavaScript the button stays hidden.
for (const block of document.querySelectorAll(".code")) {
  const copy = block.querySelector(".copy-btn");
  const status = block.querySelector("[role=status]");
  const code = block.querySelector("code");
  if (!copy) continue;
  copy.hidden = false;
  copy.addEventListener("click", async () => {
    const text = [...code.childNodes].filter((n) => !n.classList?.contains("prompt")).map((n) => n.textContent).join("");
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
      status.textContent = "Commands copied to the clipboard.";
    } catch {
      copy.textContent = "Copy failed";
      status.textContent = "Couldn't copy. Select the commands and copy them instead.";
    }
    setTimeout(() => {
      copy.textContent = "Copy";
      status.textContent = "";
    }, 2000);
  });
}

// Landing hero: the main pane plays each tab's short clip in turn while at least 30% in view (a clip ends, the
// next tab comes forward). No pause control (the user's call, 2026-11-26); under reduced motion the first
// tab's poster stays put.
const pane = document.querySelector(".pane");
if (pane && !still) {
  const clips = [...pane.querySelectorAll(".pane-shot")];
  let i = 0, on = false;
  const show = (n) => {
    i = n;
    clips.forEach((c, k) => {
      c.classList.toggle("on", k === n);
      if (k !== n) c.pause();
    });
    const c = clips[n];
    c.currentTime = 0;
    c.play().catch(() => {});
  };
  for (const c of clips) c.addEventListener("ended", () => on && show((i + 1) % clips.length));
  new IntersectionObserver(([e]) => {
    on = e.isIntersecting;
    on ? show(i) : clips[i].pause();
  }, { threshold: 0.3 }).observe(pane);
}

// The Git tile's Generate block: spinner, then the message types in, Commit lights up, pause, repeat.
const gen = document.querySelector(".gen");
if (gen && !still) {
  const typed = gen.querySelector(".typed");
  const msg = "fix(pricing): tax the discounted subtotal\n\nRound once at the end; fixed coupons respect minSpend.";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (;;) {
      typed.textContent = "";
      gen.classList.remove("done");
      gen.classList.add("working");
      await wait(1400);
      gen.classList.remove("working");
      for (const ch of msg) {
        typed.textContent += ch;
        await wait(ch === "\n" ? 120 : 28);
      }
      gen.classList.add("done");
      await wait(3500);
    }
  })();
} else if (gen) {
  gen.querySelector(".typed").textContent = "fix(pricing): tax the discounted subtotal\n\nRound once at the end; fixed coupons respect minSpend.";
  gen.classList.add("done");
}

// Feature clips: muted loops that play while at least 30% in view and pause otherwise; under reduced motion
// they stay on their poster.
if (!still) {
  const io = new IntersectionObserver((entries) => {
    for (const { target: v, isIntersecting } of entries) isIntersecting ? v.play().catch(() => {}) : v.pause();
  }, { threshold: 0.3 });
  for (const v of document.querySelectorAll("video.clip")) io.observe(v);
}
