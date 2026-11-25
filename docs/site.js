// Shared by every page: the glass nav, demo recordings and copy buttons. Loaded with `defer`.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

// The nav is clear over the top of the page and turns to glass once anything scrolls under it.
const nav = document.querySelector(".nav");
const sentinel = document.createElement("div");
sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:16px;pointer-events:none";
document.body.prepend(sentinel);
new IntersectionObserver(([e]) => nav.classList.toggle("scrolled", !e.isIntersecting)).observe(sentinel);

// Recordings play while at least 40% visible and pause otherwise. A user's pause sticks; under reduced
// motion nothing autoplays and the button is the only way in.
const io = new IntersectionObserver((entries) => {
  for (const { target: v, intersectionRatio: r } of entries) {
    if (r >= 0.4 && !still && !v.dataset.held) v.play().catch(() => {});
    else v.pause();
  }
}, { threshold: [0, 0.4] });
for (const fig of document.querySelectorAll(".clip")) {
  const v = fig.querySelector("video");
  const b = fig.querySelector(".clip-btn");
  const sync = () => {
    b.dataset.state = v.paused ? "paused" : "playing";
    b.setAttribute("aria-label", `${v.paused ? "Play" : "Pause"} the ${b.dataset.name} recording`);
  };
  v.addEventListener("play", sync);
  v.addEventListener("pause", sync);
  v.addEventListener("playing", () => fig.classList.add("on"), { once: true });
  b.addEventListener("click", () => {
    if (v.paused) {
      delete v.dataset.held;
      v.play().catch(() => {});
    } else {
      v.dataset.held = "1";
      v.pause();
    }
  });
  b.hidden = false;
  sync();
  io.observe(v);
}

// Download buttons point at the latest release page; with JavaScript they link the versioned DMG itself
// (Aira_X.Y.Z_universal.dmg) and the version shows next to them. Unauthenticated API: 60 requests an hour
// per IP, so a failure just leaves the static links.
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
