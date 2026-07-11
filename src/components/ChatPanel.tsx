"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Focus, SessionState } from "@/session/types";
import { MessageTurn } from "./MessageTurn";
import styles from "./ChatPanel.module.css";

export function ChatPanel({
  state,
  onFocus,
}: {
  state: SessionState;
  onFocus: (focus: Focus) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useLayoutEffect(() => {
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.turns]);

  useEffect(() => {
    const segId = state.focus.segmentId;
    if (!segId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-segid="${cssEscape(segId)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.focus]);

  return (
    <div className={styles.root}>
      {state.lastError && (
        <div className={styles.errorBanner}>
          <strong>{state.lastError.code}</strong> — {state.lastError.message}
        </div>
      )}
      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
        {state.turns.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>Agent Console</div>
            <p>
              Connected to the mock agent over WebSocket. Send a message — or use a suggestion
              chip below — to stream a response. Every protocol event shows up live in the Trace
              tab; context snapshots and their diffs show up in the Context tab.
            </p>
          </div>
        ) : (
          state.turns.map((turn) => (
            <MessageTurn
              key={turn.id}
              turn={turn}
              focusSegmentId={state.focus.segmentId}
              onFocus={onFocus}
            />
          ))
        )}
      </div>
    </div>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
