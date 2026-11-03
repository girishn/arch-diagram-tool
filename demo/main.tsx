import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArchExplorer, THEMES, getTheme, themeStyle } from "../src/index.ts";
import type { DiagramSpec } from "../src/index.ts";
import { awsPack } from "./awsPack.ts";
import { syntheticSpec } from "./synthetic.ts";

// Every examples/*.json is picked up, so a new file shows in the picker with no code change. They load as text first,
// so a typo in a hand-written file shows a readable error here instead of breaking the whole page.
// examples/stress/ holds large diagrams used to stress the tool; they are listed here but are not part of the test suite
const files = import.meta.glob(["../examples/*.json", "../examples/stress/*.json"], { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const FIRST = "simple-web-app";

type Example = { file: string; title: string; text: string };
const EXAMPLES: Example[] = Object.entries(files)
  .map(([path, text]) => {
    const file = path.split("/").pop()!.replace(/\.json$/, "");
    let title = file;
    try {
      title = (JSON.parse(text) as { title?: string }).title ?? file;
    } catch {
      // not valid JSON yet: it is listed under its file name and the error shows when it is opened
    }
    return { file, title, text };
  })
  .sort((a, b) => (a.file === FIRST ? -1 : b.file === FIRST ? 1 : a.file.localeCompare(b.file)));

// ?example=<file name> opens one directly, e.g. ?example=platform-stack
const fromUrl = () => {
  const wanted = new URLSearchParams(location.search).get("example");
  return EXAMPLES.find((e) => e.file === wanted)?.file ?? EXAMPLES[0]?.file ?? "";
};

const THEME_KEY = "adg-demo-theme";
const initialTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === saved) ? (saved as string) : "brass";
  } catch {
    return "brass";
  }
};

