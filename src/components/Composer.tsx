"use client";

import { useState, type KeyboardEvent } from "react";
import { cx } from "@/lib/classNames";
import styles from "./Composer.module.css";


const SUGGESTIONS: Array<{ label: string; prompt: string; hint: string }> = [
  { label: "Greeting", prompt: "hello there", hint: "plain token stream, no tools" },
  { label: "Report", prompt: "summarise the q3 report", hint: "one mid-stream tool call + context diff" },
  { label: "Analysis", prompt: "analyze and compare our metrics", hint: "two sequential tool calls" },
  { label: "Lookup", prompt: "look up the deployment SLA", hint: "tool call before any tokens" },
  { label: "Large ctx", prompt: "load the full database schema", hint: "~550KB context snapshot" },
  { label: "Long", prompt: "write a detailed document", hint: "long stream + tool call" },
];

export function Composer({
  onSend,
  canSend,
  onClear,
}: {
  onSend: (content: string) => void;
  canSend: boolean;
  onClear: () => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (!canSend || value.trim().length === 0) return;
    onSend(value);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.suggestions}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            className={styles.chip}
            disabled={!canSend}
            title={s.hint}
            onClick={() => canSend && onSend(s.prompt)}
          >
            {s.label}
          </button>
        ))}
        <button className={cx(styles.chip, styles.clear)} onClick={onClear} title="Clear the console">
          Clear
        </button>
      </div>
      <div className={styles.inputRow}>
        <textarea
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            canSend ? "Ask the agent… (Enter to send, Shift+Enter for newline)" : "Waiting for connection…"
          }
        />
        <button className={styles.send} onClick={submit} disabled={!canSend || value.trim().length === 0}>
          Send
        </button>
      </div>
    </div>
  );
}
