import crypto from "crypto";
import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import {
  assertWithinMaxTtl,
  BadRequestError,
  buildSubscriptionUrl,
  parseCreateExpiry,
  sanitizeLabel
} from "@/lib/link-admin";
import { createSignedToken, requireLinkSecret, type LinkPayload } from "@/lib/token";
import { saveCreatedSubscription } from "@/lib/subscriptions";
import { StorageError } from "@/lib/github-store";

type CreateLinkBody = {
  password?: unknown;
  label?: unknown;
  ttlMinutes?: unknown;
  expiresAt?: unknown;
};

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: CreateLinkBody;

  try {
    body = (await request.json()) as CreateLinkBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError("Request body must be an object.");
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = parseCreateExpiry(body, nowSeconds);
    assertWithinMaxTtl(expiresAtSeconds, nowSeconds);

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
    const url = buildSubscriptionUrl(request, token);
    await saveCreatedSubscription(token, payload, url);

    return NextResponse.json({
      url,
      token,
      label: payload.label,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      expiresInSeconds: expiresAtSeconds - nowSeconds
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to create link.";

    return NextResponse.json({ error: message }, { status: error instanceof StorageError ? error.status : 500 });
  }
}
