import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import {
  assertWithinMaxTtl,
  BadRequestError,
  buildSubscriptionUrl,
  extractTokenFromLinkInput,
  parseExtendedExpiry,
  sanitizeLabel
} from "@/lib/link-admin";
import { createSignedToken, requireLinkSecret, type LinkPayload } from "@/lib/token";
import { hasGitHubStorage, StorageError } from "@/lib/github-store";
import { extendStoredSubscription, originalSubscriptionUrl, resolveSubscription } from "@/lib/subscriptions";

type ExtendLinkBody = {
  password?: unknown;
  link?: unknown;
  token?: unknown;
  label?: unknown;
  ttlMinutes?: unknown;
  expiresAt?: unknown;
  operationId?: unknown;
};

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: ExtendLinkBody;

  try {
    body = (await request.json()) as ExtendLinkBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError("Request body must be an object.");
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const existingToken = extractTokenFromLinkInput(body.link ?? body.token);
    const verification = await resolveSubscription(existingToken, nowSeconds);

    if (!verification.ok) {
      return NextResponse.json({ error: verification.message }, { status: verification.status });
    }

    if (verification.invalidated) {
      return NextResponse.json({ error: "This link has been invalidated." }, { status: 410 });
    }

    if (hasGitHubStorage()) {
      const url = originalSubscriptionUrl(body.link, request, existingToken);
      const record = await extendStoredSubscription(existingToken, verification.payload, url, body, nowSeconds);
      return NextResponse.json({ ...record, unchangedUrl: true });
    }

    const previousExpiresAtSeconds = verification.payload.exp;
    const expiresAtSeconds = parseExtendedExpiry(body, nowSeconds, previousExpiresAtSeconds);
    assertWithinMaxTtl(expiresAtSeconds, nowSeconds);

    const label = sanitizeLabel(body.label) ?? verification.payload.label;
    const payload: LinkPayload = {
      ...verification.payload,
      iat: nowSeconds,
      exp: expiresAtSeconds,
      label
    };

    if (!payload.label) {
      delete payload.label;
    }

    const token = createSignedToken(payload, requireLinkSecret());
    const url = buildSubscriptionUrl(request, token);

    return NextResponse.json({
      url,
      token,
      label: payload.label,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      expiresInSeconds: expiresAtSeconds - nowSeconds,
      previousExpiresAt: new Date(previousExpiresAtSeconds * 1000).toISOString(),
      wasExpired: verification.expired
    });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof URIError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to extend link.";

    return NextResponse.json({ error: message }, { status: error instanceof StorageError ? error.status : 500 });
  }
}
