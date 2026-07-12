"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContextTrack } from "@/session/types";
import { diffNode, summarizeDiff } from "@/protocol/diff";
import { cx } from "@/lib/classNames";
import { JsonTree } from "./JsonTree";
import { DiffTreeView } from "./DiffTreeView";
import styles from "./ContextInspector.module.css";

const OVERSIZE_BYTES = 500 * 1024;

export function ContextInspector({
  contexts,
  contextOrder,
}: {
  contexts: Record<string, ContextTrack>;
  contextOrder: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [index, setIndex] = useState<number>(0);
  const [mode, setMode] = useState<"diff" | "raw">("diff");

  // Keep the selection valid as new contexts arrive; default to the newest.
  const effectiveId =
    selectedId && contexts[selectedId] ? selectedId : contextOrder[contextOrder.length - 1] ?? null;
  const track = effectiveId ? contexts[effectiveId] : undefined;
  const count = track?.snapshots.length ?? 0;

  // When the selected track grows, follow the latest snapshot.
  useEffect(() => {
    if (count > 0) setIndex(count - 1);
  }, [count, effectiveId]);

  const current = track?.snapshots[Math.min(index, count - 1)];
  const previous = index > 0 ? track?.snapshots[index - 1] : undefined;

  const diff = useMemo(() => {
    if (!current || !previous) return null;
    return diffNode(previous.data, current.data);
  }, [current, previous]);

  const summary = useMemo(() => (diff ? summarizeDiff(diff) : null), [diff]);

  if (contextOrder.length === 0 || !track || !current) {
    return <div className={styles.empty}>No context snapshots yet. Try the “Report” or “Large ctx” prompt.</div>;
  }

  const oversized = current.bytes > OVERSIZE_BYTES;

  return (
    <div className={styles.root}>
      <div className={styles.contextTabs}>
        {contextOrder.map((id) => (
          <button
            key={id}
            className={cx(styles.ctxTab, id === effectiveId && styles.ctxTabActive)}
            onClick={() => {
              setSelectedId(id);
              const c = contexts[id]?.snapshots.length ?? 1;
              setIndex(c - 1);
            }}
          >
            {id}
            <span className={styles.ctxCount}>{contexts[id]?.snapshots.length ?? 0}</span>
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <div className={styles.scrubber}>
          <button
            className={styles.stepBtn}
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            ◀
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, count - 1)}
            value={Math.min(index, count - 1)}
            onChange={(e) => setIndex(Number(e.target.value))}
            className={styles.range}
          />
          <button
            className={styles.stepBtn}
            disabled={index >= count - 1}
            onClick={() => setIndex((i) => Math.min(count - 1, i + 1))}
          >
            ▶
          </button>
        </div>
        <div className={styles.meta}>
          <span>
            snapshot {Math.min(index, count - 1) + 1}/{count}
          </span>
          <span>seq #{current.seq}</span>
          <span className={cx(oversized && styles.oversized)}>
            {(current.bytes / 1024).toFixed(1)} KB{oversized ? " ⚠ oversized" : ""}
          </span>
        </div>
      </div>

      <div className={styles.modeRow}>
        <button
          className={cx(styles.modeBtn, mode === "diff" && styles.modeActive)}
          onClick={() => setMode("diff")}
          disabled={!previous}
          title={previous ? "Show diff vs previous snapshot" : "No previous snapshot to diff against"}
        >
          Diff
        </button>
        <button
          className={cx(styles.modeBtn, mode === "raw" && styles.modeActive)}
          onClick={() => setMode("raw")}
        >
          Raw
        </button>
        {summary && mode === "diff" && (
          <div className={styles.summary}>
            <span className={styles.added}>+{summary.added}</span>
            <span className={styles.removed}>-{summary.removed}</span>
            <span className={styles.changed}>~{summary.changed}</span>
          </div>
        )}
      </div>

      <div className={styles.viewer}>
        {mode === "diff" && diff ? (
          <DiffTreeView node={diff} rootLabel={effectiveId ?? "context"} />
        ) : (
          <JsonTree
            // Remount on snapshot change so lazy-expand state resets cleanly.
            key={`${effectiveId}:${current.seq}:${index}`}
            value={current.data}
            rootLabel={effectiveId ?? "context"}
            defaultExpandDepth={oversized ? 1 : 2}
          />
        )}
      </div>
    </div>
  );
}
