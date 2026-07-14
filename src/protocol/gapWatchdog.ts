export interface GapWatchdogOptions {
  stallMs: number;
  maxRecoveries: number;
  onRecover: (missingSeq: number, heldSeqs: number[]) => void;
  onSkip: (missingSeq: number, heldSeqs: number[]) => void;
}

export interface GapSnapshot {
  pending: number;
  nextExpectedSeq: number;
  pendingSeqs: number[];
}

export class GapWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watching: number | null = null;
  private recoveries = new Map<number, number>();
  private lastSnapshot: GapSnapshot | null = null;

  constructor(private readonly opts: GapWatchdogOptions) {}

  update(snapshot: GapSnapshot): void {
    this.lastSnapshot = snapshot;
    if (snapshot.pending === 0) {
      this.disarm();
      return;
    }
    const missing = snapshot.nextExpectedSeq;
    if (this.watching === missing && this.timer !== null) {
      return;
    }
    this.arm(missing);
  }

  reset(): void {
    this.disarm();
    this.recoveries.clear();
    this.lastSnapshot = null;
  }

  dispose(): void {
    this.disarm();
  }

  private arm(missing: number): void {
    this.disarm();
    this.watching = missing;
    this.timer = setTimeout(() => this.fire(missing), this.opts.stallMs);
  }

  private disarm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.watching = null;
  }

  private fire(missing: number): void {
    this.timer = null;
    this.watching = null;
    const snap = this.lastSnapshot;
    if (!snap || snap.pending === 0 || snap.nextExpectedSeq !== missing) return;

    const attempts = this.recoveries.get(missing) ?? 0;
    if (attempts < this.opts.maxRecoveries) {
      this.recoveries.set(missing, attempts + 1);
      this.opts.onRecover(missing, snap.pendingSeqs);
      this.arm(missing);
    } else {
      this.opts.onSkip(missing, snap.pendingSeqs);
    }
  }
}
