export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

//Server to Client 
export interface TokenMessage {
  type: "TOKEN";
  seq: number;
  text: string;
  stream_id: string;
}

export interface ToolCallMessage {
  type: "TOOL_CALL";
  seq: number;
  call_id: string;
  tool_name: string;
  args: JsonObject;
  stream_id: string;
}

export interface ToolResultMessage {
  type: "TOOL_RESULT";
  seq: number;
  call_id: string;
  result: JsonObject;
  stream_id: string;
}

export interface ContextSnapshotMessage {
  type: "CONTEXT_SNAPSHOT";
  seq: number;
  context_id: string;
  data: JsonObject;
}

export interface PingMessage {
  type: "PING";
  seq: number;
  challenge: string;
}

export interface StreamEndMessage {
  type: "STREAM_END";
  seq: number;
  stream_id: string;
}

export interface ErrorMessage {
  type: "ERROR";
  seq: number;
  code: string;
  message: string;
}

export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ErrorMessage;

export type ServerMessageType = ServerMessage["type"];

//Client to Server 

export interface UserMessagePayload {
  type: "USER_MESSAGE";
  content: string;
}

export interface PongPayload {
  type: "PONG";
  echo: string;
}

export interface ResumePayload {
  type: "RESUME";
  last_seq: number;
}

export interface ToolAckPayload {
  type: "TOOL_ACK";
  call_id: string;
}

export type ClientMessage =
  | UserMessagePayload
  | PongPayload
  | ResumePayload
  | ToolAckPayload;

//parsing and validation

const SERVER_MESSAGE_TYPES = new Set<ServerMessageType>([
  "TOKEN",
  "TOOL_CALL",
  "TOOL_RESULT",
  "CONTEXT_SNAPSHOT",
  "PING",
  "STREAM_END",
  "ERROR",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const { type } = value;
  if (typeof type !== "string" || !SERVER_MESSAGE_TYPES.has(type as ServerMessageType)) {
    return null;
  }
  if (typeof value.seq !== "number" || !Number.isFinite(value.seq)) {
    return null;
  }

  return value as unknown as ServerMessage;
}
