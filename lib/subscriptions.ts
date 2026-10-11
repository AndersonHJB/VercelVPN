import {
  hasGitHubStorage,
  hashSubscriptionToken,
  readSubscriptions,
  updateSubscriptions,
  type SubscriptionRecord
} from "@/lib/github-store";
import {
  assertWithinMaxTtl,
  BadRequestError,
  buildSubscriptionUrl,
  extractTokenFromLinkInput,
  parseExtendedExpiry,
  sanitizeLabel,
  type ExpiryInput
} from "@/lib/link-admin";
import { isTokenRevoked } from "@/lib/revoked-links";
import { requireLinkSecret, verifySignedToken, type LinkPayload } from "@/lib/token";

export function subscriptionView(record: SubscriptionRecord, nowSeconds = Math.floor(Date.now() / 1000)) {
  const { payload, extensionOperationIds, ...view } = record;
  void extensionOperationIds;
  return { ...view, issuedAt: new Date(payload.iat * 1000).toISOString(), expiresInSeconds: Math.floor(Date.parse(record.expiresAt) / 1000) - nowSeconds };
}

export function originalSubscriptionUrl(input: unknown, request: Request, token: string): string {
  if (typeof input === "string") {
    try {
      const url = new URL(input.trim());
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password &&
        decodeURIComponent(url.pathname) === `/api/subscription/${token}`) {
        return input.trim();
      }
    } catch { /* A bare token uses the current origin. */ }
  }
  return buildSubscriptionUrl(request, token);
}

export function makeSubscriptionRecord(token: string, payload: LinkPayload, url: string): SubscriptionRecord {
  return {
    token,
    payload,
    url,
    urls: [url],
    createdAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    label: payload.label,
    source: "created"
  };
}

export async function saveCreatedSubscription(token: string, payload: LinkPayload, url: string) {
  if (!hasGitHubStorage()) return;
  await updateSubscriptions((doc) => {
    const hash = hashSubscriptionToken(token);
    if (!doc.records[hash]) doc.records[hash] = makeSubscriptionRecord(token, payload, url);
  });
}

/** A persisted exact token is a credential admitted by either trusted deployment.
 * Unknown legacy tokens still require this deployment's original HMAC signature.
 * Never fall back when the configured store is unavailable: that could reopen a closed link.
 */
export async function resolveSubscription(token: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || token.length > 4096) {
    return { ok: false as const, status: 400, message: "Invalid link." };
  }
  const record = hasGitHubStorage() ? (await readSubscriptions()).records[hashSubscriptionToken(token)] : undefined;
  if (record && record.token !== token) throw new Error("Subscription record mismatch.");
  const verification = record
    ? { ok: true as const, payload: record.payload, expired: Date.parse(record.expiresAt) <= nowSeconds * 1000 }
    : verifySignedToken(token, requireLinkSecret(), nowSeconds, { allowExpired: true });
  if (!verification.ok) return verification;
  const invalidated = Boolean(record?.invalidatedAt) || await isTokenRevoked(token, nowSeconds);
  const expiresAtSeconds = record ? Math.floor(Date.parse(record.expiresAt) / 1000) : verification.payload.exp;
  return {
    ok: true as const,
    payload: verification.payload,
    record,
    invalidated,
    expired: expiresAtSeconds <= nowSeconds,
    expiresAtSeconds,
    label: record?.label ?? verification.payload.label
  };
}

