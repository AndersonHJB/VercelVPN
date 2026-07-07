import crypto from "crypto";
import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import { createSignedToken, requireLinkSecret, type LinkPayload } from "@/lib/token";

type CreateLinkBody = {
  password?: unknown;
  label?: unknown;
  ttlMinutes?: unknown;
  expiresAt?: unknown;
};

export async function POST(request: Request) {
  let body: CreateLinkBody;

  try {
    body = (await request.json()) as CreateLinkBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = parseExpiry(body, nowSeconds);
    const maxTtlDays = parseMaxTtlDays();
    const maxTtlSeconds = maxTtlDays * 24 * 60 * 60;

    if (expiresAtSeconds - nowSeconds > maxTtlSeconds) {
      return NextResponse.json(
        { error: `Expiry cannot be more than ${maxTtlDays} days from now.` },
        { status: 400 }
      );
    }

    const payload: LinkPayload = {
      v: 1,
      iat: nowSeconds,
      exp: expiresAtSeconds,
      nonce: crypto.randomUUID(),
      label: sanitizeLabel(body.label)
    };

    if (!payload.label) {
      delete payload.label;
    }

    const token = createSignedToken(payload, requireLinkSecret());
    const origin = new URL(request.url).origin;
    const url = `${origin}/api/subscription/${encodeURIComponent(token)}`;

    return NextResponse.json({
      url,
      token,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      expiresInSeconds: expiresAtSeconds - nowSeconds
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to create link.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseExpiry(body: CreateLinkBody, nowSeconds: number): number {
  if (typeof body.expiresAt === "string" && body.expiresAt.length > 0) {
    const expiresAtMs = Date.parse(body.expiresAt);

    if (Number.isNaN(expiresAtMs)) {
      throw new BadRequestError("expiresAt is not a valid date.");
    }

    const expiresAtSeconds = Math.floor(expiresAtMs / 1000);

    if (expiresAtSeconds <= nowSeconds) {
      throw new BadRequestError("Expiry must be in the future.");
    }

    return expiresAtSeconds;
  }

  const ttlMinutes =
    typeof body.ttlMinutes === "number" ? body.ttlMinutes : Number(body.ttlMinutes);

  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    throw new BadRequestError("ttlMinutes must be a positive number.");
  }

  return nowSeconds + Math.floor(ttlMinutes * 60);
}

function parseMaxTtlDays(): number {
  const value = Number(process.env.MAX_LINK_TTL_DAYS || "365");

  if (!Number.isFinite(value) || value <= 0) {
    return 365;
  }

  return Math.floor(value);
}

function sanitizeLabel(label: unknown): string | undefined {
  if (typeof label !== "string") {
    return undefined;
  }

  const trimmed = label.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 80);
}

class BadRequestError extends Error {}
