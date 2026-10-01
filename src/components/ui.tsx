import { useEffect, useReducer, useState, type MouseEvent, type ReactNode } from "react";
import { api, type ProjectIcon as ProjectIconValue } from "../ipc";
import { agentById } from "../lib/agents";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Icon({ name, size = 16, className, title, color }: { name: string; size?: number; className?: string; title?: string; color?: string }) {
  return (
    <span className={cx("material-symbols-outlined msi", className)} style={{ fontSize: size, color }} title={title} aria-hidden={!title}>
      {name}
    </span>
  );
}

export function IconButton({
  icon,
  title,
  onClick,
  size = 16,
  className,
  disabled,
}: {
  icon: string;
  title: string;
  onClick: (e: MouseEvent) => void;
  size?: number;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={cx("icon-btn", className)} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Wraps a handler so clicks on nested buttons don't also trigger the row. */
export const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

export function Modal({ title, subtitle, onClose, children, width = 520 }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span className="ellipsis">
            {title}
            {subtitle && <span className="modal-subtitle"> · {subtitle}</span>}
          </span>
          <IconButton icon="close" title="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Re-render periodically so relative times ("16m") stay fresh. */
export function useNow(ms = 30_000) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Small circular loader (CSS; stills itself under prefers-reduced-motion). */
export function Spinner({ size = 12, color, title }: { size?: number; color?: string; title?: string }) {
  return <span className="spinner" style={{ width: size, height: size, color }} title={title} role="status" aria-label={title ?? "Loading"} />;
}

const imageUrls = new Map<string, Promise<string>>();
/** Blob URL for an image inside a project (cached per path; SVG typed so <img> renders it, scripts never run). */
function imageUrl(path: string) {
  let url = imageUrls.get(path);
  if (!url) {
    url = api
      .readFileBytes(path)
      .then((buf) => URL.createObjectURL(new Blob([buf], { type: path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png" })));
    url.catch(() => imageUrls.delete(path));
    imageUrls.set(path, url);
  }
  return url;
}

/** A project's icon: material symbol (in the project color), emoji, or an image from its folder. */
export function ProjectIcon({ icon, color, size = 16 }: { icon?: ProjectIconValue; color?: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (icon?.type !== "image") return;
    let alive = true;
    imageUrl(icon.value).then((u) => alive && setSrc(u), () => alive && setSrc(undefined));
    return () => void (alive = false);
  }, [icon?.type, icon?.value]);
  if (icon?.type === "emoji") return <span className="project-emoji" style={{ fontSize: size * 0.95, width: size, height: size }} aria-hidden="true">{icon.value}</span>;
  if (icon?.type === "image") {
    return src ? <img className="project-image" src={src} width={size} height={size} alt="" /> : <Icon name="image" size={size} color={color} />;
  }
  return <Icon name={icon?.value ?? "data_object"} size={size} color={color} />;
}

/** Coding-agent logo. Single-color logos are masks filled with the current text color. */
export function AgentIcon({ agent, size = 16 }: { agent?: string; size?: number }) {
  const a = agentById(agent);
  if (!a) return <Icon name="smart_toy" size={size} />;
  if (a.mono) {
    // Quoted: small SVGs are inlined as data: URIs, which are invalid unquoted in url().
    const mask = `url(${JSON.stringify(a.icon)}) center / contain no-repeat`;
    return <span className="agent-icon mono" style={{ width: size, height: size, mask, WebkitMask: mask }} aria-hidden="true" />;
  }
  return <img className="agent-icon" src={a.icon} width={size} height={size} alt="" />;
}
