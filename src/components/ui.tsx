import { useEffect, useReducer, type MouseEvent, type ReactNode } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { useStore } from "../store";
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

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Thinking orb that follows the app theme and pauses for reduced-motion users. */
export function Orb({ state, size = 20, color, title }: { state: OrbState; size?: 20 | 32 | 64; color?: string; title?: string }) {
  const theme = useStore((s) => s.config.settings.theme);
  return (
    <span className="orb" title={title} style={{ width: size, height: size }}>
      <ThinkingOrb state={state} size={size} color={color} theme={theme === "system" ? "auto" : theme} paused={reducedMotion.matches} />
    </span>
  );
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
