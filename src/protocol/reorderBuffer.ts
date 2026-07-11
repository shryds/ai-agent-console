import type { ServerMessage } from "./types";



export interface ReorderStats {
  lastReleasedSeq: number;
  released: number;
  duplicatesDropped: number;
  bufferedOutOfOrder: number;
  pending: number;
}

export class ReorderBuffer {
  private buffer = new Map<number, ServerMessage>();
  private lastReleasedSeq = 0;
  private released = 0;
  private duplicatesDropped = 0;
  private bufferedOutOfOrder = 0;

  reset(): void {
    this.buffer.clear();
    this.lastReleasedSeq = 0;
    this.released = 0;
    this.duplicatesDropped = 0;
    this.bufferedOutOfOrder = 0;
  }

  getLastReleasedSeq(): number {
    return this.lastReleasedSeq;
  }

  stats(): ReorderStats {
    return {
      lastReleasedSeq: this.lastReleasedSeq,
      released: this.released,
      duplicatesDropped: this.duplicatesDropped,
      bufferedOutOfOrder: this.bufferedOutOfOrder,
      pending: this.buffer.size,
    };
  }


  push(message: ServerMessage): ServerMessage[] {
    const { seq } = message;

    if (seq <= this.lastReleasedSeq) {
      this.duplicatesDropped++;
      return [];
    }
    if (this.buffer.has(seq)) {
      this.duplicatesDropped++;
      return [];
    }

    this.buffer.set(seq, message);
    if (seq !== this.lastReleasedSeq + 1) {
      this.bufferedOutOfOrder++;
    }

    return this.drain();
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
