import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { POST as createLink } from "../app/api/links/route";
import { POST as extendLink } from "../app/api/extend-link/route";
import { POST as invalidateLink } from "../app/api/invalidate-link/route";
import { POST as linkStatus } from "../app/api/link-status/route";
import { POST as subscriptions } from "../app/api/subscriptions/route";
import { GET as getSubscription } from "../app/api/subscription/[token]/route";

import {
  hashSubscriptionToken,
  readSubscriptions,
  StorageError,
  updateSubscriptions,
  type SubscriptionDocument,
  type SubscriptionRecord
} from "../lib/github-store";
import {
  extendStoredSubscription,
  invalidateStoredSubscription,
  makeSubscriptionRecord,
  resolveSubscription,
  syncSubscriptions
} from "../lib/subscriptions";
import { createSignedToken, type LinkPayload } from "../lib/token";

const secretA = "deployment-a-original-signing-secret-32-characters";
const secretB = "deployment-b-original-signing-secret-32-characters";
const originA = "https://v.bornforthis.cn";
const originB = "https://v.other.us.brclio.com";
const originalFetch = globalThis.fetch;
let originalEnv: NodeJS.ProcessEnv;

type GitHubCall = { path: string; method: string; init?: RequestInit; body?: Record<string, unknown> };

class GitHubFixture {
  document: SubscriptionDocument | null = { version: 1, records: {} };
  revision = 1;
  private = true;
  repoStatus = 200;
  branchStatus = 200;
  readStatus: number | undefined;
  writeStatus: number | undefined;
  invalidContent: string | undefined;
  conflict: (() => void) | undefined;
  calls: GitHubCall[] = [];
  writes = 0;

  get sha() { return `sha-${this.revision}`; }

  install() {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      assert.equal(url.origin, "https://api.github.com", "Tests must never access the live network.");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-github-token");
      assert.equal(init?.cache, "no-store", "Revocations must not be hidden by a cached GitHub response.");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      const call = { path: url.pathname, method, init, body };
      this.calls.push(call);
      const json = (value: unknown, status = 200) => Response.json(value, { status });
      if (url.pathname === "/repos/test-owner/private-subscriptions") {
        return json({ private: this.private }, this.repoStatus);
      }
      if (url.pathname === "/repos/test-owner/private-subscriptions/branches/main") {
        return json({ name: "main" }, this.branchStatus);
      }
      assert.equal(url.pathname, "/repos/test-owner/private-subscriptions/contents/subscriptions/links.json");
      if (method === "GET") {
        assert.equal(url.searchParams.get("ref"), "main");
        if (this.readStatus) return json({ message: "Read failed" }, this.readStatus);
        if (!this.document) return json({ message: "Not found" }, 404);
        return json({
          type: "file",
          sha: this.sha,
          encoding: "base64",
          content: Buffer.from(this.invalidContent ?? JSON.stringify(this.document)).toString("base64")
        });
      }
      assert.equal(method, "PUT");
      assert.ok(body);
      this.writes++;
      if (this.conflict) {
        const conflict = this.conflict;
        this.conflict = undefined;
        conflict();
        this.revision++;
        return json({ message: "SHA has changed" }, 409);
      }
      if (this.writeStatus) return json({ message: "Write failed" }, this.writeStatus);
      assert.equal(body.sha, this.document ? this.sha : undefined);
      assert.equal(body.branch, "main");
      this.document = JSON.parse(Buffer.from(String(body.content), "base64").toString("utf8"));
      this.revision++;
      return json({ content: { sha: this.sha } }, 200);
    }) as typeof fetch;
    return this;
  }

  put(record: SubscriptionRecord) {
    this.document ??= { version: 1, records: {} };
    this.document.records[hashSubscriptionToken(record.token)] = structuredClone(record);
  }

  record(token: string) {
    const record = this.document?.records[hashSubscriptionToken(token)];
    assert.ok(record);
    return record;
  }
}

