"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AgentConnection } from "@/connection/AgentConnection";
import { ReorderBuffer, type ReorderStats } from "@/protocol/reorderBuffer";
import { WS_URL } from "@/lib/env";
import { createInitialState, reducer } from "./reducer";
import type { Focus, SessionState, Telemetry } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// useAgentSession — the single wiring point between transport, ordering, and UI.
//
//   AgentConnection ──raw msg──▶ ReorderBuffer ──ordered/deduped──▶ reducer ──▶ UI
//
// The connection and buffer are long-lived refs (they must survive re-renders);
// React state is derived only via `dispatch`. `Date.now()` is stamped here, at
// the edge, so the reducer stays pure.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentSession {
  state: SessionState;
  telemetry: Telemetry;
  sendMessage: (content: string) => void;
  setFocus: (focus: Focus) => void;
  clear: () => void;
  canSend: boolean;
}

export function useAgentSession(): AgentSession {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const connRef = useRef<AgentConnection | null>(null);
  const bufferRef = useRef<ReorderBuffer>(new ReorderBuffer());
  const turnCounter = useRef(0);
  const [bufferStats, setBufferStats] = useState<ReorderStats>(() => bufferRef.current.stats());

  useEffect(() => {
    const buffer = bufferRef.current;

    const conn = new AgentConnection({
      url: WS_URL,
      getResumeSeq: () => buffer.getLastReleasedSeq(),
      onStatusChange: (status) => dispatch({ type: "CONNECTION_STATUS", status }),
      onMessage: (msg) => {
        // Ordering + dedup happens here, before anything reaches the reducer.
        const released = buffer.push(msg);
        for (const m of released) {
          dispatch({ type: "SERVER_MESSAGE", msg: m, ts: Date.now() });
          if (m.type === "TOOL_CALL") {
            // ACK the moment the card is committed to render, in seq order.
            conn.sendToolAck(m.call_id);
            dispatch({ type: "TOOL_ACK_SENT" });
          }
        }
        setBufferStats(buffer.stats());
      },
      onPong: ({ seq, challenge }) =>
        dispatch({ type: "PONG_SENT", seq, challenge, ts: Date.now() }),
      onResumeSent: (lastSeq) => dispatch({ type: "RESUME_SENT", lastSeq, ts: Date.now() }),
      onMalformed: () => dispatch({ type: "MALFORMED", ts: Date.now() }),
    });

    connRef.current = conn;
    conn.connect();

    return () => {
      conn.close();
      connRef.current = null;
    };
  }, []);

  const sendMessage = useCallback((content: string) => {
    const conn = connRef.current;
    const trimmed = content.trim();
    if (!conn || trimmed.length === 0) return;

    // New turn: the server zeroes its seq counter, so we zero ours.
    bufferRef.current.reset();
    setBufferStats(bufferRef.current.stats());

    turnCounter.current += 1;
    const n = turnCounter.current;
    dispatch({ type: "USER_SEND", content: trimmed, turnId: `u${n}`, agentTurnId: `a${n}` });
    conn.sendUserMessage(trimmed);
  }, []);

  const setFocus = useCallback((focus: Focus) => dispatch({ type: "FOCUS", focus }), []);
  const clear = useCallback(() => {
    bufferRef.current.reset();
    dispatch({ type: "CLEAR" });
  }, []);

  // Merge reducer-owned counters with buffer-owned ordering stats.
  const telemetry = useMemo<Telemetry>(
    () => ({
      ...state.telemetry,
      duplicatesDropped: bufferStats.duplicatesDropped,
      reordered: bufferStats.bufferedOutOfOrder,
    }),
    [state.telemetry, bufferStats],
  );

  return {
    state,
    telemetry,
    sendMessage,
    setFocus,
    clear,
    canSend: state.status === "open",
  };
}
