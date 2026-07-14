import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GapWatchdog, type GapSnapshot } from "./gapWatchdog";

const snap = (nextExpectedSeq: number, pendingSeqs: number[]): GapSnapshot => ({
  pending: pendingSeqs.length,
  nextExpectedSeq,
  pendingSeqs,
});

const NO_GAP = snap(1, []);

describe("GapWatchdog", () => {
  let recovered: number[];
  let skipped: number[];
  let dog: GapWatchdog;

  beforeEach(() => {
    vi.useFakeTimers();
    recovered = [];
    skipped = [];
    dog = new GapWatchdog({
      stallMs: 8000,
      maxRecoveries: 1,
      onRecover: (missing) => recovered.push(missing),
      onSkip: (missing) => skipped.push(missing),
    });
  });

  afterEach(() => {
    dog.dispose();
    vi.useRealTimers();
  });

  it("does nothing while messages flow in order", () => {
    dog.update(NO_GAP);
    vi.advanceTimersByTime(60_000);
    expect(recovered).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("does nothing when a gap fills within the stall window", () => {
    dog.update(snap(70, [71, 72])); 
    vi.advanceTimersByTime(7000); 
    dog.update(NO_GAP); 
    vi.advanceTimersByTime(60_000);
    expect(recovered).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("triggers recovery when a gap stalls past the deadline", () => {
    dog.update(snap(70, [71, 72]));
    vi.advanceTimersByTime(7999);
    expect(recovered).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(recovered).toEqual([70]);
    expect(skipped).toEqual([]);
  });

  it("escalates to skip when the SAME gap stalls after recovery", () => {
    dog.update(snap(70, [71, 72]));
    vi.advanceTimersByTime(8000);
    expect(recovered).toEqual([70]);
    vi.advanceTimersByTime(8000);
    expect(skipped).toEqual([70]);
    expect(recovered).toEqual([70]); 
  });

  it("restarts the clock when the gap moves to a new missing seq", () => {
    dog.update(snap(70, [71]));
    vi.advanceTimersByTime(6000);
    dog.update(snap(73, [74])); 
    vi.advanceTimersByTime(6000); 
    expect(recovered).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(recovered).toEqual([73]);
  });

  it("intermediate updates for the same gap don't reset the clock", () => {
    dog.update(snap(70, [71]));
    vi.advanceTimersByTime(4000);
    dog.update(snap(70, [71, 72])); 
    vi.advanceTimersByTime(4000); 
    expect(recovered).toEqual([70]);
  });

  it("reset() clears budgets so a new turn's seqs get fresh recoveries", () => {
    dog.update(snap(70, [71]));
    vi.advanceTimersByTime(8000);
    expect(recovered).toEqual([70]);
    dog.reset(); 
    dog.update(snap(70, [71])); 
    vi.advanceTimersByTime(8000);
    expect(recovered).toEqual([70, 70]);
    expect(skipped).toEqual([]);
  });
});
