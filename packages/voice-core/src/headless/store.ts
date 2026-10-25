/**
 * A minimal observable value, shaped for React's `useSyncExternalStore`:
 * `getSnapshot` returns the same object until `set` replaces it, so a
 * selector-free subscriber re-renders only on real changes.
 */
export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  set(next: Partial<T> | ((prev: T) => Partial<T>)): void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const patch = typeof next === "function" ? next(state) : next;
      let changed = false;
      for (const key in patch) {
        if (!Object.is(patch[key], state[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
  };
}