export async function listSubscriptions() {
  const doc = await readSubscriptions();
  return Object.values(doc.records).map((record) => subscriptionView(record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function syncSubscriptions(inputs: unknown[], request: Request) {
  if (inputs.length > 200) throw new BadRequestError("每批最多同步 200 条记录，请分批同步。");
  const current = await readSubscriptions();
  const prepared: { index: number; record: SubscriptionRecord }[] = [];
  const rejected: { index: number; error: string }[] = [];
  for (let index = 0; index < inputs.length; index++) {
    try {
      const input = inputs[index];
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestError("缓存记录格式无效。");
      const link = input as Record<string, unknown>;
      const token = extractTokenFromLinkInput(link.token ?? link.url);
      if (typeof link.url !== "string" || originalSubscriptionUrl(link.url, request, token) !== link.url.trim()) {
        throw new BadRequestError("缓存订阅地址与 token 不匹配，原记录已保留。");
      }
      const existing = current.records[hashSubscriptionToken(token)];
      let record: SubscriptionRecord;
      if (existing?.token === token) {
        record = { ...existing, urls: [...existing.urls] };
        if (validDate(link.invalidatedAt) || await isTokenRevoked(token)) {
          record.invalidatedAt ??= validDate(link.invalidatedAt) ? link.invalidatedAt : new Date().toISOString();
        }
      } else {
        const verification = verifySignedToken(token, requireLinkSecret(), undefined, { allowExpired: true });
        if (!verification.ok) throw new BadRequestError("旧链接签名无效，请在最初生成它的域名同步。");
        record = makeSubscriptionRecord(token, verification.payload, originalSubscriptionUrl(link.url, request, token));
        record.label = sanitizeLabel(link.label) ?? record.label;
        if (validDate(link.createdAt)) record.createdAt = link.createdAt;
        if (link.source === "created" || link.source === "extended") record.source = link.source;
        if (validDate(link.previousExpiresAt)) record.previousExpiresAt = link.previousExpiresAt;
        if (typeof link.wasExpired === "boolean") record.wasExpired = link.wasExpired;
        if (validDate(link.invalidatedAt) || await isTokenRevoked(token)) {
          record.invalidatedAt = validDate(link.invalidatedAt) ? link.invalidatedAt : new Date().toISOString();
        }
      }
      const url = originalSubscriptionUrl(link.url, request, token);
      if (!record.urls.includes(url)) record.urls.push(url);
      prepared.push({ index, record });
    } catch (error) {
      if (!(error instanceof BadRequestError) && !(error instanceof URIError)) throw error;
      rejected.push({ index, error: error.message });
    }
  }
  return updateSubscriptions((doc) => {
    let imported = 0;
    let existing = 0;
    for (const { record } of prepared) {
      const hash = hashSubscriptionToken(record.token);
      const saved = doc.records[hash];
      if (saved) {
        // Cache metadata can never roll back server-side renewal or revocation.
        saved.urls = Array.from(new Set([...saved.urls, ...record.urls]));
        // There is no reopen operation: preserve a legacy browser's closure intent.
        saved.invalidatedAt ??= record.invalidatedAt;
        existing++;
      } else {
        doc.records[hash] = record;
        imported++;
      }
    }
    return {
      configured: true,
      imported,
      existing,
      rejected,
      links: Object.values(doc.records).map((record) => subscriptionView(record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    };
  });
}

export async function extendStoredSubscription(
  token: string,
  payload: LinkPayload,
  url: string,
  input: ExpiryInput & { label?: unknown; operationId?: unknown },
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  if (input.operationId !== undefined && (typeof input.operationId !== "string" || !/^[\w-]{16,100}$/.test(input.operationId))) {
    throw new BadRequestError("续期请求标识无效。");
  }
  return updateSubscriptions((doc) => {
    const hash = hashSubscriptionToken(token);
    const record = doc.records[hash] ?? makeSubscriptionRecord(token, payload, url);
    if (record.invalidatedAt) throw new BadRequestError("This link has been invalidated.");
    if (typeof input.operationId === "string" && record.extensionOperationIds?.includes(input.operationId)) {
      return subscriptionView(record, nowSeconds);
    }
    const previousExpiresAtSeconds = Math.floor(Date.parse(record.expiresAt) / 1000);
    const expiresAtSeconds = parseExtendedExpiry(input, nowSeconds, previousExpiresAtSeconds);
    assertWithinMaxTtl(expiresAtSeconds, nowSeconds);
    record.previousExpiresAt = record.expiresAt;
    record.expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
    record.wasExpired = previousExpiresAtSeconds <= nowSeconds;
    record.label = sanitizeLabel(input.label) ?? record.label;
    record.source = "extended";
    if (typeof input.operationId === "string") {
      record.extensionOperationIds = [...(record.extensionOperationIds ?? []), input.operationId].slice(-100);
    }
    if (!record.urls.includes(url)) record.urls.push(url);
    doc.records[hash] = record;
    return subscriptionView(record, nowSeconds);
  });
}

export async function invalidateStoredSubscription(token: string, payload: LinkPayload, url: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  return updateSubscriptions((doc) => {
    const hash = hashSubscriptionToken(token);
    const record = doc.records[hash] ?? makeSubscriptionRecord(token, payload, url);
    const alreadyInvalidated = Boolean(record.invalidatedAt);
    record.invalidatedAt ??= new Date(nowSeconds * 1000).toISOString();
    if (!record.urls.includes(url)) record.urls.push(url);
    doc.records[hash] = record;
    return { ...subscriptionView(record, nowSeconds), tokenHash: hash, alreadyInvalidated };
  });
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
