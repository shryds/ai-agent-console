import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { AgentConnection } from "./AgentConnection";

const PING_INTERVAL = 120;
const PONG_DEADLINE = 360;

interface ServerStats {
  drops: number;
  pongsReceived: number;
  resumes: number;
}

function startMockServer(): Promise<{
  port: number;
  stats: ServerStats;
  stop: () => Promise<void>;
}> {
  const stats: ServerStats = { drops: 0, pongsReceived: 0, resumes: 0 };
  const wss = new WebSocketServer({ port: 0 });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };

  wss.on("connection", (socket: ServerSocket) => {
    let seq = 0;
    let awaitingPong: { challenge: string; deadline: ReturnType<typeof setTimeout> } | null = null;

    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };

    const pingLoop = () => {
      later(() => {
        if (socket.readyState !== socket.OPEN) return;
        seq += 1;
        const challenge = `c${seq}`;
        send({ type: "PING", seq, challenge });
        awaitingPong = {
          challenge,
          deadline: later(() => {
            stats.drops += 1;
            socket.close(4008, "heartbeat timeout");
          }, PONG_DEADLINE),
        };
        pingLoop();
      }, PING_INTERVAL);
    };
    pingLoop();

    socket.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "PONG") {
        stats.pongsReceived += 1;
        if (awaitingPong) {
          clearTimeout(awaitingPong.deadline);
          timers.delete(awaitingPong.deadline);
          awaitingPong = null;
        }
      } else if (msg.type === "RESUME") {
        stats.resumes += 1;
      } else if (msg.type === "USER_MESSAGE") {
        seq = 0;
        for (let i = 0; i < 3; i++) {
          seq += 1;
          send({ type: "TOKEN", seq, text: `t${seq} `, stream_id: "s_1" });
        }
        seq += 1;
        send({ type: "STREAM_END", seq, stream_id: "s_1" });
      }
    });
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const address = wss.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        stats,
        stop: () =>
          new Promise<void>((done) => {
            for (const t of timers) clearTimeout(t);
            for (const client of wss.clients) client.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("AgentConnection heartbeats across turns", () => {
  let server: Awaited<ReturnType<typeof startMockServer>>;
  let conn: AgentConnection | null = null;

  beforeEach(async () => {
    server = await startMockServer();
  });

  afterEach(async () => {
    conn?.close();
    conn = null;
    await server.stop();
  });

  it("keeps answering PINGs on turn 2+ so the server never heartbeat-drops us", async () => {
    const statuses: string[] = [];
    const pongsSent: number[] = [];
    let clientSawDrop = 0;

    conn = new AgentConnection({
      url: `ws://127.0.0.1:${server.port}`,
      onMessage: () => {},
      onStatusChange: (s) => statuses.push(s),
      getResumeSeq: () => 0,
      onPong: ({ seq }) => pongsSent.push(seq),
      onDrop: () => {
        clientSawDrop += 1;
      },
    });
    conn.connect();
    await sleep(200); 

    conn.sendUserMessage("turn one");
    await sleep(600);
    const pongsAfterTurn1 = pongsSent.length;
    expect(pongsAfterTurn1).toBeGreaterThan(0); // turn-1 PINGs are answered
    expect(server.stats.drops).toBe(0);

    conn.sendUserMessage("turn two");
    await sleep(1200);

    expect(pongsSent.length).toBeGreaterThan(pongsAfterTurn1);
    
    expect(server.stats.drops).toBe(0);
    expect(clientSawDrop).toBe(0);
    expect(statuses.filter((s) => s === "reconnecting")).toHaveLength(0);
  }, 15_000);
});
