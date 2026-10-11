import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { createAutomaticSubscriptionSync } from "../lib/automatic-subscription-sync";

type CloudData = { version: string };
type SyncState = { phase: string; lastSyncedAt: number | null; error?: string };

class ManualClock {
  now = 1_700_000_000_000;
  private nextId = 0;
  private jobs = new Map<number, { due: number; callback: () => void }>();

  schedule = (callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
    const id = ++this.nextId;
    this.jobs.set(id, { due: this.now + delay, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  cancelSchedule = (id: ReturnType<typeof setTimeout>) => {
    this.jobs.delete(Number(id));
  };

  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    let iterations = 0;
    while (true) {
      const next = [...this.jobs.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > target) break;
      assert.ok(++iterations < 1_000, "A refresh must not create an immediate retry loop.");
      this.jobs.delete(next[0]);
      this.now = next[1].due;
      next[1].callback();
    }
    this.now = target;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let count = 0; count < 8; count++) await Promise.resolve();
}

function fixture(context: TestContext) {
  const clock = new ManualClock();
  const requests: Array<ReturnType<typeof deferred<CloudData>> & { password: string; signal: AbortSignal }> = [];
  const applied: string[] = [];
  const states: SyncState[] = [];
  let visible = true;
  const controller = createAutomaticSubscriptionSync<CloudData>({
    load: (password, signal) => {
      const pending = deferred<CloudData>();
      requests.push({ ...pending, password, signal });
      // Ignore abort deliberately: a late transport response must still be discarded.
      return pending.promise;
    },
    onData: (data) => { applied.push(data.version); },
    onState: (state) => { states.push(state); },
    isVisible: () => visible,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
    now: () => clock.now
  });
  context.after(() => controller.stop());
  return {
    controller,
    clock,
    requests,
    applied,
    get state() {
      const latest = states.at(-1);
      assert.ok(latest, "The controller must report its state.");
      return latest;
    },
    setVisible(value: boolean) { visible = value; }
  };
}

test("automatic refresh waits for a stable password and only sends the latest value", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(599);
  await settle();
  assert.equal(sync.requests.length, 0);
  sync.controller.setPassword("admin-b");
  sync.clock.advance(599);
  await settle();
  assert.equal(sync.requests.length, 0);
  sync.clock.advance(1);
  await settle();
  assert.equal(sync.requests.length, 1);
  assert.equal(sync.requests[0].password, "admin-b");
});

test("changing passwords aborts the previous request and ignores its late response", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  const oldRequest = sync.requests[0];
  assert.ok(oldRequest);
  sync.controller.setPassword("admin-b");
  assert.equal(oldRequest.signal.aborted, true);
  sync.clock.advance(600);
  await settle();
  assert.equal(sync.requests.length, 2);
  assert.equal(sync.requests[1].password, "admin-b");
  sync.requests[1].resolve({ version: "new-password-data" });
  await settle();
  oldRequest.resolve({ version: "old-password-data" });
  await settle();
  assert.deepEqual(sync.applied, ["new-password-data"]);
  assert.equal(sync.state.phase, "connected");
  assert.equal(sync.state.lastSyncedAt, sync.clock.now);
});

test("clearing the password cancels all reads and does not apply an outstanding response", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.controller.setPassword("");
  assert.equal(sync.requests[0].signal.aborted, true);
  sync.requests[0].resolve({ version: "old-session" });
  await settle();
  sync.clock.advance(90_000);
  sync.controller.refresh();
  await settle();
  assert.equal(sync.requests.length, 1);
  assert.deepEqual(sync.applied, []);
  assert.equal(sync.state.phase, "idle");
});

test("401 and 403 stop polling for the current password until it changes", async (context) => {
  for (const status of [401, 403]) {
    const sync = fixture(context);
    sync.controller.setPassword("rejected-password");
    sync.clock.advance(600);
    await settle();
    sync.requests[0].reject(Object.assign(new Error("Authentication failed"), { status }));
    await settle();
    assert.equal(sync.state.phase, "auth-error", `HTTP ${status}`);
    sync.clock.advance(90_000);
    sync.controller.refresh();
    sync.setVisible(false);
    sync.controller.visibilityChanged();
    sync.setVisible(true);
    sync.controller.visibilityChanged();
    sync.controller.setPassword("rejected-password");
    sync.clock.advance(600);
    await settle();
    assert.equal(sync.requests.length, 1, `HTTP ${status} must not repeatedly send a rejected password.`);
    sync.controller.setPassword("corrected-password");
    sync.clock.advance(600);
    await settle();
    assert.equal(sync.requests.length, 2);
    assert.equal(sync.requests[1].password, "corrected-password");
  }
});

test("hidden pages abort and pause reads, then refresh immediately when visible", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.setVisible(false);
  sync.controller.visibilityChanged();
  assert.equal(sync.requests[0].signal.aborted, true);
  assert.equal(sync.state.phase, "paused");
  sync.clock.advance(90_000);
  sync.controller.refresh();
  sync.requests[0].resolve({ version: "hidden-stale-data" });
  await settle();
  assert.equal(sync.requests.length, 1);
  assert.deepEqual(sync.applied, []);
  sync.setVisible(true);
  sync.controller.visibilityChanged();
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.requests[1].resolve({ version: "visible-data" });
  await settle();
  assert.deepEqual(sync.applied, ["visible-data"]);
  sync.clock.advance(29_999);
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.clock.advance(1);
  await settle();
  assert.equal(sync.requests.length, 3, "The visible page must resume its 30 second refresh interval.");
});

