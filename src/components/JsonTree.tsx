"use client";

import { memo, useState } from "react";
import type { JsonValue } from "@/protocol/types";
import { cx } from "@/lib/classNames";
import styles from "./JsonTree.module.css";

export const JsonTree = memo(function JsonTree({
  value,
  rootLabel,
  defaultExpandDepth = 1,
}: {
  value: JsonValue;
  rootLabel?: string;
  defaultExpandDepth?: number;
}) {
  return (
    <div className={styles.tree}>
      <JsonNode name={rootLabel ?? "root"} value={value} depth={0} expandDepth={defaultExpandDepth} />
    </div>
  );
});

function JsonNode({
  name,
  value,
  depth,
  expandDepth,
}: {
  name: string;
  value: JsonValue;
  depth: number;
  expandDepth: number;
}) {
  const container = getContainer(value);
  const [open, setOpen] = useState(depth < expandDepth);

  if (!container) {
    return (
      <div className={styles.line} style={indent(depth)}>
        <span className={styles.key}>{name}:</span> <ValueChip value={value} />
      </div>
    );
  }

  const entries = container.entries;
  const summary =
    container.kind === "array" ? `[ ${entries.length} ]` : `{ ${entries.length} }`;

  return (
    <div>
      <div className={cx(styles.line, styles.clickable)} style={indent(depth)} onClick={() => setOpen((o) => !o)}>
        <span className={styles.toggle}>{open ? "▾" : "▸"}</span>
        <span className={styles.key}>{name}</span>
        <span className={styles.summary}>{summary}</span>
      </div>
      {open &&
        entries.map((e) => (
          <JsonNode key={e.key} name={e.key} value={e.value} depth={depth + 1} expandDepth={expandDepth} />
        ))}
    </div>
  );
}

export function ValueChip({ value }: { value: JsonValue }) {
  if (value === null) return <span className={styles.null}>null</span>;
  switch (typeof value) {
    case "string":
      return <span className={styles.string}>&quot;{truncate(value)}&quot;</span>;
    case "number":
      return <span className={styles.number}>{value}</span>;
    case "boolean":
      return <span className={styles.boolean}>{String(value)}</span>;
    default:
      return <span className={styles.string}>{truncate(JSON.stringify(value))}</span>;
  }
}

interface Container {
  kind: "object" | "array";
  entries: Array<{ key: string; value: JsonValue }>;
}

function getContainer(value: JsonValue): Container | null {
  if (Array.isArray(value)) {
    return { kind: "array", entries: value.map((v, i) => ({ key: String(i), value: v })) };
  }
  if (typeof value === "object" && value !== null) {
    return {
      kind: "object",
      entries: Object.entries(value).map(([key, v]) => ({ key, value: v })),
    };
  }
  return null;
}

function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${depth * 14}px` };
}

function truncate(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
