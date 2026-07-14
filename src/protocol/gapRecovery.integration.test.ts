import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { AgentConnection } from "../connection/AgentConnection";
import { ReorderBuffer } from "./reorderBuffer";
import { GapWatchdog } from "./gapWatchdog";
import type { ServerMessage } from "./types";

const STALL_MS = 1500;

interface MockOpts {
  loseSeq: number;
  replayHasLostMessage: boolean;
}

function startLossyServer(opts: MockOpts): Promise<{ port: number; resumes: number[]; stop: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0 });
  const resumes: number[] = [];
  const TOTAL = 6; 

  const frame = (seq: number): Record<string, unknown> =>
    seq === TOTAL
      ? { type: "STREAM_END", seq, stream_id: "s_1" }
      : { type: "TOKEN", seq, text: `t${seq} `, stream_id: "s_1" };

  wss.on("connection", (socket: ServerSocket) => {
    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };
    socket.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "USER_MESSAGE") {
        for (let seq = 1; seq <= TOTAL; seq++) {
          if (seq === opts.loseSeq) continue; 
          send(frame(seq));
        }
      } else if (msg.type === "RESUME") {
        const lastSeq = Number(msg.last_seq);
        resumes.push(lastSeq);
        for (let seq = lastSeq + 1; seq <= TOTAL; seq++) {
          if (seq === opts.loseSeq && !opts.replayHasLostMessage) continue; 
          send(frame(seq));
        }
      }
    });
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const address = wss.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        resumes,
        stop: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makePipeline(port: number) {
  const buffer = new ReorderBuffer();
  const deliveredSeqs: number[] = [];
  const events: string[] = [];

  const deliver = (released: ServerMessage[]) => {
    for (const m of released) deliveredSeqs.push(m.seq);
  };

  const watchdog = new GapWatchdog({
    stallMs: STALL_MS,
    maxRecoveries: 1,
    onRecover: (missing) => {
      events.push(`recover:${missing}`);
      conn.requestGapRecovery();
    },
    onSkip: (missing) => {
      events.push(`skip:${missing}`);
      const { released } = buffer.skipGap();
      deliver(released);
      watchdog.update(buffer.stats());
    },
  });

  const conn = new AgentConnection({
    url: `ws://127.0.0.1:${port}`,
    getResumeSeq: () => buffer.getLastReleasedSeq(),
    onStatusChange: () => {},
    onMessage: (msg) => {
      const { released } = buffer.push(msg);
      deliver(released);
      watchdog.update(buffer.stats());
    },
  });

  return { conn, buffer, watchdog, deliveredSeqs, events };
}

describe("gap recovery pipeline", () => {
  let server: Awaited<ReturnType<typeof startLossyServer>>;
  let pipeline: ReturnType<typeof makePipeline>;

  afterEach(async () => {
    pipeline.watchdog.dispose();
    pipeline.conn.close();
    await server.stop();
  });

  it("heals a lost seq via forced RESUME when server history has it", async () => {
    server = await startLossyServer({ loseSeq: 3, replayHasLostMessage: true });
    pipeline = makePipeline(server.port);
    pipeline.conn.connect();
    await sleep(100);

    pipeline.conn.sendUserMessage("go");
    await sleep(150);
    expect(pipeline.deliveredSeqs).toEqual([1, 2]);
    expect(pipeline.buffer.stats().pendingSeqs).toEqual([4, 5, 6]);

    await sleep(STALL_MS + 1500);
    expect(pipeline.events).toEqual(["recover:3"]);
    expect(server.resumes).toContain(2);
    expect(pipeline.deliveredSeqs).toEqual([1, 2, 3, 4, 5, 6]); 
    expect(pipeline.buffer.stats().seqsSkipped).toBe(0); 
  }, 15_000);

  it("skips the hole when RESUME replay can't supply it either", async () => {
    server = await startLossyServer({ loseSeq: 3, replayHasLostMessage: false });
    pipeline = makePipeline(server.port);
    pipeline.conn.connect();
    await sleep(100);

    pipeline.conn.sendUserMessage("go");
    await sleep(STALL_MS * 2 + 1800);

    expect(pipeline.events[0]).toBe("recover:3");
    expect(pipeline.events).toContain("skip:3");
    expect(pipeline.deliveredSeqs).toEqual([1, 2, 4, 5, 6]);
    expect(pipeline.buffer.stats().seqsSkipped).toBe(1);
    expect(pipeline.buffer.stats().pending).toBe(0); 
  }, 15_000);
});
