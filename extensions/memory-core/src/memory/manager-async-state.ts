export function startAsyncSearchSync(params: {
  enabled: boolean;
  dirty: boolean;
  sessionsDirty: boolean;
  sync: (params: { reason: string }) => Promise<void>;
  onError: (err: unknown) => void;
}): void {
  if (!params.enabled || (!params.dirty && !params.sessionsDirty)) {
    return;
  }
  void params.sync({ reason: "search" }).catch((err) => {
    params.onError(err);
  });
}

/** Kick a cold-index build off the current tick.
 *
 * A cold sync is long and largely blocking (node:sqlite is synchronous), so
 * awaiting it inside a request stalls every other request the host process is
 * serving (gateway RPCs included). Deferring to a timer lets pending responses
 * and queued requests drain first. */
export function startBackgroundGraphSync(params: {
  hasIndexedContent: boolean;
  sync: (params: { reason: string; force: boolean }) => Promise<void>;
  onError: (err: unknown) => void;
}): void {
  if (params.hasIndexedContent) {
    return;
  }
  const timer = setTimeout(() => {
    void params.sync({ reason: "graph", force: true }).catch((err) => {
      params.onError(err);
    });
  }, 0);
  timer.unref?.();
}

export async function awaitPendingManagerWork(params: {
  pendingSync?: Promise<void> | null;
  pendingProviderInit?: Promise<void> | null;
}): Promise<void> {
  if (params.pendingSync) {
    try {
      await params.pendingSync;
    } catch {}
  }
  if (params.pendingProviderInit) {
    try {
      await params.pendingProviderInit;
    } catch {}
  }
}
