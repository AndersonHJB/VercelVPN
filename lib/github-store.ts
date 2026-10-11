import crypto from "node:crypto";

import type { LinkPayload } from "@/lib/token";

export type SubscriptionRecord = {
  token: string;
  payload: LinkPayload;
  url: string;
  urls: string[];
  createdAt: string;
  expiresAt: string;
  label?: string;
  invalidatedAt?: string;
  previousExpiresAt?: string;
  wasExpired?: boolean;
  source?: "created" | "extended";
  extensionOperationIds?: string[];
};

export type SubscriptionDocument = {
  version: 1;
  records: Record<string, SubscriptionRecord>;
};

export class StorageError extends Error {
  constructor(message: string, public status = 503) {
    super(message);
  }
}

type StorageConfig = { token: string; repo: string; branch: string; filePath: string };
const maxDocumentBytes = 900_000;

export function hasGitHubStorage(): boolean {
  return Boolean(process.env.GITHUB_STORAGE_REPO?.trim() || process.env.GITHUB_STORAGE_TOKEN?.trim());
}

function requireConfig(): StorageConfig {
  const repo = process.env.GITHUB_STORAGE_REPO?.trim();
  const token = process.env.GITHUB_STORAGE_TOKEN?.trim();
  const branch = process.env.GITHUB_STORAGE_BRANCH?.trim() || "main";
  const filePath = process.env.GITHUB_STORAGE_PATH?.trim() || "subscriptions/links.json";
  if (!repo || !token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new StorageError("请在服务端配置 GITHUB_STORAGE_REPO（owner/repo）和 GITHUB_STORAGE_TOKEN。");
  }
  if (filePath.startsWith("/") || filePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new StorageError("GITHUB_STORAGE_PATH 必须是仓库内的相对文件路径。");
  }
  return { repo, token, branch, filePath };
}

export function hashSubscriptionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function githubRequest(config: StorageConfig, endpoint: string, init: RequestInit = {}) {
  try {
    return await fetch(`https://api.github.com/repos/${config.repo}${endpoint}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${config.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "VercelVPN-subscription-storage",
        "content-type": "application/json"
      }
    });
  } catch {
    throw new StorageError("GitHub 存储连接失败或超时，请稍后重试。");
  }
}

function assertGitHubResponse(response: Response) {
  if (!response.ok) {
    throw new StorageError(`GitHub 存储请求失败（HTTP ${response.status}），请检查仓库、分支、令牌权限或 API 限额。`);
  }
}

async function assertPrivateRepository(config: StorageConfig) {
  const response = await githubRequest(config, "");
  assertGitHubResponse(response);
  const repo = await response.json();
  if (repo.private !== true) {
    throw new StorageError("订阅数据只能存入 GitHub 私有仓库，请检查仓库可见性。");
  }
}

function contentEndpoint(config: StorageConfig) {
  return `/contents/${config.filePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function readDocument(config: StorageConfig): Promise<{ document: SubscriptionDocument; sha?: string }> {
  const response = await githubRequest(config, `${contentEndpoint(config)}?ref=${encodeURIComponent(config.branch)}`);
  if (response.status === 404) {
    // A missing branch or inaccessible repo must never be interpreted as an empty store.
    const branch = await githubRequest(config, `/branches/${encodeURIComponent(config.branch)}`);
    assertGitHubResponse(branch);
    return { document: { version: 1, records: {} } };
  }
  assertGitHubResponse(response);
  const file = await response.json();
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string" || typeof file.sha !== "string") {
    throw new StorageError("GitHub 订阅文件格式无效或过大，未修改任何数据。");
  }
  try {
    const document: unknown = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
    assertDocument(document);
    return { document, sha: file.sha };
  } catch {
    throw new StorageError("GitHub 订阅文件校验失败，未修改任何数据；请检查文件或恢复历史版本。");
  }
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertDocument(value: unknown): asserts value is SubscriptionDocument {
  const doc = value as SubscriptionDocument;
  if (!doc || doc.version !== 1 || !doc.records || typeof doc.records !== "object" || Array.isArray(doc.records)) {
    throw new Error("Invalid document");
  }
  for (const [hash, record] of Object.entries(doc.records)) {
    if (!record || typeof record.token !== "string" || record.token.length > 4096 || hashSubscriptionToken(record.token) !== hash ||
      !record.payload || record.payload.v !== 1 || !Number.isInteger(record.payload.iat) || !Number.isInteger(record.payload.exp) ||
      record.payload.exp <= record.payload.iat || typeof record.payload.nonce !== "string" || !record.payload.nonce ||
      typeof record.url !== "string" || !Array.isArray(record.urls) || record.urls.some((url) => typeof url !== "string") ||
      !validDate(record.createdAt) || !validDate(record.expiresAt) ||
      (record.label !== undefined && typeof record.label !== "string") ||
      (record.invalidatedAt !== undefined && !validDate(record.invalidatedAt)) ||
      (record.extensionOperationIds !== undefined && (!Array.isArray(record.extensionOperationIds) || record.extensionOperationIds.some((id) => typeof id !== "string")))) {
      throw new Error("Invalid record");
    }
  }
}

export async function readSubscriptions(): Promise<SubscriptionDocument> {
  const config = requireConfig();
  await assertPrivateRepository(config);
  return (await readDocument(config)).document;
}

/** Optimistic compare-and-swap. Reapply the mutation to the latest file on conflict. */
export async function updateSubscriptions<T>(mutate: (document: SubscriptionDocument) => T): Promise<T> {
  const config = requireConfig();
  await assertPrivateRepository(config);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { document, sha } = await readDocument(config);
    const before = JSON.stringify(document);
    const result = mutate(document);
    const content = JSON.stringify(document);
    if (content === before) return result;
    if (Buffer.byteLength(content, "utf8") > maxDocumentBytes) {
      throw new StorageError("订阅文件已接近 GitHub Contents API 大小限制，本次写入已取消，请拆分存储后重试。");
    }
    const response = await githubRequest(config, contentEndpoint(config), {
      method: "PUT",
      body: JSON.stringify({
        message: "Update subscription records [skip ci]",
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: config.branch,
        ...(sha ? { sha } : {})
      })
    });
    if (response.status === 409 || response.status === 422) continue;
    assertGitHubResponse(response);
    return result;
  }
  throw new StorageError("订阅数据正被另一个管理端修改，请重试；本机缓存仍保留。");
}
