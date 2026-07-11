import { describe, it, expect } from "vitest";
import { ReorderBuffer } from "./reorderBuffer";
import type { ServerMessage, TokenMessage } from "./types";

function tok(seq: number, text = `t${seq}`): TokenMessage {
  return { type: "TOKEN", seq, text, stream_id: "s_1" };
}

/** Feed a list of messages, return the flat ordered release stream. */
function feed(buf: ReorderBuffer, msgs: ServerMessage[]): ServerMessage[] {
  const out: ServerMessage[] = [];
  for (const m of msgs) out.push(...buf.push(m));
  return out;
}

const seqs = (msgs: ServerMessage[]): number[] => msgs.map((m) => m.seq);

describe("ReorderBuffer", () => {
  it("empty buffer releases nothing and reports a zero cursor", () => {
    const buf = new ReorderBuffer();
    expect(buf.getLastReleasedSeq()).toBe(0);
    expect(buf.stats().pending).toBe(0);
  });

  it("single in-order element releases immediately", () => {
    const buf = new ReorderBuffer();
    expect(seqs(buf.push(tok(1)))).toEqual([1]);
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
    expect(seqs(buf.push(tok(2)))).toEqual([]); // waiting for 1
    expect(buf.stats().pending).toBe(1);
    expect(seqs(buf.push(tok(1)))).toEqual([1, 2]); // gap filled, both flush
    expect(buf.getLastReleasedSeq()).toBe(2);
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

  it("deduplicates a message whose seq was already released", () => {
    const buf = new ReorderBuffer();
    feed(buf, [tok(1), tok(2)]);
    expect(seqs(buf.push(tok(2)))).toEqual([]); // stale duplicate
    expect(buf.stats().duplicatesDropped).toBe(1);
    expect(buf.getLastReleasedSeq()).toBe(2);
  });

  it("deduplicates a message still pending in the buffer", () => {
    const buf = new ReorderBuffer();
    buf.push(tok(3)); // buffered, waiting for 1,2
    expect(seqs(buf.push(tok(3)))).toEqual([]); // duplicate of pending
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
    // Live: 1,2 processed. 3 was in flight when the socket died; 4,5 arrived
    // reordered ahead of it and are stranded behind the gap.
    feed(buf, [tok(1), tok(2)]);
    buf.push(tok(4));
    buf.push(tok(5));
    expect(buf.getLastReleasedSeq()).toBe(2); // still 2 — nothing past the gap
    expect(buf.stats().pending).toBe(2);
    // RESUME(last_seq=2) → server replays 3,4,5. 3 fills the gap; 4,5 dedupe.
    const replayed = feed(buf, [tok(3), tok(4), tok(5)]);
    expect(seqs(replayed)).toEqual([3, 4, 5]);
    expect(buf.stats().duplicatesDropped).toBe(2); // the replayed 4 and 5
    expect(buf.getLastReleasedSeq()).toBe(5);
  });

  it("reset() zeroes the cursor so a new turn's seq 1 is not seen as a dup", () => {
    const buf = new ReorderBuffer();
    feed(buf, [tok(1), tok(2), tok(3)]);
    expect(buf.getLastReleasedSeq()).toBe(3);
    buf.reset();
    expect(buf.getLastReleasedSeq()).toBe(0);
    expect(seqs(buf.push(tok(1)))).toEqual([1]); // not dropped as duplicate
  });
});
