import crypto from "crypto";

export type LinkPayload = {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
  label?: string;
};

export type TokenVerification =
  | { ok: true; payload: LinkPayload; expired: boolean }
  | { ok: false; status: number; message: string };

export type VerifySignedTokenOptions = {
  allowExpired?: boolean;
};

export function requireLinkSecret(): string {
  const secret = process.env.LINK_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("LINK_SECRET must be configured with at least 32 characters.");
  }

  return secret;
}

export function createSignedToken(payload: LinkPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  options: VerifySignedTokenOptions = {}
): TokenVerification {
  if (!token || token.length > 4096) {
    return { ok: false, status: 400, message: "Invalid link." };
  }

  const parts = token.split(".");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, status: 400, message: "Invalid link." };
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = sign(encodedPayload, secret);

  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    return { ok: false, status: 403, message: "Invalid link." };
  }

  let payload: LinkPayload;

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as LinkPayload;
  } catch {
    return { ok: false, status: 400, message: "Invalid link." };
  }

  if (!isPayloadShapeValid(payload)) {
    return { ok: false, status: 400, message: "Invalid link." };
  }

  const expired = payload.exp <= nowSeconds;

  if (expired && !options.allowExpired) {
    return { ok: false, status: 410, message: "This link has expired." };
  }

  return { ok: true, payload, expired };
}

function sign(encodedPayload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isPayloadShapeValid(payload: LinkPayload): payload is LinkPayload {
  return (
    payload &&
    payload.v === 1 &&
    Number.isInteger(payload.iat) &&
    Number.isInteger(payload.exp) &&
    payload.exp > payload.iat &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    (payload.label === undefined || typeof payload.label === "string")
  );
}
