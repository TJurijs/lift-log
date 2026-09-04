/** Minimal deterministic Web Locks adapter for browser behavior tests. */
export function createTestLockManager(): LockManager {
  const held = new Set<string>();
  return {
    async request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) {
      if (!options.ifAvailable) throw new Error("This test adapter requires ifAvailable");
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name, mode: "exclusive" } as Lock);
      } finally {
        held.delete(name);
      }
    },
  } as LockManager;
}
