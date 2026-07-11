import type {
  AgentTurn,
  Segment,
  SessionAction,
  SessionState,
  TextSegment,
  ToolSegment,
  TraceEvent,
  Turn,
} from "./types";
import type { ServerMessage } from "@/protocol/types";


let idCounter = 0;
function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createInitialState(): SessionState {
  return {
    status: "idle",
    turns: [],
    activeAgentTurnId: null,
    trace: [],
    contexts: {},
    contextOrder: [],
    toolLocator: {},
    focus: { segmentId: null, traceId: null, callId: null },
    telemetry: {
      reconnects: 0,
      duplicatesDropped: 0,
      reordered: 0,
      malformed: 0,
      pongsSent: 0,
      toolAcksSent: 0,
      lastResumeSeq: null,
    },
    lastError: null,
  };
}

let epoch = 0;

export function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "CONNECTION_STATUS":
      if (action.status === state.status) return state;
      return { ...state, status: action.status };

    case "USER_SEND": {
      epoch += 1;
      const turns = finalizeActiveTurn(state.turns, state.activeAgentTurnId);
      const userTurn: Turn = { kind: "user", id: action.turnId, content: action.content };
      const agentTurn: AgentTurn = {
        kind: "agent",
        id: action.agentTurnId,
        streamId: null,
        segments: [],
        status: "streaming",
      };
      return {
        ...state,
        turns: [...turns, userTurn, agentTurn],
        activeAgentTurnId: agentTurn.id,
        lastError: null,
      };
    }

    case "SERVER_MESSAGE":
      return applyServerMessage(state, action.msg, action.ts);

    case "PONG_SENT":
      return {
        ...state,
        telemetry: { ...state.telemetry, pongsSent: state.telemetry.pongsSent + 1 },
        trace: appendTrace(state.trace, {
          id: `${epoch}:pong:${action.seq}`,
          kind: "PONG",
          seq: action.seq,
          tsStart: action.ts,
          tsEnd: action.ts,
          label: `PONG → ${action.challenge === "" ? "∅ (corrupt challenge echoed)" : action.challenge}`,
        }),
      };

    case "RESUME_SENT":
      return {
        ...state,
        telemetry: {
          ...state.telemetry,
          reconnects: state.telemetry.reconnects + 1,
          lastResumeSeq: action.lastSeq,
        },
        trace: appendTrace(state.trace, {
          id: `${epoch}:resume:${action.lastSeq}:${action.ts}`,
          kind: "RESUME",
          seq: null,
          tsStart: action.ts,
          tsEnd: action.ts,
          label: `RESUME from seq ${action.lastSeq}`,
          detail: "First frame on the reconnected socket; server replays everything after this seq.",
        }),
      };

    case "TOOL_ACK_SENT":
      return {
        ...state,
        telemetry: { ...state.telemetry, toolAcksSent: state.telemetry.toolAcksSent + 1 },
      };

    case "MALFORMED":
      return {
        ...state,
        telemetry: { ...state.telemetry, malformed: state.telemetry.malformed + 1 },
        trace: appendTrace(state.trace, {
          id: `${epoch}:malformed:${action.ts}`,
          kind: "MALFORMED",
          seq: null,
          tsStart: action.ts,
          tsEnd: action.ts,
          label: "Malformed frame dropped",
        }),
      };

    case "FOCUS":
      return { ...state, focus: action.focus };

    case "CLEAR":
      return { ...createInitialState(), status: state.status };

    default:
      return state;
  }
}

//server message 

function applyServerMessage(state: SessionState, msg: ServerMessage, ts: number): SessionState {
  switch (msg.type) {
    case "TOKEN":
      return applyToken(state, msg.seq, msg.text, msg.stream_id, ts);
    case "TOOL_CALL":
      return applyToolCall(state, msg, ts);
    case "TOOL_RESULT":
      return applyToolResult(state, msg, ts);
    case "CONTEXT_SNAPSHOT":
      return applyContext(state, msg, ts);
    case "STREAM_END":
      return applyStreamEnd(state, msg.seq, ts);
    case "PING":
      return {
        ...state,
        trace: appendTrace(state.trace, {
          id: `${epoch}:ping:${msg.seq}`,
          kind: "PING",
          seq: msg.seq,
          tsStart: ts,
          tsEnd: ts,
          label: `PING ${msg.challenge === "" ? "∅ (corrupt: empty challenge)" : msg.challenge}`,
        }),
      };
    case "ERROR":
      return {
        ...state,
        lastError: { code: msg.code, message: msg.message },
        trace: appendTrace(state.trace, {
          id: `${epoch}:err:${msg.seq}`,
          kind: "ERROR",
          seq: msg.seq,
          tsStart: ts,
          tsEnd: ts,
          label: `ERROR ${msg.code}`,
          detail: msg.message,
        }),
      };
    default:
      return state;
  }
}

