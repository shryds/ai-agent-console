import { describe, it, expect } from "vitest";
import { ReorderBuffer } from "./reorderBuffer";
import type { ServerMessage, TokenMessage } from "./types";

function tok(seq: number, text = `t${seq}`): TokenMessage {
  return { type: "TOKEN", seq, text, stream_id: "s_1" };
}

function feed(buf: ReorderBuffer, msgs: ServerMessage[]): ServerMessage[] {
  const out: ServerMessage[] = [];
  for (const m of msgs) out.push(...buf.push(m).released);
  return out;
}

const seqs = (msgs: ServerMessage[]): number[] => msgs.map((m) => m.seq);

describe("ReorderBuffer", () => {
  it("empty buffer releases nothing and reports a zero cursor", () => {
    const buf = new ReorderBuffer();
    expect(buf.getLastReleasedSeq()).toBe(0);
    expect(buf.stats().pending).toBe(0);
    expect(buf.stats().pendingSeqs).toEqual([]);
    expect(buf.stats().nextExpectedSeq).toBe(1);
  });

  it("single in-order element releases immediately", () => {
    const buf = new ReorderBuffer();
    const res = buf.push(tok(1));
    expect(seqs(res.released)).toEqual([1]);
    expect(res.event).toEqual({ kind: "released" });
    expect(buf.getLastReleasedSeq()).toBe(1);
  });

  it("in-order stream passes straight through", () => {
    const buf = new ReorderBuffer();
    const out = feed(buf, [tok(1), tok(2), tok(3), tok(4)]);
    expect(seqs(out)).toEqual([1, 2, 3, 4]);
    expect(buf.stats().bufferedOutOfOrder).toBe(0);
  });

  it("holds an out-of-order element until the gap fills", () => {
    const buf = new ReorderBuffer();
    const held = buf.push(tok(2));
    expect(seqs(held.released)).toEqual([]); // waiting for 1
    expect(held.event).toEqual({
      kind: "held",
      seq: 2,
      waitingFor: 1,
      pendingSeqs: [2],
    });
    expect(buf.stats().pending).toBe(1);
    expect(buf.stats().pendingSeqs).toEqual([2]);

    const filled = buf.push(tok(1));
    expect(seqs(filled.released)).toEqual([1, 2]); // gap filled, both flush
    expect(filled.event).toEqual({ kind: "flushed", flushedSeqs: [1, 2] });
    expect(buf.getLastReleasedSeq()).toBe(2);
    expect(buf.stats().pendingSeqs).toEqual([]);
  });

  it("reorders a shuffled window into ascending seq order", () => {
    const buf = new ReorderBuffer();
    const out = feed(buf, [tok(3), tok(1), tok(4), tok(2)]);
    expect(seqs(out)).toEqual([1, 2, 3, 4]);
  });

  it("handles a fully reversed sequence", () => {
    const buf = new ReorderBuffer();
    const out = feed(buf, [tok(5), tok(4), tok(3), tok(2), tok(1)]);
    expect(seqs(out)).toEqual([1, 2, 3, 4, 5]);
    expect(buf.getLastReleasedSeq()).toBe(5);
  });

  it("reports every held seq while the gap is open", () => {
    const buf = new ReorderBuffer();
    buf.push(tok(3));
    const res = buf.push(tok(5));
    expect(res.event).toEqual({
      kind: "held",
      seq: 5,
      waitingFor: 1,
      pendingSeqs: [3, 5],
    });
  });

  it("deduplicates a message whose seq was already released", () => {
    const buf = new ReorderBuffer();
    feed(buf, [tok(1), tok(2)]);
    const res = buf.push(tok(2)); // stale duplicate
    expect(seqs(res.released)).toEqual([]);
    expect(res.event).toEqual({
      kind: "duplicate",
      seq: 2,
      reason: "already-released",
    });
    expect(buf.stats().duplicatesDropped).toBe(1);
    expect(buf.getLastReleasedSeq()).toBe(2);
  });

  it("deduplicates a message still pending in the buffer", () => {
    const buf = new ReorderBuffer();
    buf.push(tok(3)); // buffered, waiting for 1,2
    const res = buf.push(tok(3)); // duplicate of pending
    expect(seqs(res.released)).toEqual([]);
    expect(res.event).toEqual({
      kind: "duplicate",
      seq: 3,
      reason: "pending-in-buffer",
    });
    expect(buf.stats().duplicatesDropped).toBe(1);
    expect(buf.stats().pending).toBe(1);
  });

  it("keeps the first copy when a duplicate arrives interleaved with the gap fill", () => {
    const buf = new ReorderBuffer();
    const out = feed(buf, [tok(1), tok(3), tok(3, "dup"), tok(2)]);
    expect(seqs(out)).toEqual([1, 2, 3]);
    const three = out.find((m) => m.seq === 3) as TokenMessage;
    expect(three.text).toBe("t3"); // original, not "dup"
    expect(buf.stats().duplicatesDropped).toBe(1);
  });

  it("models a mid-stream drop + RESUME replay healing a permanent gap", () => {
    const buf = new ReorderBuffer();
    feed(buf, [tok(1), tok(2)]);
    buf.push(tok(4));
    buf.push(tok(5));
    expect(buf.getLastReleasedSeq()).toBe(2); // still 2 — nothing past the gap
    expect(buf.stats().pending).toBe(2);
    expect(buf.stats().pendingSeqs).toEqual([4, 5]);
    const gapFill = buf.push(tok(3));
    expect(seqs(gapFill.released)).toEqual([3, 4, 5]);
    expect(gapFill.event).toEqual({ kind: "flushed", flushedSeqs: [3, 4, 5] });
    const replayed = feed(buf, [tok(4), tok(5)]);
    expect(seqs(replayed)).toEqual([]);
    expect(buf.stats().duplicatesDropped).toBe(2); // the replayed 4 and 5
    expect(buf.getLastReleasedSeq()).toBe(5);
  });

  it("reset() zeroes the cursor so a new turn's seq 1 is not seen as a dup", () => {
    const buf = new ReorderBuffer();
    feed(buf, [tok(1), tok(2), tok(3)]);
    expect(buf.getLastReleasedSeq()).toBe(3);
    buf.reset();
    expect(buf.getLastReleasedSeq()).toBe(0);
    expect(seqs(buf.push(tok(1)).released)).toEqual([1]); // not dropped as duplicate
  });
});

