"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Focus, TraceEvent, TraceKind } from "@/session/types";
import type { ReorderStats } from "@/protocol/reorderBuffer";
import { cx } from "@/lib/classNames";
import styles from "./TraceTimeline.module.css";

const ALL_KINDS: TraceKind[] = [
  "TOKENS",
  "TOOL_CALL",
  "TOOL_RESULT",
  "CONTEXT",
  "BUFFER",
  "PING",
  "PONG",
  "STREAM_END",
  "ERROR",
  "DROP",
  "RESUME",
  "MALFORMED",
];

const KIND_META: Record<TraceKind, { short: string; className: string }> = {
  TOKENS: { short: "TOK", className: "tokens" },
  TOOL_CALL: { short: "CALL", className: "call" },
  TOOL_RESULT: { short: "RSLT", className: "result" },
  CONTEXT: { short: "CTX", className: "context" },
  BUFFER: { short: "BUF", className: "buffer" },
  PING: { short: "PING", className: "ping" },
  PONG: { short: "PONG", className: "pong" },
  STREAM_END: { short: "END", className: "end" },
  ERROR: { short: "ERR", className: "error" },
  DROP: { short: "DROP", className: "drop" },
  RESUME: { short: "RSME", className: "resume" },
  MALFORMED: { short: "BAD", className: "malformed" },
};

/** Details longer than this get an expand toggle instead of being ellipsized away. */
const DETAIL_EXPAND_THRESHOLD = 48;

export function TraceTimeline({
  trace,
  focus,
  onFocus,
  bufferStats,
}: {
  trace: TraceEvent[];
  focus: Focus;
  onFocus: (focus: Focus) => void;
  bufferStats?: ReorderStats;
}) {
  const [hidden, setHidden] = useState<Set<TraceKind>>(() => new Set());
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trace.filter((e) => {
      if (hidden.has(e.kind)) return false;
      if (q.length === 0) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        (e.detail?.toLowerCase().includes(q) ?? false) ||
        (e.tokenText?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [trace, hidden, query]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    if (stick.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const match = focus.traceId
      ? el.querySelector<HTMLElement>(`[data-traceid="${focus.traceId}"]`)
      : focus.segmentId
        ? el.querySelector<HTMLElement>(`[data-segref="${focus.segmentId}"]`)
        : focus.callId
          ? el.querySelector<HTMLElement>(`[data-callref="${focus.callId}"]`)
          : null;
    match?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const toggleKind = (kind: TraceKind) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const holding = bufferStats && bufferStats.pending > 0;

  return (
    <div className={styles.root}>
      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder="Filter events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.kindRow}>
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              className={cx(styles.kindChip, styles[KIND_META[k].className], hidden.has(k) && styles.off)}
              onClick={() => toggleKind(k)}
              title={hidden.has(k) ? `Show ${k}` : `Hide ${k}`}
            >
              {KIND_META[k].short}
            </button>
          ))}
        </div>
      </div>

      {holding && bufferStats && (
        <div className={styles.bufferStrip} role="status">
          <span className={styles.bufferDot} />
          Reorder buffer holding{" "}
          <strong>{bufferStats.pendingSeqs.map((s) => `#${s}`).join(", ")}</strong> — waiting for{" "}
          <strong>#{bufferStats.nextExpectedSeq}</strong>
        </div>
      )}

      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>No events yet.</div>
        ) : (
          filtered.map((e) => (
            <TraceRow
              key={e.id}
              event={e}
              focused={isFocused(e, focus)}
              expanded={expanded.has(e.id)}
              onToggleExpand={() => toggleExpand(e.id)}
              onSelect={() =>
                onFocus({
                  segmentId: e.segmentId ?? null,
                  traceId: e.id,
                  callId: e.callId ?? null,
                })
              }
            />
          ))
        )}
      </div>
      <div className={styles.footer}>
        {filtered.length} / {trace.length} events
        {bufferStats && (
          <span className={styles.footerBuffer}>
            {" · "}buffer: {bufferStats.pending} pending · {bufferStats.duplicatesDropped} dup dropped
          </span>
        )}
      </div>
    </div>
  );
}

function isFocused(e: TraceEvent, focus: Focus): boolean {
  if (focus.traceId && focus.traceId === e.id) return true;

  if (!focus.traceId) {
    if (focus.callId && e.callId === focus.callId) return true;
    if (focus.segmentId && e.segmentId === focus.segmentId) return true;
  } else if (focus.callId && e.callId === focus.callId) {
    return true;
  }
  return false;
}

/** Pretty-print JSON details when expanded; fall back to the raw string. */
function formatDetail(detail: string): string {
  const trimmed = detail.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return detail;
    }
  }
  return detail;
}

const TraceRow = memo(function TraceRow({
  event,
  focused,
  expanded,
  onToggleExpand,
  onSelect,
}: {
  event: TraceEvent;
  focused: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
}) {
  const meta = KIND_META[event.kind];
  const isTokens = event.kind === "TOKENS";
  const duration = event.tsEnd - event.tsStart;

  // Long details (tool args, tool results, error payloads…) get cut off by the
  // single-line ellipsis, so they become expandable just like the token group.
  const expandableDetail =
    !isTokens && event.detail !== undefined && event.detail.length > DETAIL_EXPAND_THRESHOLD;

  return (
    <div
      className={cx(
        styles.row,
        focused && styles.rowFocused,
        event.kind === "TOOL_RESULT" && styles.indented,
      )}
      data-traceid={event.id}
      data-segref={event.segmentId ?? undefined}
      data-callref={event.callId ?? undefined}
      onClick={onSelect}
    >
      <span className={cx(styles.tag, styles[meta.className])}>{meta.short}</span>
      <span className={styles.seq}>{event.seq !== null ? `#${event.seq}` : "·"}</span>
      <div className={styles.main}>
        <div className={styles.label}>
          {isTokens ? (
            <button
              className={styles.expandBtn}
              onClick={(ev) => {
                ev.stopPropagation();
                onToggleExpand();
              }}
            >
              {expanded ? "▾" : "▸"} Streamed {event.tokenCount} tokens ({(duration / 1000).toFixed(1)}s)
            </button>
          ) : expandableDetail ? (
            <button
              className={styles.expandBtn}
              onClick={(ev) => {
                ev.stopPropagation();
                onToggleExpand();
              }}
              title={expanded ? "Collapse detail" : "Expand detail"}
            >
              {expanded ? "▾" : "▸"} {event.label}
            </button>
          ) : (
            event.label
          )}
        </div>
        {isTokens && expanded && <div className={styles.tokenText}>{event.tokenText}</div>}
        {!isTokens &&
          event.detail &&
          (expandableDetail && expanded ? (
            <pre className={styles.detailExpanded}>{formatDetail(event.detail)}</pre>
          ) : (
            <div className={styles.detail}>{event.detail}</div>
          ))}
      </div>
    </div>
  );
});
