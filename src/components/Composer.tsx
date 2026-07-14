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
  busy,
  onClear,
}: {
  onSend: (content: string) => void;
  canSend: boolean;
  /** A query is already streaming — only one at a time is allowed. */
  busy: boolean;
  onClear: () => void;
}) {
  const [value, setValue] = useState("");

  const sendable = canSend && !busy;

  const submit = () => {
    if (!sendable || value.trim().length === 0) return;
    onSend(value);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = !canSend
    ? "Waiting for connection…"
    : busy
      ? "Agent is responding — wait for it to finish…"
      : "Ask the agent… (Enter to send, Shift+Enter for newline)";

  return (
    <div className={styles.root}>
      <div className={styles.suggestions}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            className={styles.chip}
            disabled={!sendable}
            title={s.hint}
            onClick={() => sendable && onSend(s.prompt)}
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
          disabled={busy}
          placeholder={placeholder}
        />
        <button
          className={styles.send}
          onClick={submit}
          disabled={!sendable || value.trim().length === 0}
          title={busy ? "A query is already in progress" : "Send"}
          aria-label={busy ? "Query in progress" : "Send"}
        >
          {busy ? <span className={styles.spinner} aria-hidden /> : "Send"}
        </button>
      </div>
    </div>
  );
}
