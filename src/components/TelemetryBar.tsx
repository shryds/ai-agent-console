"use client";

import type { Telemetry } from "@/session/types";
import { HTTP_URL } from "@/lib/env";
import styles from "./TelemetryBar.module.css";

export function TelemetryBar({ telemetry }: { telemetry: Telemetry }) {
  const items: Array<{ label: string; value: string | number; hot?: boolean }> = [
    { label: "reconnects", value: telemetry.reconnects, hot: telemetry.reconnects > 0 },
    { label: "reordered", value: telemetry.reordered, hot: telemetry.reordered > 0 },
    { label: "in buffer", value: telemetry.pendingInBuffer, hot: telemetry.pendingInBuffer > 0 },
    { label: "dupes dropped", value: telemetry.duplicatesDropped, hot: telemetry.duplicatesDropped > 0 },
    { label: "seqs skipped", value: telemetry.seqsSkipped, hot: telemetry.seqsSkipped > 0 },
    { label: "pongs", value: telemetry.pongsSent },
    { label: "tool acks", value: telemetry.toolAcksSent },
    { label: "malformed", value: telemetry.malformed, hot: telemetry.malformed > 0 },
    { label: "resume seq", value: telemetry.lastResumeSeq ?? "—" },
  ];

  return (
    <div className={styles.root}>
      {items.map((it) => (
        <div key={it.label} className={styles.stat}>
          <span className={styles.label}>{it.label}</span>
          <span className={it.hot ? styles.valueHot : styles.value}>{it.value}</span>
        </div>
      ))}
      <div className={styles.links}>
        <a href={`${HTTP_URL}/log`} target="_blank" rel="noreferrer" className={styles.link}>
          /log
        </a>
        <a href={`${HTTP_URL}/health`} target="_blank" rel="noreferrer" className={styles.link}>
          /health
        </a>
      </div>
    </div>
  );
}
