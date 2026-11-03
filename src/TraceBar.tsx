"use client";
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

/** What the trace bar shows and does. The host (ArchExplorer) owns the step state; the diagram only places the bar. */
export type TraceBarProps = {
  /** Zero-based step, or null while no trace is running (the bar then offers to start one). */
  step: number | null;
  total: number;
  text: string;
  playing: boolean;
  /** Whether the whole route is drawn as a still, numbered path. */
  showPath: boolean;
  /** Names of the autoplay speeds and which one is chosen. */
  speeds: string[];
  speed: number;
  onStart: () => void;
  onTogglePath: () => void;
  onBack: () => void;
  onNext: () => void;
  onPlay: () => void;
  onSpeed: (i: number) => void;
  onClose: () => void;
};

/**
 * The trace controls, in one place under the diagram. Idle: start a trace or show the still path. Running: the step's words and Back / Play / Next.
 * Stepping is manual; autoplay is optional and can be paused (WCAG 2.2.2). Left and right arrows step, Escape ends the trace.
 */
export function TraceBar({ step, total, text, playing, showPath, speeds, speed, onStart, onTogglePath, onBack, onNext, onPlay, onSpeed, onClose }: TraceBarProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // Focus follows the visitor's own action: starting moves it to Next, ending (from here) returns it to Start. A start or stop from elsewhere leaves focus alone.
  const moveFocus = useRef<"next" | "start" | null>(null);
  const tracing = step !== null;
  useEffect(() => {
    if (moveFocus.current === "next" && tracing) nextRef.current?.focus();
    if (moveFocus.current === "start" && !tracing) startRef.current?.focus();
    moveFocus.current = null;
  }, [tracing]);

  const close = () => {
    moveFocus.current = "start";
    onClose();
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (step === null || ev.target instanceof HTMLSelectElement) return; // the speed picker keeps its own arrow keys
    if (ev.key === "ArrowRight" && step < total - 1) onNext();
    else if (ev.key === "ArrowLeft" && step > 0) onBack();
    else if (ev.key === "Escape") close();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  const last = step !== null && step >= total - 1;
  return (
    <div className="adg-tracebar" role="group" aria-label="Request trace" onKeyDown={onKeyDown}>
      {step === null ? (
        <>
          <span className="adg-co-step">Trace</span>
          <button
            ref={startRef}
            type="button"
            className="adg-co-btn primary"
            onClick={() => {
              moveFocus.current = "next";
              onStart();
            }}
          >
            Start the trace
          </button>
          <button type="button" className="adg-co-btn" aria-pressed={showPath} onClick={onTogglePath}>
            {showPath ? "Hide the path" : "Show the path"}
          </button>
          <span className="adg-co-text dim">or pick a component</span>
        </>
      ) : (
        <>
          <span className="adg-co-step">
            Step {step + 1} of {total}
          </span>
          <span className="adg-co-text">{text}</span>
          <span className="adg-co-ctl">
            <button type="button" className="adg-co-btn" disabled={step === 0} onClick={onBack}>
              ‹ Back
            </button>
            <button type="button" className="adg-co-btn" aria-pressed={playing} onClick={onPlay} title={playing ? "Pause the autoplay" : last ? "Play again from step 1" : "Step through automatically"}>
              {playing ? "Pause" : last ? "Replay" : "Play"}
            </button>
            <button ref={nextRef} type="button" className="adg-co-btn primary" disabled={last} onClick={onNext}>
              Next ›
            </button>
            <select className="adg-co-speed" aria-label="Autoplay speed" value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
              {speeds.map((s, i) => (
                <option key={s} value={i}>
                  {s}
                </option>
              ))}
            </select>
            <button type="button" className="adg-co-btn" aria-pressed={showPath} onClick={onTogglePath} title="Number every step on its card and light the whole route">
              {showPath ? "Hide the path" : "Show the path"}
            </button>
            <button type="button" className="adg-co-btn adg-co-close" onClick={close} aria-label="End the trace" title="End the trace (Esc)">
              ✕
            </button>
          </span>
        </>
      )}
    </div>
  );
}
