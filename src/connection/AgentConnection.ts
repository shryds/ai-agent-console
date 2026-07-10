import {
  backoffDelay,
  nextStatus,
  type ConnEvent,
  type ConnStatus,
} from "./connectionMachine";
import { parseServerMessage, type ClientMessage, type ServerMessage } from "@/protocol/types";


export interface AgentConnectionOptions {
  url: string;

  onMessage: (msg: ServerMessage) => void;
  onStatusChange: (status: ConnStatus) => void;
  getResumeSeq: () => number;
  onPong?: (info: { seq: number; challenge: string }) => void;
  onResumeSent?: (lastSeq: number) => void;
  onDrop?: () => void;
  onMalformed?: (raw: string) => void;
}

export class AgentConnection {
  private readonly opts: AgentConnectionOptions;
  private ws: WebSocket | null = null;
  private status: ConnStatus = "idle";

  private hasSession = false;
  private intentional = false;
  private attempt = 0;

  private highestPingSeqSeen = 0;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AgentConnectionOptions) {
    this.opts = opts;
  }

  getStatus(): ConnStatus {
    return this.status;
  }

  connect(): void {
    if (this.status === "connecting" || this.status === "open" || this.status === "resuming") {
      return;
    }
    this.intentional = false;
    this.dispatch({ type: "CONNECT" });
    this.openSocket();
  }

  close(): void {
    this.intentional = true;
    this.clearTimers();
    this.dispatch({ type: "CLOSE" });
    if (this.ws) {
      try {
        this.ws.close(1000, "client-close");
      } catch {
        /* ignore */
      }
    }
    this.detachSocket();
  }

  sendUserMessage(content: string): void {
    this.hasSession = true;
    this.rawSend({ type: "USER_MESSAGE", content });
  }

  sendToolAck(callId: string): void {
    this.rawSend({ type: "TOOL_ACK", call_id: callId });
  }

  /** Whether a client message can be sent right now. */
  canSend(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }


  private openSocket(): void {
    const resume = this.hasSession;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      if (resume) {
        const lastSeq = this.opts.getResumeSeq();
        this.rawSend({ type: "RESUME", last_seq: lastSeq });
        this.opts.onResumeSent?.(lastSeq);
        this.dispatch({ type: "SOCKET_OPENED", resumed: true });
        this.settleTimer = setTimeout(() => this.dispatch({ type: "RESUME_SETTLED" }), 300);
      } else {
        this.dispatch({ type: "SOCKET_OPENED", resumed: false });
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
      this.handleRaw(raw);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.handleClose();
    };

  }

  private handleRaw(raw: string): void {
    const msg = parseServerMessage(raw);
    if (msg === null) {
      this.opts.onMalformed?.(raw);
      return;
    }

    if (msg.type === "PING") {
      if (msg.seq > this.highestPingSeqSeen) {
        this.highestPingSeqSeen = msg.seq;
        this.rawSend({ type: "PONG", echo: msg.challenge });
        this.opts.onPong?.({ seq: msg.seq, challenge: msg.challenge });
      }
    }

    this.opts.onMessage(msg);
  }

  private handleClose(): void {
    this.clearTimers();
    if (this.intentional) {
      this.dispatch({ type: "SOCKET_CLOSED", intentional: true });
      return;
    }
    this.dispatch({ type: "SOCKET_CLOSED", intentional: false });
    this.opts.onDrop?.();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      if (this.intentional) return;
      this.dispatch({ type: "RETRY" });
      this.openSocket();
    }, delay);
  }

  private dispatch(event: ConnEvent): void {
    const prev = this.status;
    const next = nextStatus(prev, event);
    if (next !== prev) {
      this.status = next;
      this.opts.onStatusChange(next);
    }
  }

  private rawSend(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private detachSocket(): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws = null;
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }
}
