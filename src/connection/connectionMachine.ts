//connecting ──SOCKET_OPENED(resumed:false)──> open
//connecting ──SOCKET_OPENED(resumed:true) ──> resuming ── RESUME_SETTLED ──> open
//open ──SOCKET_CLOSED(unexpected)  ──> reconnecting
//resuming ──SOCKET_CLOSED(unexpected)  ──> reconnecting
//reconnecting ──RETRY (backoff elapsed)    ──> connecting
//* ──CLOSE / SOCKET_CLOSED(intentional) ──> closed

export type ConnStatus =
  | "idle"
  | "connecting"
  | "open"
  | "resuming"
  | "reconnecting"
  | "closed";

export type ConnEvent =
  | { type: "CONNECT" }
  | { type: "SOCKET_OPENED"; resumed: boolean }
  | { type: "RESUME_SETTLED" }
  | { type: "SOCKET_CLOSED"; intentional: boolean }
  | { type: "RETRY" }
  | { type: "CLOSE" };

export function nextStatus(status: ConnStatus, event: ConnEvent): ConnStatus {

  if (event.type === "CLOSE") return "closed";

  switch (status) {
    case "idle":
      if (event.type === "CONNECT") return "connecting";
      return status;

    case "connecting":
      if (event.type === "SOCKET_OPENED") return event.resumed ? "resuming" : "open";
      if (event.type === "SOCKET_CLOSED") return event.intentional ? "closed" : "reconnecting";
      return status;

    case "open":
      if (event.type === "SOCKET_CLOSED") return event.intentional ? "closed" : "reconnecting";
      return status;

    case "resuming":
      if (event.type === "RESUME_SETTLED") return "open";
      if (event.type === "SOCKET_CLOSED") return event.intentional ? "closed" : "reconnecting";
      return status;

    case "reconnecting":
      if (event.type === "RETRY") return "connecting";
      if (event.type === "SOCKET_CLOSED") return event.intentional ? "closed" : "reconnecting";
      return status;

    case "closed":
      // Terminal, but a manual CONNECT can revive it.
      if (event.type === "CONNECT") return "connecting";
      return status;

    default:
      return status;
  }
}


export function backoffDelay(attempt: number): number {
  const base = 500 * 2 ** Math.max(0, attempt);
  return Math.min(base, 10_000);
}

export function isDisconnected(status: ConnStatus): boolean {
  return status === "reconnecting" || status === "connecting" || status === "closed" || status === "idle";
}
