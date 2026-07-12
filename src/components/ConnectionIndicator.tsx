"use client";

import type { ConnStatus } from "@/connection/connectionMachine";
import { cx } from "@/lib/classNames";
import styles from "./ConnectionIndicator.module.css";

const LABELS: Record<ConnStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  open: "Connected",
  resuming: "Recovering state…",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

export function ConnectionIndicator({ status }: { status: ConnStatus }) {
  const busy = status === "reconnecting" || status === "connecting" || status === "resuming";
  return (
    <div
      className={cx(styles.root, styles[status])}
      role="status"
      aria-live="polite"
      title={`WebSocket: ${status}`}
    >
      <span className={cx(styles.dot, busy && styles.pulsing)} />
      <span className={styles.label}>{LABELS[status]}</span>
    </div>
  );
}