function sampleLink(options: { secret?: string; exp?: number; nonce?: string; origin?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload: LinkPayload = { v: 1, iat: now - 3600, exp: options.exp ?? now + 3600, nonce: options.nonce ?? "legacy-link", label: "Original label" };
  const token = createSignedToken(payload, options.secret ?? secretA);
  return { now, payload, token, url: `${options.origin ?? originA}/api/subscription/${token}` };
}

function request(origin = originA) {
  return new Request(`${origin}/api/subscriptions`, { method: "POST" });
}

function adminRequest(endpoint: string, body: unknown, origin = originA) {
  return new Request(`${origin}/api/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function authorized(body: Record<string, unknown>) {
  return { password: "test-admin-password", ...body };
}

function download(token: string, origin = originA) {
  return getSubscription(new Request(`${origin}/api/subscription/${token}`), { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  originalEnv = { ...process.env };
  for (const name of ["GITHUB_STORAGE_REPO", "GITHUB_STORAGE_TOKEN", "GITHUB_STORAGE_BRANCH", "GITHUB_STORAGE_PATH", "LINK_REVOCATION_UPSTASH_REST_URL", "LINK_REVOCATION_UPSTASH_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN", "REVOKED_LINKS_FILE_PATH", "MAX_LINK_TTL_DAYS"]) delete process.env[name];
  process.env.GITHUB_STORAGE_REPO = "test-owner/private-subscriptions";
  process.env.GITHUB_STORAGE_TOKEN = "test-github-token";
  process.env.LINK_SECRET = secretA;
  process.env.ADMIN_PASSWORD = "test-admin-password";
  process.env.YAML_CONTENT = "proxies: []\n";
  process.env.VERCEL = "1";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
});

test("unmigrated subscriptions retain HMAC validation and original expiry", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  const resolved = await resolveSubscription(link.token, link.now);
  assert.ok(resolved.ok);
  assert.equal(resolved.record, undefined);
  assert.equal(resolved.expired, false);
  assert.equal(resolved.expiresAtSeconds, link.payload.exp);
  assert.equal(github.writes, 0);

  process.env.LINK_SECRET = secretB;
  const foreign = await resolveSubscription(link.token, link.now);
  assert.equal(foreign.ok, false, "An untrusted token must not gain access before migration.");
  if (!foreign.ok) assert.equal(foreign.status, 403);
});

test("legacy subscriptions remain available before GitHub storage is configured", async () => {
  delete process.env.GITHUB_STORAGE_REPO;
  delete process.env.GITHUB_STORAGE_TOKEN;
  globalThis.fetch = async () => { throw new Error("No storage request should occur."); };
  const link = sampleLink();
  const resolved = await resolveSubscription(link.token, link.now);
  assert.ok(resolved.ok);
  assert.equal(resolved.expired, false);
});

test("each deployment admits only its signed cache while keeping both original URLs", async () => {
  const github = new GitHubFixture().install();
  const first = sampleLink();
  const second = sampleLink({ secret: secretB, nonce: "other-domain", origin: originB });
  const firstResult = await syncSubscriptions([first, second], request());
  assert.equal(firstResult.imported, 1);
  assert.equal(firstResult.rejected.length, 1);
  assert.equal(firstResult.rejected[0].index, 1);
  assert.equal(github.record(first.token).url, first.url);

  process.env.LINK_SECRET = secretB;
  const secondResult = await syncSubscriptions([second], request(originB));
  assert.equal(secondResult.imported, 1);
  assert.equal(github.record(second.token).url, second.url);
  const crossDomain = await resolveSubscription(first.token, first.now);
  assert.ok(crossDomain.ok, "An exact token admitted by the other trusted deployment must work.");
  assert.equal(crossDomain.invalidated, false);
  assert.equal(Object.keys(github.document!.records).length, 2);
});

test("an expired cached token can be renewed at the same token and URL", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink({ exp: Math.floor(Date.now() / 1000) - 60 });
  const migration = await syncSubscriptions([link], request());
  assert.equal(migration.imported, 1);
  const expired = await resolveSubscription(link.token, link.now);
  assert.ok(expired.ok);
  assert.equal(expired.expired, true);

  const renewed = await extendStoredSubscription(link.token, link.payload, link.url, { ttlMinutes: 60 }, link.now);
  assert.equal(renewed.token, link.token);
  assert.equal(renewed.url, link.url);
  assert.equal(renewed.wasExpired, true);
  assert.equal(github.record(link.token).payload.exp, link.payload.exp, "The token payload is immutable.");
  const active = await resolveSubscription(link.token, link.now);
  assert.ok(active.ok);
  assert.equal(active.expired, false);
  assert.equal(active.expiresAtSeconds, link.now + 3600);
});

test("repeat cache migration cannot shorten renewal, change label or reopen a revoked subscription", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  await syncSubscriptions([link], request());
  const renewed = await extendStoredSubscription(link.token, link.payload, link.url, { ttlMinutes: 120, label: "Cloud label" }, link.now);
  await invalidateStoredSubscription(link.token, link.payload, link.url, link.now + 1);
  const closedAt = github.record(link.token).invalidatedAt;

  process.env.LINK_SECRET = secretB;
  const secondUrl = `${originB}/api/subscription/${link.token}`;
  const result = await syncSubscriptions([{ ...link, url: secondUrl, label: "Stale browser label", invalidatedAt: undefined }], request(originB));
  assert.equal(result.existing, 1);
  assert.equal(result.imported, 0);
  assert.equal(github.record(link.token).expiresAt, renewed.expiresAt);
  assert.equal(github.record(link.token).label, "Cloud label");
  assert.equal(github.record(link.token).invalidatedAt, closedAt);
  assert.equal(github.record(link.token).url, link.url);
  assert.deepEqual(github.record(link.token).urls, [link.url, secondUrl]);
  const closed = await resolveSubscription(link.token, link.now + 2);
  assert.ok(closed.ok);
  assert.equal(closed.invalidated, true);
});

test("migration preserves a browser's existing invalidated flag", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  const invalidatedAt = new Date((link.now - 60) * 1000).toISOString();
  await syncSubscriptions([{ ...link, invalidatedAt }], request());
  assert.equal(github.record(link.token).invalidatedAt, invalidatedAt);
  const resolved = await resolveSubscription(link.token, link.now);
  assert.ok(resolved.ok);
  assert.equal(resolved.invalidated, true);
});

test("retrying one renewal operation does not extend the subscription twice", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  const input = { ttlMinutes: 30, operationId: "renewal-operation-123456789" };
  const first = await extendStoredSubscription(link.token, link.payload, link.url, input, link.now);
  const writes = github.writes;
  const retry = await extendStoredSubscription(link.token, link.payload, link.url, input, link.now);
  assert.equal(retry.expiresAt, first.expiresAt);
  assert.equal(github.writes, writes);
});

test("GitHub SHA conflicts reapply mutation to the latest document without losing another deployment's data", async () => {
  const github = new GitHubFixture().install();
  const first = sampleLink();
  const second = sampleLink({ nonce: "concurrent-other-deployment", secret: secretB, origin: originB });
  github.conflict = () => github.put(makeSubscriptionRecord(second.token, second.payload, second.url));
  await updateSubscriptions((doc) => {
    doc.records[hashSubscriptionToken(first.token)] = makeSubscriptionRecord(first.token, first.payload, first.url);
  });
  assert.equal(github.writes, 2);
  assert.equal(Object.keys(github.document!.records).length, 2);
  assert.equal(github.record(second.token).url, second.url);
  const writes = github.calls.filter((call) => call.method === "PUT");
  assert.notEqual(writes[0].body?.sha, writes[1].body?.sha);
});

test("a renewal in conflict is calculated from the latest expiry", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  github.put(makeSubscriptionRecord(link.token, link.payload, link.url));
  const concurrentExpiry = link.payload.exp + 3600;
  github.conflict = () => { github.record(link.token).expiresAt = new Date(concurrentExpiry * 1000).toISOString(); };
  const renewed = await extendStoredSubscription(link.token, link.payload, link.url, { ttlMinutes: 30 }, link.now);
  assert.equal(Date.parse(renewed.expiresAt) / 1000, concurrentExpiry + 1800);
  assert.equal(github.writes, 2);
});

test("public repositories are rejected before any subscription data is written", async () => {
  const github = new GitHubFixture().install();
  github.private = false;
  await assert.rejects(() => syncSubscriptions([sampleLink()], request()), StorageError);
  assert.equal(github.writes, 0);
  assert.equal(github.calls.some((call) => call.path.includes("/contents/")), false);
});

test("a GitHub repository or authentication 404 is never treated as an empty store", async () => {
  const github = new GitHubFixture().install();
  github.repoStatus = 404;
  await assert.rejects(() => syncSubscriptions([sampleLink()], request()), StorageError);
  assert.equal(github.writes, 0);
});

test("a missing branch is never treated as an empty subscription document", async () => {
  const github = new GitHubFixture().install();
  github.document = null;
  github.branchStatus = 404;
  await assert.rejects(() => syncSubscriptions([sampleLink()], request()), StorageError);
  assert.equal(github.writes, 0);
});

test("a missing file in an accessible private repository and branch can be initialized", async () => {
  const github = new GitHubFixture().install();
  github.document = null;
  const link = sampleLink();
  const result = await syncSubscriptions([link], request());
  assert.equal(result.imported, 1);
  assert.equal(github.record(link.token).url, link.url);
  assert.equal(github.calls.some((call) => call.path.includes("/branches/")), true);
  assert.equal(github.calls.find((call) => call.method === "PUT")?.body?.sha, undefined);
});

test("corrupt cloud data fails closed without replacing it with browser cache", async () => {
  const github = new GitHubFixture().install();
  github.invalidContent = "{broken-json";
  await assert.rejects(() => syncSubscriptions([sampleLink()], request()), StorageError);
  assert.equal(github.writes, 0);
  assert.equal(github.invalidContent, "{broken-json");
});

test("configured GitHub outages never fall back to a potentially revoked signed token", async () => {
  const github = new GitHubFixture().install();
  github.readStatus = 503;
  await assert.rejects(() => resolveSubscription(sampleLink().token), StorageError);
  assert.equal(github.writes, 0);
});

test("failed GitHub writes leave the existing document unchanged", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  github.put(makeSubscriptionRecord(link.token, link.payload, link.url));
  const before = structuredClone(github.document);
  github.writeStatus = 403;
  await assert.rejects(() => extendStoredSubscription(link.token, link.payload, link.url, { ttlMinutes: 60 }, link.now), StorageError);
  assert.deepEqual(github.document, before);
  github.writeStatus = undefined;
  assert.deepEqual(await readSubscriptions(), before);
});

test("a concurrent revocation cannot be overwritten by a renewal retry", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  github.put(makeSubscriptionRecord(link.token, link.payload, link.url));
  const expiresAt = github.record(link.token).expiresAt;
  github.conflict = () => { github.record(link.token).invalidatedAt = new Date().toISOString(); };
  await assert.rejects(() => extendStoredSubscription(link.token, link.payload, link.url, { ttlMinutes: 60 }, link.now), /invalidated/);
  assert.equal(github.record(link.token).expiresAt, expiresAt);
  assert.ok(github.record(link.token).invalidatedAt);
  assert.equal(github.writes, 1);
});

test("legacy revocation records are retained after migration even if the old store is removed", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  const directory = await mkdtemp(path.join(tmpdir(), "vpn-legacy-revocations-"));
  try {
    const filePath = path.join(directory, "revoked.json");
    process.env.REVOKED_LINKS_FILE_PATH = filePath;
    await writeFile(filePath, JSON.stringify({
      revoked: {
        [hashSubscriptionToken(link.token)]: {
          tokenHash: hashSubscriptionToken(link.token),
          expiresAt: new Date(link.payload.exp * 1000).toISOString(),
          expiresAtSeconds: link.payload.exp,
          invalidatedAt: new Date((link.now - 30) * 1000).toISOString()
        }
      }
    }));
    const before = await resolveSubscription(link.token, link.now);
    assert.ok(before.ok);
    assert.equal(before.invalidated, true);
    await syncSubscriptions([link], request());
    assert.ok(github.record(link.token).invalidatedAt);
    delete process.env.REVOKED_LINKS_FILE_PATH;
    const after = await resolveSubscription(link.token, link.now);
    assert.ok(after.ok);
    assert.equal(after.invalidated, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("all administration APIs reject the wrong password before accessing GitHub", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  const handlers: [string, (request: Request) => Promise<Response>, Record<string, unknown>][] = [
    ["links", createLink, { ttlMinutes: 60 }],
    ["extend-link", extendLink, { link: link.url, ttlMinutes: 60 }],
    ["invalidate-link", invalidateLink, { link: link.url }],
    ["link-status", linkStatus, { link: link.url }],
    ["subscriptions", subscriptions, { action: "sync", links: [link] }]
  ];
  for (const [endpoint, handler, body] of handlers) {
    const response = await handler(adminRequest(endpoint, { ...body, password: "wrong-password" }));
    assert.equal(response.status, 401, endpoint);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal(github.calls.length, 0);
});

test("sync API isolates rejected cache rows and never exposes token payload or operation IDs", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  const response = await subscriptions(adminRequest("subscriptions", authorized({
    action: "sync",
    links: [link, { token: "invalid-signature" }, null, 123, { url: "%malformed" }]
  })));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.imported, 1);
  assert.equal(result.rejected.length, 4);
  assert.deepEqual(result.rejected.map((item: { index: number }) => item.index), [1, 2, 3, 4]);
  assert.equal(Object.keys(github.document!.records).length, 1);
  assert.equal("payload" in result.links[0], false);

  await extendStoredSubscription(link.token, link.payload, link.url, { ttlMinutes: 10, operationId: "hidden-operation-123456789" }, link.now);
  const listResponse = await subscriptions(adminRequest("subscriptions", authorized({ action: "list" })));
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "private, no-store");
  const list = await listResponse.json();
  assert.equal(list.links.length, 1);
  assert.equal("payload" in list.links[0], false);
  assert.equal("extensionOperationIds" in list.links[0], false);
  assert.equal(list.links[0].url, link.url);
});

test("sync API rejects malformed input without changing cloud data", async () => {
  const github = new GitHubFixture().install();
  for (const body of [null, [], authorized({ action: "unknown" }), authorized({ action: "sync", links: {} })]) {
    const response = await subscriptions(adminRequest("subscriptions", body));
    assert.equal(response.status, 400);
  }
  const malformedJson = new Request(`${originA}/api/subscriptions`, { method: "POST", body: "{broken" });
  assert.equal((await subscriptions(malformedJson)).status, 400);
  assert.equal(github.calls.length, 0);
  assert.equal(github.writes, 0);
});

test("HTTP renewal keeps an expired original URL and immediately updates download expiry on both deployments", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink({ exp: Math.floor(Date.now() / 1000) - 60 });
  await syncSubscriptions([link], request());
  assert.equal((await download(link.token)).status, 410);
  const response = await extendLink(adminRequest("extend-link", authorized({
    link: link.url,
    ttlMinutes: 60,
    operationId: "api-renewal-operation-1234567"
  }), originB));
  assert.equal(response.status, 200);
  const renewed = await response.json();
  assert.equal(renewed.url, link.url);
  assert.equal(renewed.token, link.token);
  assert.equal(renewed.unchangedUrl, true);
  assert.equal("payload" in renewed, false);
  assert.equal("extensionOperationIds" in renewed, false);

  process.env.LINK_SECRET = secretB;
  const downloaded = await download(link.token, originB);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), "proxies: []\n");
  assert.equal(downloaded.headers.get("subscription-userinfo"), `upload=0; download=0; total=0; expire=${Date.parse(renewed.expiresAt) / 1000}`);
  assert.match(downloaded.headers.get("cache-control") ?? "", /no-store/);

  const statusResponse = await linkStatus(adminRequest("link-status", authorized({ link: link.url }), originB));
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.url, link.url);
  assert.equal(status.expiresAt, renewed.expiresAt);
  assert.equal(status.status, "active");

  const invalidation = await invalidateLink(adminRequest("invalidate-link", authorized({ link: link.url }), originB));
  assert.equal(invalidation.status, 200);
  assert.equal("payload" in await invalidation.json(), false);
  assert.ok(github.record(link.token).invalidatedAt);
  assert.equal((await download(link.token, originB)).status, 410);
  process.env.LINK_SECRET = secretA;
  assert.equal((await download(link.token)).status, 410);
  const rejectedRenewal = await extendLink(adminRequest("extend-link", authorized({ link: link.url, ttlMinutes: 60 })));
  assert.equal(rejectedRenewal.status, 410);
});

test("cloud write failures never return a created link or a successful migration", async () => {
  const github = new GitHubFixture().install();
  github.writeStatus = 403;
  const creation = await createLink(adminRequest("links", authorized({ ttlMinutes: 60 })));
  assert.equal(creation.status, 503);
  const creationBody = await creation.json();
  assert.equal(typeof creationBody.error, "string");
  assert.equal("url" in creationBody, false);
  assert.equal("token" in creationBody, false);
  assert.deepEqual(github.document, { version: 1, records: {} });

  const link = sampleLink();
  const sync = await subscriptions(adminRequest("subscriptions", authorized({ action: "sync", links: [link] })));
  assert.equal(sync.status, 503);
  assert.equal(typeof (await sync.json()).error, "string");
  assert.deepEqual(github.document, { version: 1, records: {} });
});

test("public subscription errors hide GitHub configuration and malformed token encodings return 400", async () => {
  const github = new GitHubFixture().install();
  github.repoStatus = 401;
  const response = await download(sampleLink().token);
  assert.equal(response.status, 503);
  const message = await response.text();
  assert.doesNotMatch(message, /test-github-token|private-subscriptions|GITHUB_STORAGE/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await download("%malformed")).status, 400);
});

test("a cached closure can close an existing cloud subscription and later cache sync cannot reopen it", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  await syncSubscriptions([link], request());
  const renewed = await extendStoredSubscription(link.token, link.payload, link.url, { ttlMinutes: 90, label: "Cloud label" }, link.now);
  const invalidatedAt = new Date((link.now - 30) * 1000).toISOString();
  const secondUrl = `${originB}/api/subscription/${link.token}`;
  process.env.LINK_SECRET = secretB;
  const importedClosure = await syncSubscriptions([{ ...link, url: secondUrl, invalidatedAt }], request(originB));
  assert.equal(importedClosure.existing, 1);
  assert.equal(github.record(link.token).invalidatedAt, invalidatedAt);
  assert.equal(github.record(link.token).expiresAt, renewed.expiresAt);
  assert.equal(github.record(link.token).label, "Cloud label");
  await syncSubscriptions([{ ...link, invalidatedAt: undefined }], request());
  assert.equal(github.record(link.token).invalidatedAt, invalidatedAt);
  assert.equal((await download(link.token, originB)).status, 410);
});

test("all management APIs reject null or array bodies, and token APIs reject malformed URI input before GitHub access", async () => {
  const github = new GitHubFixture().install();
  const handlers: [string, (request: Request) => Promise<Response>][] = [
    ["links", createLink],
    ["extend-link", extendLink],
    ["invalidate-link", invalidateLink],
    ["link-status", linkStatus],
    ["subscriptions", subscriptions]
  ];
  for (const [endpoint, handler] of handlers) {
    for (const body of [null, []]) {
      assert.equal((await handler(adminRequest(endpoint, body))).status, 400, `${endpoint}: ${JSON.stringify(body)}`);
    }
  }
  for (const [endpoint, handler] of handlers.slice(1, 4)) {
    const response = await handler(adminRequest(endpoint, authorized({ link: "%malformed", ttlMinutes: 60 })));
    assert.equal(response.status, 400, endpoint);
  }
  assert.equal(github.calls.length, 0);
});

test("malformed persisted renewal operation IDs fail validation without overwriting cloud data", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  const record = makeSubscriptionRecord(link.token, link.payload, link.url);
  github.put(record);
  const before = structuredClone(github.document);
  for (const extensionOperationIds of [null, "not-an-array", [123], [null], ["valid-id", {}]]) {
    github.invalidContent = JSON.stringify({
      version: 1,
      records: { [hashSubscriptionToken(link.token)]: { ...record, extensionOperationIds } }
    });
    await assert.rejects(() => readSubscriptions(), StorageError);
    await assert.rejects(() => syncSubscriptions([link], request()), StorageError);
  }
  assert.equal(github.writes, 0);
  assert.deepEqual(github.document, before);
});

test("legacy revocation storage closes a record already migrated as active by another deployment", async () => {
  const github = new GitHubFixture().install();
  const link = sampleLink();
  github.put(makeSubscriptionRecord(link.token, link.payload, link.url));
  const directory = await mkdtemp(path.join(tmpdir(), "vpn-existing-legacy-revocations-"));
  try {
    process.env.REVOKED_LINKS_FILE_PATH = path.join(directory, "revoked.json");
    await writeFile(process.env.REVOKED_LINKS_FILE_PATH, JSON.stringify({
      revoked: {
        [hashSubscriptionToken(link.token)]: {
          tokenHash: hashSubscriptionToken(link.token),
          expiresAt: new Date(link.payload.exp * 1000).toISOString(),
          expiresAtSeconds: link.payload.exp,
          invalidatedAt: new Date((link.now - 30) * 1000).toISOString()
        }
      }
    }));
    const result = await syncSubscriptions([link], request());
    assert.equal(result.existing, 1);
    assert.ok(github.record(link.token).invalidatedAt);
    delete process.env.REVOKED_LINKS_FILE_PATH;
    process.env.LINK_SECRET = secretB;
    assert.equal((await download(link.token, originB)).status, 410);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