describe("ReorderBuffer.skipGap", () => {
  it("abandons the missing seqs and releases everything held behind them", () => {
    const buf = new ReorderBuffer();
    feed(buf, [tok(1)]);
    buf.push(tok(4)); // 2 and 3 never arrive
    buf.push(tok(5));
    const { skippedSeqs, released } = buf.skipGap();
    expect(skippedSeqs).toEqual([2, 3]);
    expect(seqs(released)).toEqual([4, 5]);
    expect(buf.getLastReleasedSeq()).toBe(5);
    expect(buf.stats().seqsSkipped).toBe(2);
    expect(buf.stats().pending).toBe(0);
  });

  it("is a no-op when nothing is held", () => {
    const buf = new ReorderBuffer();
    feed(buf, [tok(1), tok(2)]);
    const { skippedSeqs, released } = buf.skipGap();
    expect(skippedSeqs).toEqual([]);
    expect(released).toEqual([]);
    expect(buf.getLastReleasedSeq()).toBe(2);
  });

  it("in-order flow continues normally after a skip", () => {
    const buf = new ReorderBuffer();
    buf.push(tok(2)); // #1 lost
    buf.skipGap();
    expect(buf.getLastReleasedSeq()).toBe(2);
    const res = buf.push(tok(3));
    expect(seqs(res.released)).toEqual([3]);
    // A late arrival of the abandoned seq is dropped as already-released.
    const late = buf.push(tok(1));
    expect(late.event).toEqual({ kind: "duplicate", seq: 1, reason: "already-released" });
  });
});
