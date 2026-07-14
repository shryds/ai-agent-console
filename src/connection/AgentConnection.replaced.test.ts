import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { AgentConnection } from "./AgentConnection";


function startSingleConnectionServer(): Promise<{
  port: number;
  connectionCount: () => number;
  killCurrentAbnormally: () => void;
  stop: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0 });
  let current: ServerSocket | null = null;
  let connections = 0;

  wss.on("connection", (socket: ServerSocket) => {
    connections += 1;
    if (current && current.readyState === current.OPEN) {
      current.close(1000, "replaced"); // exactly what the agent server does
    }
    current = socket;
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const address = wss.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        connectionCount: () => connections,
        killCurrentAbnormally: () => current?.terminate(), // chaos drop → 1006
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

function makeClient(port: number) {
  const statuses: string[] = [];
  let serverClose: { code: number; reason: string } | null = null;
  let drops = 0;
  const conn = new AgentConnection({
    url: `ws://127.0.0.1:${port}`,
    onMessage: () => {},
    onStatusChange: (s) => statuses.push(s),
    getResumeSeq: () => 0,
    onDrop: () => {
      drops += 1;
    },
    onServerClose: (code, reason) => {
      serverClose = { code, reason };
    },
  });
  return {
    conn,
    statuses,
    getServerClose: () => serverClose,
    getDrops: () => drops,
  };
}

describe("AgentConnection vs single-connection server", () => {
  let server: Awaited<ReturnType<typeof startSingleConnectionServer>>;
  const clients: AgentConnection[] = [];

  beforeEach(async () => {
    server = await startSingleConnectionServer();
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    await server.stop();
  });

  it("yields when replaced instead of starting an eviction war", async () => {
    const a = makeClient(server.port);
    clients.push(a.conn);
    a.conn.connect();
    await sleep(150);
    expect(a.statuses.at(-1)).toBe("open");

    const b = makeClient(server.port);
    clients.push(b.conn);
    b.conn.connect();
    await sleep(150);

    expect(a.getServerClose()).toEqual({ code: 1000, reason: "replaced" });
    expect(a.statuses.at(-1)).toBe("closed");
    expect(a.getDrops()).toBe(0); // not treated as a network drop

    const countAfterEviction = server.connectionCount();
    await sleep(1500);
    expect(server.connectionCount()).toBe(countAfterEviction);
    expect(b.statuses.at(-1)).toBe("open");
  }, 15_000);

  it("still auto-reconnects after an abnormal (chaos) drop", async () => {
    const a = makeClient(server.port);
    clients.push(a.conn);
    a.conn.connect();
    await sleep(150);
    expect(a.statuses.at(-1)).toBe("open");

    server.killCurrentAbnormally(); 
    await sleep(1200); 

    expect(a.getDrops()).toBe(1);
    expect(a.statuses).toContain("reconnecting");
    expect(a.statuses.at(-1)).toBe("open"); 
    expect(server.connectionCount()).toBeGreaterThanOrEqual(2);
  }, 15_000);

  it("manual connect() takes the slot back after yielding", async () => {
    const a = makeClient(server.port);
    clients.push(a.conn);
    a.conn.connect();
    await sleep(150);

    const b = makeClient(server.port);
    clients.push(b.conn);
    b.conn.connect();
    await sleep(150);
    expect(a.statuses.at(-1)).toBe("closed"); 

    a.conn.connect(); 
    await sleep(150);
    expect(a.statuses.at(-1)).toBe("open"); 
    expect(b.statuses.at(-1)).toBe("closed"); 
  }, 15_000);
});
