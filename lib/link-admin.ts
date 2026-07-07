export type ExpiryInput = {
  ttlMinutes?: unknown;
  expiresAt?: unknown;
};

export class BadRequestError extends Error {}

export function parseCreateExpiry(body: ExpiryInput, nowSeconds: number): number {
  if (typeof body.expiresAt === "string" && body.expiresAt.length > 0) {
    return parseFutureDate(body.expiresAt, nowSeconds, "Expiry must be in the future.");
  }

  return nowSeconds + parseTtlSeconds(body.ttlMinutes);
}

export function parseExtendedExpiry(
  body: ExpiryInput,
  nowSeconds: number,
  currentExpiresAtSeconds: number
): number {
  const minimumExpiry = Math.max(nowSeconds, currentExpiresAtSeconds);

  if (typeof body.expiresAt === "string" && body.expiresAt.length > 0) {
    return parseFutureDate(
      body.expiresAt,
      minimumExpiry,
      "New expiry must be later than the current expiry."
    );
  }

  return minimumExpiry + parseTtlSeconds(body.ttlMinutes);
}

export function parseMaxTtlDays(): number {
  const value = Number(process.env.MAX_LINK_TTL_DAYS || "365");

  if (!Number.isFinite(value) || value <= 0) {
    return 365;
  }

  return Math.floor(value);
}

export function assertWithinMaxTtl(
  expiresAtSeconds: number,
  nowSeconds: number,
  maxTtlDays = parseMaxTtlDays()
) {
  const maxTtlSeconds = maxTtlDays * 24 * 60 * 60;

  if (expiresAtSeconds - nowSeconds > maxTtlSeconds) {
    throw new BadRequestError(`Expiry cannot be more than ${maxTtlDays} days from now.`);
  }
}

export function sanitizeLabel(label: unknown): string | undefined {
  if (typeof label !== "string") {
    return undefined;
  }

  const trimmed = label.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 80);
}

export function buildSubscriptionUrl(request: Request, token: string): string {
  const fallbackUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto") || fallbackUrl.protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : fallbackUrl.origin;

  return `${origin}/api/subscription/${encodeURIComponent(token)}`;
}

export function extractTokenFromLinkInput(input: unknown): string {
  if (typeof input !== "string") {
    throw new BadRequestError("Existing link or token is required.");
  }

  const trimmed = input.trim();

  if (!trimmed) {
    throw new BadRequestError("Existing link or token is required.");
  }

  const pathMarker = "/api/subscription/";
  const markerIndex = trimmed.indexOf(pathMarker);

  if (markerIndex >= 0) {
    const tokenWithTail = trimmed.slice(markerIndex + pathMarker.length);
    const token = tokenWithTail.split(/[?#]/)[0];

    if (!token) {
      throw new BadRequestError("Existing link does not contain a token.");
    }

    return decodeURIComponent(token);
  }

  return decodeURIComponent(trimmed);
}

function parseFutureDate(input: string, minimumSeconds: number, message: string): number {
  const expiresAtMs = Date.parse(input);

  if (Number.isNaN(expiresAtMs)) {
    throw new BadRequestError("expiresAt is not a valid date.");
  }

  const expiresAtSeconds = Math.floor(expiresAtMs / 1000);

  if (expiresAtSeconds <= minimumSeconds) {
    throw new BadRequestError(message);
  }

  return expiresAtSeconds;
}

function parseTtlSeconds(ttlMinutesInput: unknown): number {
  const ttlMinutes =
    typeof ttlMinutesInput === "number" ? ttlMinutesInput : Number(ttlMinutesInput);

  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    throw new BadRequestError("ttlMinutes must be a positive number.");
  }

  return Math.floor(ttlMinutes * 60);
}
