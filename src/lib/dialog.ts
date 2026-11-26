import { useStore } from "../store";

/** An in-app confirm (components/ConfirmDialog) with the plugin-dialog `ask`/`message` contract, so call sites only swap the import. */
export type ConfirmReq = {
  message: string;
  title?: string;
  kind?: "info" | "warning" | "error";
  buttons: string[]; // first = primary (Enter); the last is the cancel action (Escape / backdrop)
  resolve: (label: string | null) => void;
};

let queue: Promise<unknown> = Promise.resolve();

/** Shows the buttons and resolves with the clicked label (null = dismissed). Requests are shown one at a time. */
export function choose(message: string, opts: { title?: string; kind?: ConfirmReq["kind"]; buttons: string[] }): Promise<string | null> {
  const run = () =>
    new Promise<string | null>((resolve) => {
      useStore.setState({
        confirm: {
          message,
          title: opts.title,
          kind: opts.kind,
          buttons: opts.buttons,
          resolve: (label) => {
            useStore.setState({ confirm: null });
            resolve(label);
          },
        },
      });
    });
  const next = queue.then(run, run);
  queue = next;
  return next;
}

/** OK / Cancel; true when confirmed. */
export async function ask(message: string, opts: { title?: string; kind?: ConfirmReq["kind"]; okLabel?: string; cancelLabel?: string } = {}) {
  const ok = opts.okLabel ?? "OK";
  return (await choose(message, { title: opts.title, kind: opts.kind, buttons: [ok, opts.cancelLabel ?? "Cancel"] })) === ok;
}
