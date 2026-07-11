import { describe, it, expect } from "vitest";
import { diffNode, deepEqual, summarizeDiff } from "./diff";
import type { JsonValue } from "./types";

describe("deepEqual", () => {
  it("compares primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, 0)).toBe(false);
  });

  it("distinguishes value from type (0 vs false vs '')", () => {
    expect(deepEqual(0 as JsonValue, false as JsonValue)).toBe(false);
    expect(deepEqual("" as JsonValue, false as JsonValue)).toBe(false);
  });

  it("compares nested structures", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
  });

  it("treats arrays of differing length as unequal", () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe("diffNode", () => {
  it("marks unchanged when equal", () => {
    const node = diffNode({ a: 1 }, { a: 1 });
    expect(node.status).toBe("unchanged");
  });

  it("detects an added key", () => {
    const node = diffNode({ a: 1 }, { a: 1, b: 2 });
    if (node.status !== "changed" || node.kind !== "object") throw new Error("expected object diff");
    const added = node.children.find((c) => c.key === "b");
    expect(added?.node.status).toBe("added");
  });

  it("detects a removed key", () => {
    const node = diffNode({ a: 1, b: 2 }, { a: 1 });
    if (node.status !== "changed" || node.kind !== "object") throw new Error("expected object diff");
    const removed = node.children.find((c) => c.key === "b");
    expect(removed?.node.status).toBe("removed");
  });

  it("detects a changed primitive with prev/curr", () => {
    const node = diffNode({ a: 1 }, { a: 2 });
    if (node.status !== "changed" || node.kind !== "object") throw new Error("expected object diff");
    const changed = node.children.find((c) => c.key === "a");
    expect(changed?.node.status).toBe("changed");
    if (changed?.node.status === "changed" && changed.node.kind === "primitive") {
      expect(changed.node.prev).toBe(1);
      expect(changed.node.curr).toBe(2);
    } else {
      throw new Error("expected primitive change");
    }
  });

  it("recurses into nested objects and only flags the changed leaf", () => {
    const prev = { meta: { a: 1, b: 2 }, keep: "same" };
    const curr = { meta: { a: 1, b: 3 }, keep: "same" };
    const summary = summarizeDiff(diffNode(prev, curr));
    expect(summary).toEqual({ added: 0, removed: 0, changed: 1 });
  });

  it("handles a type change (object → primitive) as a primitive change", () => {
    const node = diffNode({ a: { nested: true } }, { a: 5 });
    if (node.status !== "changed" || node.kind !== "object") throw new Error("expected object diff");
    const changed = node.children.find((c) => c.key === "a");
    expect(changed?.node.status).toBe("changed");
    if (changed?.node.status === "changed") expect(changed.node.kind).toBe("primitive");
  });

  it("summarizes mixed add/remove/change", () => {
    const prev = { keep: 1, drop: 2, mutate: 3 };
    const curr = { keep: 1, add: 9, mutate: 4 };
    expect(summarizeDiff(diffNode(prev, curr))).toEqual({ added: 1, removed: 1, changed: 1 });
  });

  it("diffs arrays positionally", () => {
    const node = diffNode([1, 2, 3], [1, 9, 3]);
    if (node.status !== "changed" || node.kind !== "array") throw new Error("expected array diff");
    expect(node.children[1]?.node.status).toBe("changed");
    expect(node.children[0]?.node.status).toBe("unchanged");
  });
});
