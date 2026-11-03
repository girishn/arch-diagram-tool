"use client";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DiagramSpec } from "./schema.ts";
import { validateSpec } from "./validate.ts";
import { ArchDiagram } from "./ArchDiagram.tsx";
import type { LayerMode } from "./ArchDiagram.tsx";
import type { IconPack } from "./icons.tsx";
import { EXPLORER_CSS } from "./styles.ts";
import { themeStyle } from "./themes.ts";
import type { Theme } from "./themes.ts";
import { useReducedMotion } from "./useReducedMotion.ts";
import type { TraceBarProps } from "./TraceBar.tsx";

const SPEEDS = ["Slow", "Normal", "Fast"];
const SPEED_FACTOR = [1.7, 1, 0.55]; // of stepMs

export type ArchExplorerProps = {
  spec: DiagramSpec;
  iconPack?: IconPack;
  /** Time on each step while the trace autoplays at normal speed, in ms. Stepping by hand never waits. */
  stepMs?: number;
  /** A built-in theme id or a `Theme` object. Defaults to "brass". */
  theme?: string | Theme;
  /** When given, the diagram shows a theme picker and reports the choice here. */
  onThemeChange?: (id: string) => void;
  /** How the spec's layers are drawn (see `LayerMode`). Defaults to floors. */
  layers?: LayerMode;
  /** See `ArchDiagram`. */
  isolate?: boolean;
  /** See `ArchDiagram`. */
  declutter?: boolean;
  /** See `ArchDiagram`. */
  wheelZoom?: "ctrl" | "always";
  /** See `ArchDiagram`. Defaults to right-angle routes around the cards. */
  routing?: "straight" | "orthogonal";
  className?: string;
  style?: CSSProperties;
};

/**
 * The diagram plus the request-trace controls and step list. Validates the spec first:
 * errors replace the diagram with a readable list, and lint warnings sit in a collapsed note.
 */
export function ArchExplorer({ spec, iconPack, stepMs = 1700, theme, onThemeChange, layers, isolate, declutter, wheelZoom, routing, className, style }: ArchExplorerProps) {
  const wrapStyle = { ...themeStyle(theme), ...style };
  const issues = useMemo(() => validateSpec(spec), [spec]);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const trace = errors.length ? [] : (spec.trace ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showPath, setShowPath] = useState(false);
  const reduced = useReducedMotion();
  // Someone who asks for reduced motion gets the whole route as a still, numbered path from the start.
  useEffect(() => {
    if (reduced) setShowPath(true);
  }, [reduced]);

  const goto = (i: number) => {
    setStep(i);
    setSelected(trace[i]?.node ?? null);
  };

  // Advance one step per tick while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      const next = (step ?? -1) + 1;
      if (next >= trace.length) setPlaying(false);
      else {
        setStep(next);
        setSelected(trace[next]?.node ?? null);
      }
    }, stepMs * (SPEED_FACTOR[speed] ?? 1));
    return () => clearTimeout(id);
  }, [playing, step, trace, stepMs, speed]);

  const end = () => {
    setPlaying(false);
    setStep(null);
    setSelected(null);
  };

  if (errors.length) {
    return (
      <div className={`adx${className ? ` ${className}` : ""}`} style={wrapStyle}>
        <style>{EXPLORER_CSS}</style>
        <div className="adx-errors" role="alert">
          <h2>This diagram spec is not valid</h2>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                {e.path ? `${e.path}: ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const traceNode = step !== null ? (trace[step]?.node ?? null) : null;
  const prevTraceNode = step !== null && step > 0 ? (trace[step - 1]?.node ?? null) : null;

  const traceBar: TraceBarProps | null = trace.length
    ? {
        step,
        total: trace.length,
        text: step !== null ? (trace[step]?.label ?? "") : "",
        playing,
        showPath,
        speeds: SPEEDS,
        speed,
        onStart: () => goto(0),
        onTogglePath: () => setShowPath((v) => !v),
        onBack: () => (setPlaying(false), goto((step ?? 1) - 1)),
        onNext: () => (setPlaying(false), goto((step ?? -1) + 1)),
        onPlay: () => {
          if (playing) setPlaying(false);
          else {
            if (step === null || step >= trace.length - 1) goto(0);
            setPlaying(true);
          }
        },
        onSpeed: setSpeed,
        onClose: end,
      }
    : null;

  return (
    <div className={`adx${className ? ` ${className}` : ""}`} style={wrapStyle}>
      <style>{EXPLORER_CSS}</style>

      {/* announced as the visitor steps; the bar's own text is not a live region, so it is not read twice */}
      <span className="adx-sr" role="status">
        {step !== null ? `Step ${step + 1} of ${trace.length}: ${trace[step]?.label}` : ""}
      </span>

      <ArchDiagram
        spec={spec}
        iconPack={iconPack}
        theme={theme}
        onThemeChange={onThemeChange}
        layers={layers}
        isolate={isolate}
        declutter={declutter}
        wheelZoom={wheelZoom}
        routing={routing}
        tracePath={trace.map((t) => t.node)}
        style={style}
        selected={selected}
        traceNode={traceNode}
        prevTraceNode={prevTraceNode}
        path={showPath ? trace.map((t) => t.node) : undefined}
        traceBar={traceBar}
        reducedMotion={reduced}
        onSelect={(id) => {
          setPlaying(false);
          setStep(null);
          setSelected(id);
        }}
      />

      {warnings.length > 0 && (
        <details className="adx-lint">
          <summary>
            {warnings.length} lint {warnings.length === 1 ? "warning" : "warnings"}
          </summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>
                {w.path}: {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {trace.length > 0 && (
        <div className="adx-trace">
          <h2>The full request path</h2>
          <ol>
            {trace.map((t, i) => (
              <li key={`${t.node}-${i}`}>
                <button
                  type="button"
                  aria-current={step === i ? "step" : undefined}
                  onClick={() => {
                    setPlaying(false);
                    goto(i);
                  }}
                >
                  {i + 1}. {t.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
