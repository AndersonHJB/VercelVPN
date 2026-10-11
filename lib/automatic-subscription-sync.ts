export type AutomaticSyncPhase =
  | "idle"
  | "waiting"
  | "refreshing"
  | "connected"
  | "paused"
  | "auth-error"
  | "error";

export type AutomaticSyncState = {
  phase: AutomaticSyncPhase;
  lastSyncedAt: number | null;
  error?: string;
};

export class AutomaticSyncHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AutomaticSyncHttpError";
  }
}

type TimerHandle = ReturnType<typeof setTimeout>;

type AutomaticSyncOptions<T> = {
  load: (password: string, signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onState: (state: AutomaticSyncState) => void;
  isVisible: () => boolean;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancelSchedule?: (handle: TimerHandle) => void;
  now?: () => number;
  debounceMs?: number;
  intervalMs?: number;
};

export function createAutomaticSubscriptionSync<T>(options: AutomaticSyncOptions<T>) {
  const schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule || clearTimeout;
  const now = options.now || Date.now;
  const debounceMs = options.debounceMs ?? 600;
  const intervalMs = options.intervalMs ?? 30_000;
  let state: AutomaticSyncState = { phase: "idle", lastSyncedAt: null };
  let password = "";
  let initialized = false;
  let stopped = false;
  let halted = false;
  let generation = 0;
  let revision = 0;
  let pendingMutations = 0;
  let debounceUntil = 0;
  let queued = false;
  let timer: TimerHandle | null = null;
  let activeRequest: { generation: number; revision: number; controller: AbortController } | null = null;

  function emit(next: AutomaticSyncState) {
    if (stopped) return;
    state = next;
    options.onState(next);
  }

  function clearTimer() {
    if (timer !== null) cancelSchedule(timer);
    timer = null;
  }

  function cancelRequest() {
    const previous = activeRequest;
    activeRequest = null;
    previous?.controller.abort();
  }

  function scheduleRefresh(delay: number) {
    clearTimer();
    timer = schedule(() => {
      timer = null;
      refresh();
    }, delay);
  }

  function isCurrent(request: NonNullable<typeof activeRequest>) {
    return !stopped && request === activeRequest && request.generation === generation &&
      request.revision === revision && pendingMutations === 0 && options.isVisible();
  }

  function refresh() {
    if (stopped || halted || !password) return;
    clearTimer();

    if (!options.isVisible()) {
      cancelRequest();
      queued = false;
      emit({ ...state, phase: "paused" });
      return;
    }

    if (pendingMutations > 0) {
      queued = true;
      return;
    }

    const debounceRemaining = debounceUntil - now();

    if (debounceRemaining > 0) {
      scheduleRefresh(debounceRemaining);
      return;
    }

    if (activeRequest) {
      queued = true;
      return;
    }

    queued = false;
    const request = { generation, revision, controller: new AbortController() };
    const requestPassword = password;
    activeRequest = request;
    emit({ ...state, phase: "refreshing", error: undefined });

    void (async () => {
      try {
        const data = await options.load(requestPassword, request.controller.signal);

        if (!isCurrent(request)) return;
        options.onData(data);
        emit({ phase: "connected", lastSyncedAt: now() });
      } catch (caught) {
        if (!isCurrent(request)) return;

        const status = caught && typeof caught === "object" && "status" in caught ? caught.status : undefined;
        const error = caught instanceof Error ? caught.message : "自动同步失败";

        if (status === 401 || status === 403) {
          halted = true;
          queued = false;
          emit({ ...state, phase: "auth-error", error });
        } else {
          emit({ ...state, phase: "error", error });
        }
      } finally {
        if (activeRequest !== request) return;
        activeRequest = null;

        if (stopped || halted || !password || pendingMutations > 0 || !options.isVisible()) return;

        if (queued) {
          queued = false;
          refresh();
        } else {
          scheduleRefresh(intervalMs);
        }
      }
    })();
  }

  function setPassword(value: string) {
    if (stopped || (initialized && value === password)) return;
    initialized = true;
    password = value;
    generation += 1;
    halted = false;
    queued = false;
    debounceUntil = now() + debounceMs;
    clearTimer();
    cancelRequest();
    emit({ phase: value ? (options.isVisible() ? "waiting" : "paused") : "idle", lastSyncedAt: null });

    if (value && options.isVisible()) scheduleRefresh(debounceMs);
  }

  function visibilityChanged() {
    if (stopped || !password) return;

    if (!options.isVisible()) {
      clearTimer();
      cancelRequest();
      queued = false;
      if (!halted) emit({ ...state, phase: "paused" });
      return;
    }

    refresh();
  }

  function beginMutation() {
    if (stopped) return;
    pendingMutations += 1;
    revision += 1;
    queued = true;
    clearTimer();
    cancelRequest();

    if (password && !halted) {
      emit({ ...state, phase: options.isVisible() ? (state.lastSyncedAt === null ? "waiting" : "connected") : "paused" });
    }
  }

  function endMutation() {
    if (stopped) return;
    pendingMutations = Math.max(0, pendingMutations - 1);
    revision += 1;
    if (pendingMutations === 0) refresh();
  }

  function invalidatePendingRead() {
    if (stopped) return;
    revision += 1;
    clearTimer();
    cancelRequest();
    refresh();
  }

  function stop() {
    stopped = true;
    generation += 1;
    queued = false;
    clearTimer();
    cancelRequest();
  }

  return { setPassword, refresh, visibilityChanged, beginMutation, endMutation, invalidatePendingRead, stop };
}
