"use client";

import { memo } from "react";
import type { Turn, TextSegment } from "@/session/types";
import type { Focus } from "@/session/types";
import { cx } from "@/lib/classNames";
import { ToolCallCard } from "./ToolCallCard";
import styles from "./MessageTurn.module.css";


export const MessageTurn = memo(function MessageTurn({
  turn,
  focusSegmentId,
  onFocus,
}: {
  turn: Turn;
  focusSegmentId: string | null;
  onFocus: (focus: Focus) => void;
}) {
  if (turn.kind === "user") {
    return (
      <div className={cx(styles.row, styles.userRow)}>
        <div className={styles.userBubble}>{turn.content}</div>
      </div>
    );
  }

  return (
    <div className={cx(styles.row, styles.agentRow)}>
      <div className={styles.avatar}>A</div>
      <div className={styles.agentBody}>
        {turn.segments.length === 0 && turn.status === "streaming" && (
          <span className={styles.thinking}>
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </span>
        )}
        {turn.segments.map((seg) =>
          seg.kind === "text" ? (
            <TextRun
              key={seg.id}
              segment={seg}
              focused={focusSegmentId === seg.id}
              onSelect={() => onFocus({ segmentId: seg.id, traceId: null, callId: null })}
            />
          ) : (
            <ToolCallCard
              key={seg.id}
              tool={seg}
              focused={focusSegmentId === seg.id}
              onSelect={() => onFocus({ segmentId: seg.id, traceId: null, callId: seg.callId })}
            />
          ),
        )}
      </div>
    </div>
  );
});

const TextRun = memo(function TextRun({
  segment,
  focused,
  onSelect,
}: {
  segment: TextSegment;
  focused: boolean;
  onSelect: () => void;
}) {
  return (
    <span
      className={cx(styles.text, focused && styles.textFocused, !segment.done && styles.streaming)}
      data-segid={segment.id}
      onClick={onSelect}
    >
      {segment.text}
      {!segment.done && <span className={styles.caret} />}
    </span>
  );
});
