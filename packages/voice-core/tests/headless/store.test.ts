import { describe, expect, it } from "vitest";
import { createStore } from "../../src/headless/store";

describe("createStore", () => {
  it("notifies only on real changes and keeps the snapshot stable otherwise", () => {
    const store = createStore({ a: 1, b: "x" });
    let calls = 0;
    store.subscribe(() => calls++);
    const before = store.getSnapshot();
    store.set({ a: 1 });
    expect(store.getSnapshot()).toBe(before);
    store.set((s) => ({ a: s.a + 1 }));
    expect(store.getSnapshot()).toEqual({ a: 2, b: "x" });
    expect(calls).toBe(1);
  });
});
