// Styled tooltips for every [title] element. WKWebView doesn't reliably show native title
// tooltips, so the title moves to data-tip on first hover (suppressing the native one).

let tip: HTMLDivElement | null = null;
let current: Element | null = null;
let timer: number | undefined;

function hide() {
  clearTimeout(timer);
  current = null;
  tip?.remove();
  tip = null;
}

function show(el: Element, text: string) {
  if (!el.isConnected || current !== el) return;
  tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("role", "tooltip");
  tip.textContent = text;
  document.body.appendChild(tip);
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const below = r.bottom + 6;
  const top = below + t.height > window.innerHeight - 4 ? r.top - t.height - 6 : below;
  const left = Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 4);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

export function installTooltips() {
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as Element | null)?.closest?.("[title], [data-tip]");
    if (!el || el === current) return;
    hide();
    const title = el.getAttribute("title");
    if (title !== null) {
      el.setAttribute("data-tip", title);
      el.removeAttribute("title");
    }
    const text = el.getAttribute("data-tip");
    if (!text) return;
    current = el;
    timer = window.setTimeout(() => show(el, text), 350);
  });
  document.addEventListener("pointerout", (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hide();
  });
  for (const ev of ["mousedown", "wheel", "keydown", "blur"]) window.addEventListener(ev, hide, true);
}
