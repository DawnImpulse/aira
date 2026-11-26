import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { openLink } from "../lib/menu";
import { api, type Tab } from "../ipc";
import {
  basename, dirname, isUnder, notify, openFile, pinTab, projectOf, refreshStatus, repoOf, scriptCwd, uid, useStore,
} from "../store";
import { editorOptions, monaco, openModel, packageScriptLines, saveModel } from "../lib/monaco";
import { jsRunner } from "../lib/runners";
import { runScript } from "../lib/terminals";
import { Icon, IconButton } from "./ui";

const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();

export function FileView({ path, tabId }: { path: string; tabId: string }) {
  return IMAGE.test(path) ? <ImagePreview path={path} /> : <EditorView path={path} tabId={tabId} />;
}

function ImagePreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u = "";
    api
      .readFileBytes(path)
      .then((buf) => setUrl((u = URL.createObjectURL(new Blob([buf], { type: path.endsWith(".svg") ? "image/svg+xml" : "" })))))
      .catch(notify);
    return () => URL.revokeObjectURL(u);
  }, [path]);
  return (
    <div className="image-preview">
      {/* <img> never executes SVG scripts */}
      {url && <img src={url} alt={basename(path)} />}
    </div>
  );
}

function EditorView({ path, tabId }: { path: string; tabId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const dirty = useStore((s) => !!s.dirty[path]);
  const project = projectOf(path);
  const isMd = /\.(md|markdown|mdx)$/i.test(path);

  useEffect(() => {
    const editor = monaco.editor.create(host.current!, { ...editorOptions(useStore.getState().config.settings), automaticLayout: true, model: null });
    const subs: monaco.IDisposable[] = [];
    let alive = true;
    openModel(path)
      .then((model) => {
        if (!alive) return;
        editor.setModel(model);
        const vs = viewStates.get(path);
        if (vs) editor.restoreViewState(vs);
        editor.focus();
        subs.push(
          model.onDidChangeContent(() => {
            const tab = useStore.getState().config.layout.tabs.find((t) => t.id === tabId);
            if (tab?.kind === "file" && !tab.pinned) pinTab(tabId); // editing a preview keeps it
          }),
        );
        if (basename(path) === "package.json") subs.push(...packageJsonRunButtons(editor, model, path));
      })
      .catch((e) => alive && setError(String(e)));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveModel(path)
        .then(() => {
          const r = repoOf(path);
          if (r) refreshStatus(r.path);
        })
        .catch(notify);
    });
    return () => {
      alive = false;
      const vs = editor.saveViewState();
      if (vs) viewStates.set(path, vs);
      subs.forEach((d) => d.dispose());
      editor.dispose();
    };
  }, [path, tabId]);

  const rel = project && isUnder(path, project.path) ? `${project.name}/${path.slice(project.path.length + 1)}` : path;
  return (
    <div className="editor-view">
      <div className="view-toolbar">
        <span className="ellipsis" title={path}>{rel}</span>
        {dirty && <span className="dim">• unsaved</span>}
        <span className="spacer" />
        {isMd && (
          <IconButton
            icon={preview ? "code" : "visibility"}
            title={preview ? "Show source" : "Preview markdown"}
            onClick={() => {
              setMarkdown(monaco.editor.getModel(monaco.Uri.file(path))?.getValue() ?? "");
              setPreview(!preview);
            }}
          />
        )}
        <IconButton icon="save" title="Save (⌘S)" disabled={!dirty} onClick={() => saveModel(path).catch(notify)} />
        <IconButton icon="folder_open" title="Reveal in Finder" onClick={() => revealItemInDir(path).catch(notify)} />
      </div>
      {error ? (
        <div className="welcome">
          <Icon name="block" size={36} className="dim" />
          <p>{error === "binary" ? "Binary file – no preview available." : error}</p>
        </div>
      ) : null}
      <div className="editor-host" ref={host} style={{ display: error || preview ? "none" : undefined }} />
      {preview && (
        <div className="markdown-body scroll">
          {/* No rehype-raw: raw HTML in markdown is never rendered. */}
          <Markdown
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    if (href?.startsWith("http")) openLink(href);
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {markdown}
          </Markdown>
        </div>
      )}
    </div>
  );
}