//Token handling

function applyToken(
  state: SessionState,
  seq: number,
  text: string,
  streamId: string,
  ts: number,
): SessionState {
  return withActiveTurn(state, (turn) => {
    const last = turn.segments[turn.segments.length - 1];
    let segments: Segment[];
    let segmentId: string;

    if (last && last.kind === "text" && !last.done) {
      const updated: TextSegment = {
        ...last,
        text: last.text + text,
        lastSeq: seq,
        tokenCount: last.tokenCount + 1,
      };
      segments = [...turn.segments.slice(0, -1), updated];
      segmentId = updated.id;
    } else {
      const created: TextSegment = {
        kind: "text",
        id: `${turn.id}:s${turn.segments.length}`,
        text,
        firstSeq: seq,
        lastSeq: seq,
        tokenCount: 1,
        done: false,
      };
      segments = [...turn.segments, created];
      segmentId = created.id;
    }

    return {
      turn: { ...turn, streamId: turn.streamId ?? streamId, segments },
      trace: extendOrOpenTokenGroup(state.trace, seq, text, segmentId, ts),
    };
  });
}

function extendOrOpenTokenGroup(
  trace: TraceEvent[],
  seq: number,
  text: string,
  segmentId: string,
  ts: number,
): TraceEvent[] {
  const last = trace[trace.length - 1];
  if (last && last.kind === "TOKENS" && last.segmentId === segmentId) {
    const updated: TraceEvent = {
      ...last,
      tsEnd: ts,
      lastSeq: seq,
      tokenCount: (last.tokenCount ?? 0) + 1,
      tokenText: (last.tokenText ?? "") + text,
      label: `Streamed ${(last.tokenCount ?? 0) + 1} tokens`,
    };
    return [...trace.slice(0, -1), updated];
  }
  return appendTrace(trace, {
    id: `${epoch}:tg:${seq}`,
    kind: "TOKENS",
    seq,
    tsStart: ts,
    tsEnd: ts,
    label: "Streamed 1 token",
    segmentId,
    tokenCount: 1,
    tokenText: text,
    firstSeq: seq,
    lastSeq: seq,
  });
}

//Tool call

function applyToolCall(
  state: SessionState,
  msg: Extract<ServerMessage, { type: "TOOL_CALL" }>,
  ts: number,
): SessionState {
  const activeId = state.activeAgentTurnId;
  if (activeId === null) return state;

  const toolSegId = `${activeId}:tool:${msg.call_id}`;
  const next = withActiveTurn(state, (turn) => {
    const segments = closeOpenText(turn.segments);
    if (turn.segments.some((s) => s.kind === "tool" && s.callId === msg.call_id)) {
      return { turn, trace: state.trace };
    }
    const tool: ToolSegment = {
      kind: "tool",
      id: toolSegId,
      callId: msg.call_id,
      toolName: msg.tool_name,
      args: msg.args,
      callSeq: msg.seq,
      result: null,
      resultSeq: null,
      status: "pending",
    };
    return {
      turn: { ...turn, segments: [...segments, tool] },
      trace: appendTrace(state.trace, {
        id: `${epoch}:tc:${msg.seq}`,
        kind: "TOOL_CALL",
        seq: msg.seq,
        tsStart: ts,
        tsEnd: ts,
        label: `TOOL_CALL ${msg.tool_name}`,
        detail: JSON.stringify(msg.args),
        segmentId: toolSegId,
        callId: msg.call_id,
      }),
    };
  });

  return {
    ...next,
    toolLocator: {
      ...next.toolLocator,
      [msg.call_id]: { turnId: activeId, segmentId: toolSegId },
    },
  };
}

