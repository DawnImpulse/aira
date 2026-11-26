import type { UpdateState } from "../lib/updates";

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;

/** Download bar + "12.3 MB of 48 MB · 26%" (indeterminate when the server sends no size). Shared by the card and Settings → Updates. */
export function UpdateProgress({ u }: { u: UpdateState }) {
  const known = u.total !== undefined && u.progress !== undefined;
  return (
    <div className="update-progress">
      {known ? <progress value={u.progress} max={1} /> : <progress />}
      <span className="dim small">
        {mb(u.downloaded ?? 0)}
        {known && ` of ${mb(u.total!)} · ${Math.round(u.progress! * 100)}%`}
      </span>
    </div>
  );
}
