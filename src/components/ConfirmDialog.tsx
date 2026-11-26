import { useEffect, useRef } from "react";
import type { ConfirmReq } from "../lib/dialog";
import { cx, Icon, useOverlay } from "./ui";

/** App-styled replacement for the OS confirm. Enter = first button, Escape/backdrop = last (cancel). */
export function ConfirmDialog({ req }: { req: ConfirmReq }) {
  const primary = useRef<HTMLButtonElement>(null);
  useOverlay(true); // the embedded browser webview steps aside (BrowserView matches `.modal-backdrop`)
  const cancel = req.buttons.length > 1 ? req.buttons[req.buttons.length - 1] : null;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null; // give focus back (a terminal, usually) once answered
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter") return;
      // Enter on a focused (tabbed-to) button activates that button, not the default.
      if (e.key === "Enter" && document.activeElement !== primary.current && document.activeElement?.closest(".confirm")) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // a Modal underneath (Settings) also listens for Escape
      req.resolve(e.key === "Enter" ? req.buttons[0] : cancel);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, [req, cancel]);
  const danger = req.kind === "warning" || req.kind === "error";
  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && req.resolve(cancel)}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label={req.title ?? "Confirm"}>
        <Icon name={req.kind === "error" ? "error" : req.kind === "warning" ? "warning" : "info"} size={22} className={cx("confirm-icon", req.kind === "error" ? "red" : req.kind === "warning" ? "amber" : undefined)} />
        <div className="confirm-body">
          {req.title && <b>{req.title}</b>}
          <p>{req.message}</p>
          <div className="confirm-actions">
            {req.buttons.map((label, i) => (
              <button key={label} ref={i === 0 ? primary : undefined} type="button" className={cx("btn", i === 0 && (danger ? "danger" : "primary"))} onClick={() => req.resolve(label)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
