"use client";

import { useState } from "react";
import type { DiffNode } from "@/protocol/diff";
import { cx } from "@/lib/classNames";
import { JsonTree, ValueChip } from "./JsonTree";
import styles from "./DiffTreeView.module.css";

export function DiffTreeView({ node, rootLabel = "root" }: { node: DiffNode; rootLabel?: string }) {
  return (
    <div className={styles.tree}>
      <DiffNodeView name={rootLabel} node={node} depth={0} />
    </div>
  );
}

function DiffNodeView({ name, node, depth }: { name: string; node: DiffNode; depth: number }) {
  const style = { paddingLeft: `${depth * 14}px` };

  if (node.status === "changed" && node.kind === "primitive") {
    return (
      <div className={styles.line} style={style}>
        <span className={styles.markerChanged}>~</span>
        <span className={styles.key}>{name}:</span>{" "}
        <span className={styles.prev}>
          <ValueChip value={node.prev} />
        </span>
        <span className={styles.arrow}>→</span>
        <span className={styles.curr}>
          <ValueChip value={node.curr} />
        </span>
      </div>
    );
  }

  if (node.status === "changed") {
    return <ChangedContainer name={name} node={node} depth={depth} />;
  }

  const marker = node.status === "added" ? "+" : node.status === "removed" ? "-" : " ";
  const markerClass =
    node.status === "added"
      ? styles.markerAdded
      : node.status === "removed"
        ? styles.markerRemoved
        : styles.markerNone;

  return (
    <div className={cx(styles.subtree, styles[node.status])} style={style}>
      <span className={markerClass}>{marker}</span>
      <div className={styles.subtreeBody}>
        <JsonTree value={node.value} rootLabel={name} defaultExpandDepth={node.status === "unchanged" ? 0 : 1} />
      </div>
    </div>
  );
}

function ChangedContainer({
  name,
  node,
  depth,
}: {
  name: string;
  node: Extract<DiffNode, { status: "changed"; kind: "object" | "array" }>;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const summary = node.kind === "array" ? `[ ${node.children.length} ]` : `{ ${node.children.length} }`;
  return (
    <div>
      <div
        className={cx(styles.line, styles.clickable)}
        style={{ paddingLeft: `${depth * 14}px` }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.markerChanged}>~</span>
        <span className={styles.toggle}>{open ? "▾" : "▸"}</span>
        <span className={styles.key}>{name}</span>
        <span className={styles.summary}>{summary}</span>
      </div>
      {open &&
        node.children.map((child) => (
          <DiffNodeView key={child.key} name={child.key} node={child.node} depth={depth + 1} />
        ))}
    </div>
  );
}
