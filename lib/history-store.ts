export type StoredLink = {
  url: string;
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
  label?: string;
  createdAt: string;
  previousExpiresAt?: string;
  wasExpired?: boolean;
  source?: "created" | "extended";
};

type RedisConfig = {
  url: string;
  token: string;
  key: string;
  maxItems: number;
};

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

const defaultHistoryKey = "yaml-link-history:v1";
const defaultMaxItems = 500;

export function isHistoryStoreConfigured(): boolean {
  return getRedisConfig() !== null;
}

export async function getStoredLinks(): Promise<StoredLink[]> {
  const config = getRedisConfig();

  if (!config) {
    return [];
  }

  const stored = await redisCommand<string | null>(["GET", config.key]);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isStoredLink).slice(0, config.maxItems);
  } catch {
    return [];
  }
}

export async function appendStoredLink(link: StoredLink): Promise<{ enabled: boolean; count: number }> {
  const config = getRedisConfig();

  if (!config) {
    return { enabled: false, count: 0 };
  }

  const currentLinks = await getStoredLinks();
  const links = [link, ...currentLinks.filter((item) => item.token !== link.token)].slice(0, config.maxItems);

  await redisCommand<string>(["SET", config.key, JSON.stringify(links)]);

  return { enabled: true, count: links.length };
}

export async function clearStoredLinks(): Promise<{ enabled: boolean }> {
  const config = getRedisConfig();

  if (!config) {
    return { enabled: false };
  }

  await redisCommand<number>(["DEL", config.key]);

  return { enabled: true };
}

function getRedisConfig(): RedisConfig | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return {
    url,
    token,
    key: process.env.LINK_HISTORY_KEY || defaultHistoryKey,
    maxItems: parseMaxItems(process.env.LINK_HISTORY_MAX_ITEMS)
  };
}

async function redisCommand<T>(command: unknown[]): Promise<T> {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("History cache is not configured.");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });

  let body: RedisResponse<T>;

  try {
    body = (await response.json()) as RedisResponse<T>;
  } catch {
    throw new Error(`History cache request failed with status ${response.status}.`);
  }

  if (!response.ok) {
    throw new Error(body.error || `History cache request failed with status ${response.status}.`);
  }

  if (body.error) {
    throw new Error(body.error);
  }

  return body.result as T;
}

function parseMaxItems(input: string | undefined): number {
  const value = Number(input || defaultMaxItems);

  if (!Number.isFinite(value) || value <= 0) {
    return defaultMaxItems;
  }

  return Math.floor(value);
}

function isStoredLink(value: unknown): value is StoredLink {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const source = record.source;

  return (
    typeof record.url === "string" &&
    typeof record.token === "string" &&
    typeof record.expiresAt === "string" &&
    typeof record.expiresInSeconds === "number" &&
    typeof record.createdAt === "string" &&
    (record.label === undefined || typeof record.label === "string") &&
    (record.previousExpiresAt === undefined || typeof record.previousExpiresAt === "string") &&
    (record.wasExpired === undefined || typeof record.wasExpired === "boolean") &&
    (source === undefined || source === "created" || source === "extended")
  );
}
