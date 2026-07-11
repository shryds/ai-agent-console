import { describe, it, expect } from "vitest";
import { reducer, createInitialState } from "./reducer";
import type { SessionState, AgentTurn } from "./types";
import type { ServerMessage } from "@/protocol/types";

let ts = 0;
function srv(state: SessionState, msg: ServerMessage): SessionState {
  ts += 100;
  return reducer(state, { type: "SERVER_MESSAGE", msg, ts });
}

function start(content = "hi"): SessionState {
  const s = createInitialState();
  return reducer(s, { type: "USER_SEND", content, turnId: "u1", agentTurnId: "a1" });
}

function activeTurn(state: SessionState): AgentTurn {
  const t = state.turns.find((x) => x.kind === "agent" && x.id === "a1");
  if (!t || t.kind !== "agent") throw new Error("no agent turn");
  return t;
}

describe("session reducer", () => {
  it("USER_SEND creates a user turn and an active agent turn", () => {
    const s = start("hello there");
    expect(s.turns).toHaveLength(2);
    expect(s.turns[0]).toMatchObject({ kind: "user", content: "hello there" });
    expect(s.activeAgentTurnId).toBe("a1");
  });

  it("appends consecutive tokens into a single text segment", () => {
    let s = start();
    s = srv(s, { type: "TOKEN", seq: 1, text: "Hello ", stream_id: "x" });
    s = srv(s, { type: "TOKEN", seq: 2, text: "world", stream_id: "x" });
    const turn = activeTurn(s);
    expect(turn.segments).toHaveLength(1);
    expect(turn.segments[0]).toMatchObject({ kind: "text", text: "Hello world", tokenCount: 2 });
  });

  it("groups consecutive tokens into one trace row", () => {
    let s = start();
    s = srv(s, { type: "TOKEN", seq: 1, text: "a", stream_id: "x" });
    s = srv(s, { type: "TOKEN", seq: 2, text: "b", stream_id: "x" });
    const groups = s.trace.filter((e) => e.kind === "TOKENS");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tokenCount).toBe(2);
    expect(groups[0]?.tokenText).toBe("ab");
  });

  it("a tool call freezes the current text run and opens a new run after the result", () => {
    let s = start();
    s = srv(s, { type: "TOKEN", seq: 1, text: "before ", stream_id: "x" });
    s = srv(s, {
      type: "TOOL_CALL",
      seq: 2,
      call_id: "tc_1",
      tool_name: "lookup",
      args: { q: 1 },
      stream_id: "x",
    });
    s = srv(s, {
      type: "TOOL_RESULT",
      seq: 3,
      call_id: "tc_1",
      result: { v: "ok" },
      stream_id: "x",
    });
    s = srv(s, { type: "TOKEN", seq: 4, text: "after", stream_id: "x" });

    const turn = activeTurn(s);
    // text(before, frozen) → tool → text(after)
    expect(turn.segments.map((x) => x.kind)).toEqual(["text", "tool", "text"]);
    const first = turn.segments[0];
    const tool = turn.segments[1];
    const second = turn.segments[2];
    expect(first?.kind === "text" && first.done).toBe(true);
    expect(tool?.kind === "tool" && tool.status).toBe("done");
    expect(tool?.kind === "tool" && tool.result).toEqual({ v: "ok" });
    expect(second?.kind === "text" && second.text).toBe("after");
    expect(second?.kind === "text" && second.done).toBe(false);
  });

  it("keeps a tool card in a pending/waiting state until its result arrives", () => {
    let s = start();
    s = srv(s, {
      type: "TOOL_CALL",
      seq: 1,
      call_id: "tc_9",
      tool_name: "search",
      args: {},
      stream_id: "x",
    });
    const tool = activeTurn(s).segments.find((x) => x.kind === "tool");
    expect(tool?.kind === "tool" && tool.status).toBe("pending");
  });

  it("routes TOOL_RESULT to the right card even after intervening tokens", () => {
    let s = start();
    s = srv(s, {
      type: "TOOL_CALL",
      seq: 1,
      call_id: "tc_2",
      tool_name: "t",
      args: {},
      stream_id: "x",
    });
    s = srv(s, { type: "TOKEN", seq: 2, text: "x", stream_id: "x" }); // (won't happen live, but must not misroute)
    s = srv(s, { type: "TOOL_RESULT", seq: 3, call_id: "tc_2", result: { ok: true }, stream_id: "x" });
    const tool = activeTurn(s).segments.find((x) => x.kind === "tool");
    expect(tool?.kind === "tool" && tool.status).toBe("done");
  });

  it("accumulates context snapshots per context_id for diffing/scrubbing", () => {
    let s = start("report");
    s = srv(s, { type: "CONTEXT_SNAPSHOT", seq: 1, context_id: "ctx_a", data: { pages: 47 } });
    s = srv(s, { type: "CONTEXT_SNAPSHOT", seq: 2, context_id: "ctx_a", data: { pages: 47, focus: "ops" } });
    expect(s.contexts["ctx_a"]?.snapshots).toHaveLength(2);
    expect(s.contextOrder).toEqual(["ctx_a"]);
  });

  it("STREAM_END completes the turn and clears the active pointer", () => {
    let s = start();
    s = srv(s, { type: "TOKEN", seq: 1, text: "done ", stream_id: "x" });
    s = srv(s, { type: "STREAM_END", seq: 2, stream_id: "x" });
    expect(activeTurn(s).status).toBe("complete");
    expect(s.activeAgentTurnId).toBeNull();
  });

  it("records an ERROR without crashing and surfaces it", () => {
    let s = start();
    s = srv(s, { type: "ERROR", seq: 1, code: "E_CHAOS", message: "boom" });
    expect(s.lastError).toEqual({ code: "E_CHAOS", message: "boom" });
    expect(s.trace.some((e) => e.kind === "ERROR")).toBe(true);
  });

  it("handles a corrupt PING (empty challenge) as a trace row, no throw", () => {
    let s = start();
    s = srv(s, { type: "PING", seq: 1, challenge: "" });
    const ping = s.trace.find((e) => e.kind === "PING");
    expect(ping?.label).toContain("corrupt");
  });
});