/** WebStorm-style ▶ in the gutter of package.json scripts: runs the matching project script, or opens "Add script" prefilled. */
function packageJsonRunButtons(editor: monaco.editor.IStandaloneCodeEditor, model: monaco.editor.ITextModel, path: string) {
  editor.updateOptions({ glyphMargin: true });
  const deco = editor.createDecorationsCollection();
  const update = () =>
    deco.set(
      packageScriptLines(model).map(({ line, name }) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { glyphMarginClassName: "script-glyph", glyphMarginHoverMessage: { value: `Run / add script \`${name}\`` } },
      })),
    );
  update();
  let timer: number | undefined;
  return [
    model.onDidChangeContent(() => {
      clearTimeout(timer);
      timer = window.setTimeout(update, 300);
    }),
    editor.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const hit = packageScriptLines(model).find((x) => x.line === e.target.position?.lineNumber);
      if (hit) addPackageScript(path, hit.name);
    }),
    { dispose: () => clearTimeout(timer) },
  ];
}

async function addPackageScript(pkgPath: string, name: string) {
  const dir = dirname(pkgPath);
  const project = projectOf(dir);
  if (!project) return notify("Open this folder as a project to add its scripts.");
  const { scripts } = useStore.getState().config;
  const existing = project.scriptIds.map((id) => scripts[id]).find((s) => s && s.target === name && scriptCwd(s) === dir);
  if (existing) return runScript(existing.id);
  const runner = jsRunner((await api.readDir(dir).catch(() => [])).map((e) => e.name));
  useStore.setState({
    dialog: {
      kind: "script",
      projectId: project.id,
      preset: { name, runner, target: name, cwd: dir === project.path ? "" : dir.slice(project.path.length + 1), ownerProjectId: project.id },
    },
  });
}

// ---------- diff ----------

const languageFor = (path: string) => {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return monaco.languages.getLanguages().find((l) => l.extensions?.includes(ext) || l.filenames?.includes(basename(path)))?.id ?? "plaintext";
};

export function DiffView({ tab }: { tab: Extract<Tab, { kind: "diff" }> }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const status = useStore((s) => s.status[tab.repo]); // refetch whenever the repo's status changes
  const [binary, setBinary] = useState(false);
  const abs = `${tab.repo}/${tab.path}`;

  useEffect(() => {
    const ed = monaco.editor.createDiffEditor(host.current!, {
      ...editorOptions(useStore.getState().config.settings),
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
    });
    const lang = languageFor(tab.path);
    const id = uid();
    ed.setModel({
      original: monaco.editor.createModel("", lang, monaco.Uri.from({ scheme: "diff", path: `/${id}/a/${tab.path}` })),
      modified: monaco.editor.createModel("", lang, monaco.Uri.from({ scheme: "diff", path: `/${id}/b/${tab.path}` })),
    });
    editor.current = ed;
    return () => {
      const m = ed.getModel();
      ed.dispose();
      m?.original.dispose();
      m?.modified.dispose();
      editor.current = null;
    };
  }, [tab.path]);

  useEffect(() => {
    let alive = true;
    api
      .fileVersions(tab.repo, tab.path, tab.orig, tab.staged, !!tab.head)
      .then((v) => {
        const m = editor.current?.getModel();
        if (!alive || !m) return;
        setBinary(v.binary);
        // Only touch changed sides so refreshes don't reset the scroll position.
        if (m.original.getValue() !== v.original) m.original.setValue(v.original);
        if (m.modified.getValue() !== v.modified) m.modified.setValue(v.modified);
      })
      .catch(notify);
    return () => void (alive = false);
  }, [tab.repo, tab.path, tab.orig, tab.staged, status]);

  return (
    <div className="editor-view">
      <div className="view-toolbar">
        <Icon name="difference" size={14} className="accent" />
        <span className="ellipsis">{tab.path}</span>
        <span className="dim">{tab.head ? "HEAD ↔ working tree" : tab.staged ? "HEAD ↔ staged" : "staged ↔ working tree"}</span>
        <span className="spacer" />
        <IconButton icon="description" title="Open file" onClick={() => openFile(abs, true)} />
      </div>
      {binary && <div className="banner">Binary file – contents not shown.</div>}
      <div className="editor-host" ref={host} style={{ display: binary ? "none" : undefined }} />
    </div>
  );
}