function Demo() {
  const [theme, setTheme] = useState(initialTheme);
  const pick = (id: string) => {
    setTheme(id);
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      // private window or blocked storage: the choice just is not remembered
    }
  };
  useEffect(() => {
    document.documentElement.style.background = getTheme(theme).vars.bg ?? "";
  }, [theme]);

  // ?icons=aws draws the local-only AWS icons, if this machine has them (see awsPack.ts)
  const useAws = new URLSearchParams(location.search).get("icons") === "aws";
  // ?layers=off|floors chooses how a spec's layers are drawn; the picker beside the example list does the same
  const layersParam = new URLSearchParams(location.search).get("layers");
  const [layerMode, setLayerMode] = useState<"off" | "floors">(layersParam === "off" ? "off" : "floors");
  // ?isolate=1 and ?declutter=1 turn on the two options that thin out the arrows; the checkboxes beside the pickers do the same
  const flag = (name: string) => new URLSearchParams(location.search).get(name) === "1";
  const [isolate, setIsolate] = useState(flag("isolate"));
  const [declutter, setDeclutter] = useState(flag("declutter"));
  const [routed, setRouted] = useState(new URLSearchParams(location.search).get("routing") !== "straight");
  const setFlag = (name: string, on: boolean) => {
    const q = new URLSearchParams(location.search);
    if (on) q.set(name, "1"); else q.delete(name);
    history.replaceState(null, "", `?${q}`);
  };
  const [file, setFile] = useState(fromUrl);
  const current = EXAMPLES.find((e) => e.file === file);
  const [text, setText] = useState(current?.text ?? "");
  useEffect(() => setText(current?.text ?? ""), [current?.text]);

  // ?bench=<n> draws a synthetic n-component system, for render-cost measurements
  const bench = Number(new URLSearchParams(location.search).get("bench"));
  const parsed = useMemo(() => {
    if (bench > 0) return { spec: syntheticSpec(Math.min(bench, 500)), error: null };
    try {
      return { spec: JSON.parse(text) as DiagramSpec, error: null };
    } catch (e) {
      return { spec: null, error: (e as Error).message };
    }
  }, [text, bench]);

  return (
    <main style={{ ...themeStyle(theme), maxWidth: 1880, margin: "0 auto", padding: "2rem 1rem 4rem", color: "var(--adg-text)", fontFamily: "var(--adg-font-serif)" }}>
      <p style={{ fontFamily: "var(--adg-font-mono)", fontSize: "0.65rem", letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--adg-accent)", margin: 0 }}>arch-diagram-tool · demo</p>
      <h1 style={{ fontWeight: 300, margin: "0.5rem 0 1rem" }}>Generic icon pack, example specs</h1>
      {EXAMPLES.length === 0 ? (
        <p role="alert">No example specs found. Put a .json spec in the examples/ folder.</p>
      ) : (
        <label style={{ display: "block", marginBottom: "1.2rem", fontFamily: "var(--adg-font-mono)", fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Example{" "}
          <select
            value={file}
            onChange={(e) => {
              setFile(e.target.value);
              history.replaceState(null, "", `?example=${e.target.value}`);
            }}
            style={{ marginLeft: 8, maxWidth: "calc(100% - 4.5rem)", padding: "0.4rem 0.6rem", background: "var(--adg-bg2)", color: "var(--adg-text)", border: "1px solid var(--adg-accent-dim)", font: "inherit" }}
          >
            {EXAMPLES.map((e) => (
              <option key={e.file} value={e.file}>
                {e.title === e.file ? e.file : `${e.title} (${e.file}.json)`}
              </option>
            ))}
          </select>
        </label>
      )}
      {parsed.spec?.layers?.length ? (
        <label style={{ display: "block", marginBottom: "1.2rem", fontFamily: "var(--adg-font-mono)", fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Layers{" "}
          <select
            value={layerMode}
            onChange={(e) => {
              const v = e.target.value as "off" | "floors";
              setLayerMode(v);
              const q = new URLSearchParams(location.search);
              q.set("layers", v);
              history.replaceState(null, "", `?${q}`);
            }}
            style={{ marginLeft: 8, maxWidth: "calc(100% - 4.5rem)", padding: "0.4rem 0.6rem", background: "var(--adg-bg2)", color: "var(--adg-text)", border: "1px solid var(--adg-accent-dim)", font: "inherit" }}
          >
            <option value="floors">Floors (stacked in isometric, bands in top view)</option>
            <option value="off">Off</option>
          </select>
        </label>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1.6rem", marginBottom: "1.2rem", fontFamily: "var(--adg-font-mono)", fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
        <label>
          <input type="checkbox" checked={isolate} onChange={(e) => { setIsolate(e.target.checked); setFlag("isolate", e.target.checked); }} /> Isolate selection
        </label>
        <label>
          <input type="checkbox" checked={routed} onChange={(e) => { setRouted(e.target.checked); const q = new URLSearchParams(location.search); if (e.target.checked) q.delete("routing"); else q.set("routing", "straight"); history.replaceState(null, "", `?${q}`); }} /> Route arrows around cards
        </label>
        <label>
          <input type="checkbox" checked={declutter} onChange={(e) => { setDeclutter(e.target.checked); setFlag("declutter", e.target.checked); }} /> Hide minor arrows when zoomed out
        </label>
      </div>
      {parsed.spec ? (
        <ArchExplorer key={file} spec={parsed.spec} theme={theme} onThemeChange={pick} layers={layerMode} isolate={isolate} declutter={declutter} routing={routed ? "orthogonal" : "straight"} wheelZoom={new URLSearchParams(location.search).get("wheel") === "ctrl" ? "ctrl" : "always"} iconPack={useAws && awsPack ? awsPack : undefined} />
      ) : (
        <p role="alert" style={{ border: "1px solid var(--adg-risk)", padding: "1rem 1.2rem", background: "var(--adg-bg2)" }}>
          {current ? `${current.file}.json is not valid JSON: ` : "Invalid JSON: "}
          {parsed.error}. Fix it in the editor below, or in the file, and the page reloads.
        </p>
      )}
      <details style={{ marginTop: "2rem" }} open={parsed.error ? true : undefined}>
        <summary style={{ cursor: "pointer" }}>Edit the spec (live, not saved to the file)</summary>
        <textarea
          aria-label="Diagram spec JSON"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{ width: "100%", boxSizing: "border-box", height: 360, marginTop: "0.8rem", background: "var(--adg-bg2)", color: "var(--adg-text)", border: "1px solid var(--adg-border)", fontFamily: "var(--adg-font-mono)", fontSize: 12, padding: "0.8rem" }}
        />
      </details>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