function applyToolResult(
  state: SessionState,
  msg: Extract<ServerMessage, { type: "TOOL_RESULT" }>,
  ts: number,
): SessionState {
  const loc = state.toolLocator[msg.call_id];
  const trace = appendTrace(state.trace, {
    id: `${epoch}:tr:${msg.seq}`,
    kind: "TOOL_RESULT",
    seq: msg.seq,
    tsStart: ts,
    tsEnd: ts,
    label: `TOOL_RESULT ${msg.call_id}`,
    detail: JSON.stringify(msg.result),
    segmentId: loc?.segmentId,
    callId: msg.call_id,
  });

  if (!loc) {
    return { ...state, trace };
  }

  const turns = state.turns.map((turn) => {
    if (turn.kind !== "agent" || turn.id !== loc.turnId) return turn;
    return {
      ...turn,
      segments: turn.segments.map((seg) => {
        if (seg.kind !== "tool" || seg.callId !== msg.call_id) return seg;
        return { ...seg, result: msg.result, resultSeq: msg.seq, status: "done" as const };
      }),
    };
  });

  return { ...state, turns, trace };
}

//Context snapshots

function applyContext(
  state: SessionState,
  msg: Extract<ServerMessage, { type: "CONTEXT_SNAPSHOT" }>,
  ts: number,
): SessionState {
  const bytes = approximateBytes(msg.data);
  const existing = state.contexts[msg.context_id];
  const entry = { seq: msg.seq, ts, data: msg.data, bytes };

  const contexts = {
    ...state.contexts,
    [msg.context_id]: existing
      ? { ...existing, snapshots: [...existing.snapshots, entry] }
      : { contextId: msg.context_id, snapshots: [entry] },
  };
  const contextOrder = existing ? state.contextOrder : [...state.contextOrder, msg.context_id];

  return {
    ...state,
    contexts,
    contextOrder,
    trace: appendTrace(state.trace, {
      id: `${epoch}:ctx:${msg.seq}`,
      kind: "CONTEXT",
      seq: msg.seq,
      tsStart: ts,
      tsEnd: ts,
      label: `CONTEXT ${msg.context_id}`,
      detail: `${(bytes / 1024).toFixed(1)} KB`,
    }),
  };
}

function applyStreamEnd(state: SessionState, seq: number, ts: number): SessionState {
  const withEnd = withActiveTurn(state, (turn) => ({
    turn: { ...turn, segments: closeOpenText(turn.segments), status: "complete" as const },
    trace: appendTrace(state.trace, {
      id: `${epoch}:end:${seq}`,
      kind: "STREAM_END",
      seq,
      tsStart: ts,
      tsEnd: ts,
      label: "STREAM_END",
    }),
  }));
  return { ...withEnd, activeAgentTurnId: null };
}

//Small helpers

function withActiveTurn(
  state: SessionState,
  fn: (turn: AgentTurn) => { turn: AgentTurn; trace: TraceEvent[] },
): SessionState {
  const activeId = state.activeAgentTurnId;
  if (activeId === null) return state;
  let changed = false;
  let nextTrace = state.trace;
  const turns = state.turns.map((turn) => {
    if (turn.kind !== "agent" || turn.id !== activeId) return turn;
    const result = fn(turn);
    nextTrace = result.trace;
    changed = true;
    return result.turn;
  });
  if (!changed) return state;
  return { ...state, turns, trace: nextTrace };
}

function closeOpenText(segments: Segment[]): Segment[] {
  const last = segments[segments.length - 1];
  if (last && last.kind === "text" && !last.done) {
    return [...segments.slice(0, -1), { ...last, done: true }];
  }
  return segments;
}

function finalizeActiveTurn(turns: Turn[], activeId: string | null): Turn[] {
  if (activeId === null) return turns;
  return turns.map((turn) => {
    if (turn.kind !== "agent" || turn.id !== activeId) return turn;
    return { ...turn, segments: closeOpenText(turn.segments), status: "complete" as const };
  });
}

function appendTrace(trace: TraceEvent[], event: TraceEvent): TraceEvent[] {
  return [...trace, event];
}

function approximateBytes(data: unknown): number {
  try {
    return JSON.stringify(data).length;
  } catch {
    return 0;
  }
}
