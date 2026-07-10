import { describe, it, expect } from "vitest";
import { nextStatus, backoffDelay, type ConnStatus } from "./connectionMachine";

describe("connectionMachine", () => {
  it("first connect goes connecting → open (no resume)", () => {
    let s: ConnStatus = "idle";
    s = nextStatus(s, { type: "CONNECT" });
    expect(s).toBe("connecting");
    s = nextStatus(s, { type: "SOCKET_OPENED", resumed: false });
    expect(s).toBe("open");
  });

  it("reconnect goes through resuming before open", () => {
    let s: ConnStatus = "connecting";
    s = nextStatus(s, { type: "SOCKET_OPENED", resumed: true });
    expect(s).toBe("resuming");
    s = nextStatus(s, { type: "RESUME_SETTLED" });
    expect(s).toBe("open");
  });

  it("an unexpected drop from open enters reconnecting, retry re-enters connecting", () => {
    let s: ConnStatus = "open";
    s = nextStatus(s, { type: "SOCKET_CLOSED", intentional: false });
    expect(s).toBe("reconnecting");
    s = nextStatus(s, { type: "RETRY" });
    expect(s).toBe("connecting");
  });

  it("a drop during resuming falls back to reconnecting", () => {
    const s = nextStatus("resuming", { type: "SOCKET_CLOSED", intentional: false });
    expect(s).toBe("reconnecting");
  });

  it("intentional close is absorbing from any state", () => {
    for (const s of ["idle", "connecting", "open", "resuming", "reconnecting"] as ConnStatus[]) {
      expect(nextStatus(s, { type: "CLOSE" })).toBe("closed");
    }
    expect(nextStatus("open", { type: "SOCKET_CLOSED", intentional: true })).toBe("closed");
  });

  it("closed can be revived by an explicit CONNECT", () => {
    expect(nextStatus("closed", { type: "CONNECT" })).toBe("connecting");
  });

  it("backoff follows 500,1s,2s,4s,8s then caps at 10s", () => {
    expect(backoffDelay(0)).toBe(500);
    expect(backoffDelay(1)).toBe(1000);
    expect(backoffDelay(2)).toBe(2000);
    expect(backoffDelay(3)).toBe(4000);
    expect(backoffDelay(4)).toBe(8000);
    expect(backoffDelay(5)).toBe(10_000);
    expect(backoffDelay(99)).toBe(10_000);
  });
});
