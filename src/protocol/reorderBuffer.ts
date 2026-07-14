import type { ServerMessage } from "./types";

export interface ReorderStats {
  lastReleasedSeq: number;
  released: number;
  duplicatesDropped: number;
  bufferedOutOfOrder: number;
  seqsSkipped: number;
  pending: number;
  pendingSeqs: number[];
  nextExpectedSeq: number;
}

export type PushEvent =
  | { kind: "released" }
  | { kind: "flushed"; flushedSeqs: number[] }
  | { kind: "held"; seq: number; waitingFor: number; pendingSeqs: number[] }
  | {
      kind: "duplicate";
      seq: number;
      reason: "already-released" | "pending-in-buffer";
    };

export interface PushResult {
  released: ServerMessage[];
  event: PushEvent;
}

export class ReorderBuffer {
  private buffer = new Map<number, ServerMessage>();
  private lastReleasedSeq = 0;
  private released = 0;
  private duplicatesDropped = 0;
  private bufferedOutOfOrder = 0;
  private seqsSkipped = 0;

  reset(): void {
    this.buffer.clear();
    this.lastReleasedSeq = 0;
    this.released = 0;
    this.duplicatesDropped = 0;
    this.bufferedOutOfOrder = 0;
    this.seqsSkipped = 0;
  }

  getLastReleasedSeq(): number {
    return this.lastReleasedSeq;
  }

  pendingSeqs(): number[] {
    return [...this.buffer.keys()].sort((a, b) => a - b);
  }

  stats(): ReorderStats {
    return {
      lastReleasedSeq: this.lastReleasedSeq,
      released: this.released,
      duplicatesDropped: this.duplicatesDropped,
      bufferedOutOfOrder: this.bufferedOutOfOrder,
      seqsSkipped: this.seqsSkipped,
      pending: this.buffer.size,
      pendingSeqs: this.pendingSeqs(),
      nextExpectedSeq: this.lastReleasedSeq + 1,
    };
  }


  skipGap(): { skippedSeqs: number[]; released: ServerMessage[] } {
    const firstHeld = this.pendingSeqs()[0];
    if (firstHeld === undefined) return { skippedSeqs: [], released: [] };
    const skippedSeqs: number[] = [];
    for (let s = this.lastReleasedSeq + 1; s < firstHeld; s++) skippedSeqs.push(s);
    this.lastReleasedSeq = firstHeld - 1;
    this.seqsSkipped += skippedSeqs.length;
    return { skippedSeqs, released: this.drain() };
  }

  push(message: ServerMessage): PushResult {
    const { seq } = message;

    if (seq <= this.lastReleasedSeq) {
      this.duplicatesDropped++;
      return {
        released: [],
        event: { kind: "duplicate", seq, reason: "already-released" },
      };
    }
    if (this.buffer.has(seq)) {
      this.duplicatesDropped++;
      return {
        released: [],
        event: { kind: "duplicate", seq, reason: "pending-in-buffer" },
      };
    }

    this.buffer.set(seq, message);

    if (seq !== this.lastReleasedSeq + 1) {
      this.bufferedOutOfOrder++;
      return {
        released: [],
        event: {
          kind: "held",
          seq,
          waitingFor: this.lastReleasedSeq + 1,
          pendingSeqs: this.pendingSeqs(),
        },
      };
    }

    const released = this.drain();
  
    const event: PushEvent =
      released.length > 1
        ? { kind: "flushed", flushedSeqs: released.map((m) => m.seq) }
        : { kind: "released" };
    return { released, event };
  }

  private drain(): ServerMessage[] {
    const out: ServerMessage[] = [];
    let next = this.lastReleasedSeq + 1;
    let msg = this.buffer.get(next);
    while (msg !== undefined) {
      out.push(msg);
      this.buffer.delete(next);
      this.lastReleasedSeq = next;
      this.released++;
      next += 1;
      msg = this.buffer.get(next);
    }
    return out;
  }
}
