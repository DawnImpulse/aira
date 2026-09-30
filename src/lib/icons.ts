import { getIconForDirectoryPath, getIconUrlByName, getIconUrlForFilePath, isMaterialIconName } from "vscode-material-icons";

// Dev serves straight from node_modules; the build copies the SVGs to /material-icons (vite.config.ts).
const ICONS = import.meta.env.DEV ? "/node_modules/vscode-material-icons/generated/icons" : "/material-icons";

export const iconUrl = (name: string) => getIconUrlByName(name as Parameters<typeof getIconUrlByName>[0], ICONS);
export const fileIconUrl = (path: string) => getIconUrlForFilePath(path, ICONS);

export function dirIconUrl(path: string, open: boolean) {
  const name = getIconForDirectoryPath(path);
  const openName = `${name}-open`;
  return getIconUrlByName(open && isMaterialIconName(openName) ? openName : name, ICONS);
}
