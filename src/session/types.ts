import type { ConnStatus } from "@/connection/connectionMachine";
import type { JsonObject, ServerMessage } from "@/protocol/types";

// ─────────────────────────────────────────────────────────────────────────────
// Session view-model
//
// This is the shape the UI renders. It is derived purely by `reducer.ts` from an
// *already ordered and de-duplicated* stream of ServerMessages. The reducer never
// touches the socket, timers, or `Date.now()` — timestamps arrive on the action —
// which is what makes it a plain, exhaustively testable function.
// ─────────────────────────────────────────────────────────────────────────────

/** A run of streamed text. Its own stable DOM node so it can be frozen in
 *  place when a tool call interrupts the stream (see ARCHITECTURE.md). */
export interface TextSegment {
  kind: "text";
  id: string;
  text: string;
  firstSeq: number;
  lastSeq: number;
  tokenCount: number;
  /** Frozen: a tool call or STREAM_END closed this run; no more tokens append. */
  done: boolean;
}

export type ToolStatus = "pending" | "done";

export interface ToolSegment {
  kind: "tool";
  id: string;
  callId: string;
  toolName: string;
  args: JsonObject;
  callSeq: number;
  result: JsonObject | null;
  resultSeq: number | null;
  status: ToolStatus;
}

export type Segment = TextSegment | ToolSegment;

export interface UserTurn {
  kind: "user";
  id: string;
  content: string;
}

export interface AgentTurn {
  kind: "agent";
  id: string;
  streamId: string | null;
  segments: Segment[];
  status: "streaming" | "complete";
}

export type Turn = UserTurn | AgentTurn;

// ── Trace timeline ───────────────────────────────────────────────────────────

export type TraceKind =
  | "TOKENS"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "CONTEXT"
  | "PING"
  | "PONG"
  | "STREAM_END"
  | "ERROR"
  | "RESUME"
  | "MALFORMED";

export interface TraceEvent {
  id: string;
  kind: TraceKind;
  /** seq of the underlying server message; null for client-side events. */
  seq: number | null;
  tsStart: number;
  tsEnd: number;
  label: string;
  detail?: string;
  /** For bidirectional highlight with the chat panel. */
  segmentId?: string;
  callId?: string;
  // Token-group aggregation:
  tokenCount?: number;
  tokenText?: string;
  firstSeq?: number;
  lastSeq?: number;
}

// ── Context inspector ────────────────────────────────────────────────────────

export interface ContextSnapshotEntry {
  seq: number;
  ts: number;
  data: JsonObject;
  /** Approximate serialized size in bytes, for the "oversized" indicator. */
  bytes: number;
}

export interface ContextTrack {
  contextId: string;
  snapshots: ContextSnapshotEntry[];
}

// ── Telemetry (the "check the logs to confirm the drop happened" panel) ──────

export interface Telemetry {
  reconnects: number;
  duplicatesDropped: number;
  reordered: number;
  malformed: number;
  pongsSent: number;
  toolAcksSent: number;
  lastResumeSeq: number | null;
}

export interface Focus {
  segmentId: string | null;
  traceId: string | null;
  callId: string | null;
}

export interface SessionState {
  status: ConnStatus;
  turns: Turn[];
  activeAgentTurnId: string | null;
  trace: TraceEvent[];
  contexts: Record<string, ContextTrack>;
  contextOrder: string[];
  /** callId → where the tool card lives, for TOOL_RESULT routing + linking. */
  toolLocator: Record<string, { turnId: string; segmentId: string }>;
  focus: Focus;
  telemetry: Telemetry;
  lastError: { code: string; message: string } | null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type SessionAction =
  | { type: "CONNECTION_STATUS"; status: ConnStatus }
  | { type: "USER_SEND"; content: string; turnId: string; agentTurnId: string }
  | { type: "SERVER_MESSAGE"; msg: ServerMessage; ts: number }
  | { type: "PONG_SENT"; seq: number; challenge: string; ts: number }
  | { type: "RESUME_SENT"; lastSeq: number; ts: number }
  | { type: "TOOL_ACK_SENT" }
  | { type: "MALFORMED"; ts: number }
  | { type: "RECONNECTED" }
  | { type: "FOCUS"; focus: Focus }
  | { type: "CLEAR" };
