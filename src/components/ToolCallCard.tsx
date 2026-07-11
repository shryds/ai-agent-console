"use client";

import { memo } from "react";
import type { ToolSegment } from "@/session/types";
import { cx } from "@/lib/classNames";
import styles from "./ToolCallCard.module.css";

export const ToolCallCard = memo(function ToolCallCard({
  tool,
  focused,
  onSelect,
}: {
  tool: ToolSegment;
  focused: boolean;
  onSelect: () => void;
}) {
  const pending = tool.status === "pending";
  return (
    <div
      className={cx(styles.card, focused && styles.focused, pending && styles.pending)}
      data-segid={tool.id}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <div className={styles.header}>
        <span className={styles.icon}>{pending ? "⏳" : "🛠"}</span>
        <span className={styles.name}>{tool.toolName}</span>
        <span className={cx(styles.badge, pending ? styles.badgePending : styles.badgeDone)}>
          {pending ? "waiting for result" : "done"}
        </span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>args</div>
        <pre className={styles.code}>{safeStringify(tool.args)}</pre>
      </div>

      {tool.result !== null ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>result</div>
          <pre className={cx(styles.code, styles.result)}>{safeStringify(tool.result)}</pre>
        </div>
      ) : (
        <div className={styles.waiting}>
          <span className={styles.spinner} /> Executing…
        </div>
      )}
    </div>
  );
});

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
