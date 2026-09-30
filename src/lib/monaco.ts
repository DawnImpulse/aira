import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { api, type Settings } from "../ipc";
import { useStore } from "../store";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

// No LSP / project context: keep syntax errors, drop "cannot find module" noise.
for (const d of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  d.setDiagnosticsOptions({ noSemanticValidation: true });
  d.setCompilerOptions({
    jsx: monaco.typescript.JsxEmit.Preserve,
    target: monaco.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    allowJs: true,
  });
}

monaco.editor.defineTheme("ide-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0b0b0c",
    "editorGutter.background": "#0b0b0c",
    "editor.lineHighlightBackground": "#141417",
    "editorLineNumber.foreground": "#4a4a52",
    "editorLineNumber.activeForeground": "#a0a0a8",
    "editorWidget.background": "#141416",
    "editorOverviewRuler.border": "#00000000",
  },
});
monaco.editor.defineTheme("ide-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editorGutter.background": "#ffffff",
    "editor.lineHighlightBackground": "#f5f5f7",
    "editorLineNumber.foreground": "#b0b0b8",
    "editorOverviewRuler.border": "#00000000",
  },
});

export { monaco };

export const editorOptions = (s: Settings): monaco.editor.IEditorOptions => ({
  fontFamily: `"${s.monoFont}", "SF Mono", Menlo, monospace`,
  fontSize: s.fontSize,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  renderLineHighlight: "line",
  padding: { top: 8 },
});

export function setEditorTheme(dark: boolean, s: Settings) {
  monaco.editor.setTheme(dark ? "ide-dark" : "ide-light");
  for (const e of monaco.editor.getEditors()) e.updateOptions(editorOptions(s));
}

// ---------- models (outlive editor instances so undo + unsaved edits survive tab switches) ----------

const saved = new Map<string, number>(); // path → alternative version id at last load/save
const uri = (path: string) => monaco.Uri.file(path);
export const modelFor = (path: string) => monaco.editor.getModel(uri(path));

function setDirty(path: string, dirty: boolean) {
  if (!!useStore.getState().dirty[path] === dirty) return;
  useStore.setState((s) => ({ dirty: { ...s.dirty, [path]: dirty } }));
}

export async function openModel(path: string) {
  const existing = modelFor(path);
  if (existing) return existing;
  const text = await api.readFile(path);
  const model = modelFor(path) ?? monaco.editor.createModel(text, undefined, uri(path));
  saved.set(path, model.getAlternativeVersionId());
  model.onDidChangeContent(() => setDirty(path, model.getAlternativeVersionId() !== saved.get(path)));
  return model;
}

export async function saveModel(path: string) {
  const model = modelFor(path);
  if (!model) return;
  const version = model.getAlternativeVersionId();
  await api.writeFile(path, model.getValue());
  saved.set(path, version);
  setDirty(path, model.getAlternativeVersionId() !== version);
}

export function disposeModel(path: string) {
  modelFor(path)?.dispose();
  saved.delete(path);
  setDirty(path, false);
}

/** External change: reload only a clean buffer whose disk content really differs (our own save echoes back). */
export async function reloadIfClean(path: string) {
  const model = modelFor(path);
  if (!model || model.getAlternativeVersionId() !== saved.get(path)) return;
  const text = await api.readFile(path).catch(() => null);
  if (text === null || text === model.getValue() || model.isDisposed()) return;
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  saved.set(path, model.getAlternativeVersionId());
}

/** Lines of the top-level `"scripts": { ... }` block in a package.json model. */
export function packageScriptLines(model: monaco.editor.ITextModel) {
  const out: { line: number; name: string }[] = [];
  const lines = model.getLinesContent();
  const start = lines.findIndex((l) => /^\s{0,4}"scripts"\s*:\s*\{\s*$/.test(l));
  if (start < 0) return out;
  for (let i = start + 1; i < lines.length && !/^\s*\}/.test(lines[i]); i++) {
    const m = lines[i].match(/^\s*"([^"]+)"\s*:/);
    if (m) out.push({ line: i + 1, name: m[1] });
  }
  return out;
}
