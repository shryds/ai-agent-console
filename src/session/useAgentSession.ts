"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AgentConnection } from "@/connection/AgentConnection";
import { GapWatchdog } from "@/protocol/gapWatchdog";
import { ReorderBuffer, type ReorderStats } from "@/protocol/reorderBuffer";
import type { ServerMessage } from "@/protocol/types";
import { WS_URL } from "@/lib/env";
import { createInitialState, reducer } from "./reducer";
import type { Focus, SessionState, Telemetry } from "./types";


export interface AgentSession {
  state: SessionState;
  telemetry: Telemetry;
  bufferStats: ReorderStats;
  sendMessage: (content: string) => void;
  setFocus: (focus: Focus) => void;
  clear: () => void;
  reconnect: () => void;
  canSend: boolean;
  busy: boolean;
}

const GAP_STALL_MS = 8000;

export function useAgentSession(): AgentSession {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const connRef = useRef<AgentConnection | null>(null);
  const bufferRef = useRef<ReorderBuffer>(new ReorderBuffer());
  const watchdogRef = useRef<GapWatchdog | null>(null);
  const turnCounter = useRef(0);
  const [bufferStats, setBufferStats] = useState<ReorderStats>(() => bufferRef.current.stats());

  useEffect(() => {
    const buffer = bufferRef.current;

    const deliver = (released: ServerMessage[]) => {
      for (const m of released) {
        dispatch({ type: "SERVER_MESSAGE", msg: m, ts: Date.now() });
        if (m.type === "TOOL_CALL") {
          connRef.current?.sendToolAck(m.call_id);
          dispatch({ type: "TOOL_ACK_SENT" });
        }
      }
    };

    const syncBufferState = () => {
      const stats = buffer.stats();
      setBufferStats(stats);
      watchdogRef.current?.update(stats);
    };

    const watchdog = new GapWatchdog({
      stallMs: GAP_STALL_MS,
      maxRecoveries: 1,
      onRecover: (missingSeq, heldSeqs) => {
        dispatch({
          type: "BUFFER_EVENT",
          info: { kind: "stalled", missingSeq, heldSeqs, waitedMs: GAP_STALL_MS },
          ts: Date.now(),
        });
        connRef.current?.requestGapRecovery();
      },
      onSkip: () => {
        const { skippedSeqs, released } = buffer.skipGap();
        dispatch({
          type: "BUFFER_EVENT",
          info: { kind: "skipped", skippedSeqs, releasedSeqs: released.map((m) => m.seq) },
          ts: Date.now(),
        });
        deliver(released);
        syncBufferState();
      },
    });
    watchdogRef.current = watchdog;

    const conn = new AgentConnection({
      url: WS_URL,
      getResumeSeq: () => buffer.getLastReleasedSeq(),
      onStatusChange: (status) => dispatch({ type: "CONNECTION_STATUS", status }),
      onMessage: (msg) => {
        const { released, event } = buffer.push(msg);
        if (event.kind !== "released") {
          dispatch({ type: "BUFFER_EVENT", info: event, ts: Date.now() });
        }

        deliver(released);
        syncBufferState();
      },
      onPong: ({ seq, challenge }) =>
        dispatch({ type: "PONG_SENT", seq, challenge, ts: Date.now() }),
      onResumeSent: (lastSeq) => dispatch({ type: "RESUME_SENT", lastSeq, ts: Date.now() }),
      onDrop: ({ reason }) => dispatch({ type: "DISCONNECTED", ts: Date.now(), reason }),
      onServerClose: (_code, reason) =>
        dispatch({ type: "DISCONNECTED", ts: Date.now(), terminal: true, reason }),
      onMalformed: () => dispatch({ type: "MALFORMED", ts: Date.now() }),
    });

    connRef.current = conn;
    conn.connect();

    return () => {
      watchdog.dispose();
      watchdogRef.current = null;
      conn.close();
      connRef.current = null;
    };
  }, []);

  const busy = state.activeAgentTurnId !== null && state.status !== "closed";
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const sendMessage = useCallback((content: string) => {
    const conn = connRef.current;
    const trimmed = content.trim();
    if (!conn || trimmed.length === 0) return;
    if (busyRef.current) return;
    bufferRef.current.reset();
    watchdogRef.current?.reset();
    setBufferStats(bufferRef.current.stats());

    turnCounter.current += 1;
    const n = turnCounter.current;
    dispatch({ type: "USER_SEND", content: trimmed, turnId: `u${n}`, agentTurnId: `a${n}` });
    conn.sendUserMessage(trimmed);
  }, []);

  const setFocus = useCallback((focus: Focus) => dispatch({ type: "FOCUS", focus }), []);
  const reconnect = useCallback(() => connRef.current?.connect(), []);
  const clear = useCallback(() => {
    bufferRef.current.reset();
    watchdogRef.current?.reset();
    setBufferStats(bufferRef.current.stats());
    dispatch({ type: "CLEAR" });
  }, []);

  const telemetry = useMemo<Telemetry>(
    () => ({
      ...state.telemetry,
      duplicatesDropped: bufferStats.duplicatesDropped,
      reordered: bufferStats.bufferedOutOfOrder,
      pendingInBuffer: bufferStats.pending,
      seqsSkipped: bufferStats.seqsSkipped,
    }),
    [state.telemetry, bufferStats],
  );

  return {
    state,
    telemetry,
    bufferStats,
    sendMessage,
    setFocus,
    clear,
    reconnect,
    canSend: state.status === "open",
    busy,
  };
}
