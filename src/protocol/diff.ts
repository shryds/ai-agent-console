import type { JsonValue } from "./types";


export type DiffStatus = "unchanged" | "added" | "removed" | "changed";

export interface DiffEntry {
  key: string;
  node: DiffNode;
}

export type DiffNode =
  | { status: "unchanged" | "added" | "removed"; value: JsonValue }
  | { status: "changed"; kind: "primitive"; prev: JsonValue; curr: JsonValue }
  | {
      status: "changed";
      kind: "object" | "array";
      prev: JsonValue;
      curr: JsonValue;
      children: DiffEntry[];
    };

function isPlainObject(v: JsonValue | undefined): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return a === b;

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (ta === "object") {
    const oa = a as { [k: string]: JsonValue };
    const ob = b as { [k: string]: JsonValue };
    const ka = Object.keys(oa);
    const kb = Object.keys(ob);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(ob, k)) return false;
      if (!deepEqual(oa[k], ob[k])) return false;
    }
    return true;
  }

  return false;
}


export function diffNode(prev: JsonValue | undefined, curr: JsonValue | undefined): DiffNode {
  if (prev === undefined) return { status: "added", value: curr ?? null };
  if (curr === undefined) return { status: "removed", value: prev };
  if (deepEqual(prev, curr)) return { status: "unchanged", value: curr };

  if (isPlainObject(prev) && isPlainObject(curr)) {
    return {
      status: "changed",
      kind: "object",
      prev,
      curr,
      children: diffObjectChildren(prev, curr),
    };
  }
  if (Array.isArray(prev) && Array.isArray(curr)) {
    return {
      status: "changed",
      kind: "array",
      prev,
      curr,
      children: diffArrayChildren(prev, curr),
    };
  }
  return { status: "changed", kind: "primitive", prev, curr };
}

function diffObjectChildren(
  prev: { [k: string]: JsonValue },
  curr: { [k: string]: JsonValue },
): DiffEntry[] {
  const keys = new Set<string>([...Object.keys(prev), ...Object.keys(curr)]);
  const entries: DiffEntry[] = [];
  for (const key of keys) {
    entries.push({ key, node: diffNode(prev[key], curr[key]) });
  }
  entries.sort((a, b) => {
    const wa = a.node.status === "unchanged" ? 1 : 0;
    const wb = b.node.status === "unchanged" ? 1 : 0;
    if (wa !== wb) return wa - wb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return entries;
}

function diffArrayChildren(prev: JsonValue[], curr: JsonValue[]): DiffEntry[] {
  const len = Math.max(prev.length, curr.length);
  const entries: DiffEntry[] = [];
  for (let i = 0; i < len; i++) {
    entries.push({ key: String(i), node: diffNode(prev[i], curr[i]) });
  }
  return entries;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
}

export function summarizeDiff(node: DiffNode): DiffSummary {
  const acc: DiffSummary = { added: 0, removed: 0, changed: 0 };
  walk(node, acc);
  return acc;
}

function walk(node: DiffNode, acc: DiffSummary): void {
  switch (node.status) {
    case "unchanged":
      return;
    case "added":
      acc.added++;
      return;
    case "removed":
      acc.removed++;
      return;
    case "changed":
      if (node.kind === "primitive") {
        acc.changed++;
        return;
      }
      for (const entry of node.children) walk(entry.node, acc);
      return;
  }
}