test("a pending refresh cannot overwrite a renewal or revocation, and mutation completion triggers a fresh read", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.controller.beginMutation();
  assert.equal(sync.requests[0].signal.aborted, true);
  sync.controller.refresh();
  sync.clock.advance(90_000);
  sync.requests[0].resolve({ version: "before-renewal" });
  await settle();
  assert.equal(sync.requests.length, 1, "Cloud reads must wait for the local mutation to complete.");
  assert.deepEqual(sync.applied, []);
  sync.controller.endMutation();
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.requests[1].resolve({ version: "after-renewal" });
  await settle();
  assert.deepEqual(sync.applied, ["after-renewal"]);
  assert.equal(sync.state.phase, "connected");
});

test("multiple focus or refresh events share one in-flight read and queue only one follow-up", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.controller.refresh();
  sync.controller.refresh();
  sync.controller.refresh();
  await settle();
  assert.equal(sync.requests.length, 1);
  sync.requests[0].resolve({ version: "first-read" });
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.requests[1].resolve({ version: "queued-read" });
  await settle();
  assert.deepEqual(sync.applied, ["first-read", "queued-read"]);
  assert.equal(sync.requests.length, 2);
});

test("temporary network failures retry at the normal interval without discarding applied data", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.requests[0].resolve({ version: "saved-data" });
  await settle();
  sync.controller.refresh();
  await settle();
  sync.requests[1].reject(new Error("Temporary network error"));
  await settle();
  assert.equal(sync.state.phase, "error");
  assert.deepEqual(sync.applied, ["saved-data"]);
  sync.clock.advance(29_999);
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.clock.advance(1);
  await settle();
  assert.equal(sync.requests.length, 3);
});

test("stopping automatic refresh aborts reads and prevents late data or future polling", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.controller.stop();
  assert.equal(sync.requests[0].signal.aborted, true);
  sync.requests[0].resolve({ version: "unmounted-data" });
  await settle();
  sync.clock.advance(90_000);
  sync.controller.refresh();
  await settle();
  assert.deepEqual(sync.applied, []);
  assert.equal(sync.requests.length, 1);
});

test("an old password's late error cannot change a new session or reschedule its polling", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  const oldRequest = sync.requests[0];
  sync.controller.setPassword("admin-b");
  sync.clock.advance(600);
  await settle();
  sync.requests[1].resolve({ version: "current-session" });
  await settle();
  const lastSyncedAt = sync.state.lastSyncedAt;
  sync.clock.advance(15_000);
  oldRequest.reject(Object.assign(new Error("Old session failed"), { status: 401 }));
  await settle();
  assert.equal(sync.state.phase, "connected");
  assert.equal(sync.state.lastSyncedAt, lastSyncedAt);
  assert.deepEqual(sync.applied, ["current-session"]);
  sync.clock.advance(14_999);
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.clock.advance(1);
  await settle();
  assert.equal(sync.requests.length, 3, "The old request's finally block must not disturb the current session's timer.");
  assert.equal(sync.requests[2].password, "admin-b");
});

test("a local or cross-tab data change invalidates a pending cloud snapshot before refreshing", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.controller.invalidatePendingRead();
  assert.equal(sync.requests[0].signal.aborted, true);
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.requests[1].resolve({ version: "after-storage-change" });
  await settle();
  sync.requests[0].resolve({ version: "before-storage-change" });
  await settle();
  assert.deepEqual(sync.applied, ["after-storage-change"]);
});

test("overlapping mutations resume cloud reads only after both operations finish", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  sync.controller.beginMutation();
  sync.controller.beginMutation();
  sync.controller.endMutation();
  sync.controller.refresh();
  await settle();
  assert.equal(sync.requests.length, 1);
  sync.controller.endMutation();
  await settle();
  assert.equal(sync.requests.length, 2);
  sync.requests[1].resolve({ version: "after-both-mutations" });
  await settle();
  sync.requests[0].resolve({ version: "before-mutations" });
  await settle();
  assert.deepEqual(sync.applied, ["after-both-mutations"]);
});

test("changing passwords during a mutation waits for completion before reading the new session", async (context) => {
  const sync = fixture(context);
  sync.controller.setPassword("admin-a");
  sync.clock.advance(600);
  await settle();
  const oldSessionRequest = sync.requests[0];
  sync.controller.beginMutation();
  sync.controller.setPassword("admin-b");
  sync.clock.advance(600);
  await settle();
  assert.equal(oldSessionRequest.signal.aborted, true);
  assert.equal(sync.requests.length, 1, "Password changes must preserve the active mutation guard.");
  sync.controller.endMutation();
  await settle();
  assert.equal(sync.requests.length, 2);
  assert.equal(sync.requests[1].password, "admin-b");
  sync.requests[1].resolve({ version: "new-session-after-mutation" });
  await settle();
  oldSessionRequest.resolve({ version: "old-session-before-mutation" });
  await settle();
  assert.deepEqual(sync.applied, ["new-session-after-mutation"]);
  assert.equal(sync.state.phase, "connected");
});
