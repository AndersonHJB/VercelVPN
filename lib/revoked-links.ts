import crypto from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import type { LinkPayload } from "@/lib/token";

type RevokedLinkRecord = {
  tokenHash: string;
  expiresAt: string;
  expiresAtSeconds: number;
  invalidatedAt: string;
  label?: string;
};

type RevocationStore = {
  isRevoked: (tokenHash: string, nowSeconds: number) => Promise<boolean>;
  revoke: (record: RevokedLinkRecord, ttlSeconds: number) => Promise<void>;
};

type RevokedLinksFile = {
  revoked: Record<string, RevokedLinkRecord>;
};

const defaultRevokedLinksPath = "data/revoked-links.json";

export async function isTokenRevoked(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const store = getRevocationStore();

  if (!store) {
    return false;
  }

  return store.isRevoked(hashToken(token), nowSeconds);
}

export async function revokeToken(
  token: string,
  payload: LinkPayload,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<RevokedLinkRecord> {
  const store = getRevocationStore();

  if (!store) {
    throw new Error(
      "Link revocation storage is not configured. Set KV_REST_API_URL/KV_REST_API_TOKEN or REVOKED_LINKS_FILE_PATH."
    );
  }

  const record: RevokedLinkRecord = {
    tokenHash: hashToken(token),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    expiresAtSeconds: payload.exp,
    invalidatedAt: new Date(nowSeconds * 1000).toISOString(),
    label: payload.label
  };

  if (!record.label) {
    delete record.label;
  }

  const ttlSeconds = Math.max(60, payload.exp - nowSeconds);
  await store.revoke(record, ttlSeconds);

  return record;
}

function getRevocationStore(): RevocationStore | undefined {
  const upstashUrl =
    process.env.LINK_REVOCATION_UPSTASH_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const upstashToken =
    process.env.LINK_REVOCATION_UPSTASH_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();

  if (upstashUrl && upstashToken) {
    return createUpstashRevocationStore(upstashUrl, upstashToken);
  }

  const configuredFilePath = process.env.REVOKED_LINKS_FILE_PATH?.trim();

  if (configuredFilePath || !process.env.VERCEL) {
    return createFileRevocationStore(configuredFilePath || defaultRevokedLinksPath);
  }

  return undefined;
}

function createUpstashRevocationStore(baseUrl: string, token: string): RevocationStore {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  return {
    async isRevoked(tokenHash: string, nowSeconds: number) {
      const response = await fetch(`${normalizedBaseUrl}/get/${encodeURIComponent(tokenHash)}`, {
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Unable to read link revocation store: HTTP ${response.status}.`);
      }

      const data = (await response.json()) as { result?: unknown };
      const record = parseRevokedLinkRecord(data.result);

      return Boolean(record && record.expiresAtSeconds > nowSeconds);
    },

    async revoke(record: RevokedLinkRecord, ttlSeconds: number) {
      const response = await fetch(
        `${normalizedBaseUrl}/setex/${encodeURIComponent(record.tokenHash)}/${ttlSeconds}/${encodeURIComponent(
          JSON.stringify(record)
        )}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Unable to write link revocation store: HTTP ${response.status}.`);
      }
    }
  };
}

function createFileRevocationStore(filePath: string): RevocationStore {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  return {
    async isRevoked(tokenHash: string, nowSeconds: number) {
      const data = await readRevokedLinksFile(resolvedPath);
      const record = data.revoked[tokenHash];

      return Boolean(record && record.expiresAtSeconds > nowSeconds);
    },

    async revoke(record: RevokedLinkRecord) {
      const data = await readRevokedLinksFile(resolvedPath);

      data.revoked = pruneExpiredRecords(data.revoked);
      data.revoked[record.tokenHash] = record;

      await writeRevokedLinksFile(resolvedPath, data);
    }
  };
}

async function readRevokedLinksFile(filePath: string): Promise<RevokedLinksFile> {
  try {
    const content = await readFile(filePath, "utf8");
    const data = JSON.parse(content) as RevokedLinksFile;

    if (!data || typeof data.revoked !== "object" || Array.isArray(data.revoked)) {
      return { revoked: {} };
    }

    return { revoked: data.revoked };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { revoked: {} };
    }

    throw error;
  }
}

async function writeRevokedLinksFile(filePath: string, data: RevokedLinksFile) {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function pruneExpiredRecords(records: Record<string, RevokedLinkRecord>) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  return Object.fromEntries(
    Object.entries(records).filter(([, record]) => record.expiresAtSeconds > nowSeconds)
  );
}

function parseRevokedLinkRecord(input: unknown): RevokedLinkRecord | undefined {
  const value = typeof input === "string" ? safeJsonParse(input) : input;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as RevokedLinkRecord;

  if (
    typeof record.tokenHash !== "string" ||
    typeof record.expiresAt !== "string" ||
    !Number.isInteger(record.expiresAtSeconds) ||
    typeof record.invalidatedAt !== "string"
  ) {
    return undefined;
  }

  return record;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
