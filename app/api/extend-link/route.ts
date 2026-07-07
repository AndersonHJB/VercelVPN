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
import { appendStoredLink } from "@/lib/history-store";
import { createSignedToken, requireLinkSecret, type LinkPayload, verifySignedToken } from "@/lib/token";

type ExtendLinkBody = {
  password?: unknown;
  link?: unknown;
  token?: unknown;
  label?: unknown;
  ttlMinutes?: unknown;
  expiresAt?: unknown;
};

export async function POST(request: Request) {
  let body: ExtendLinkBody;

  try {
    body = (await request.json()) as ExtendLinkBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const existingToken = extractTokenFromLinkInput(body.link ?? body.token);
    const secret = requireLinkSecret();
    const verification = verifySignedToken(existingToken, secret, nowSeconds, {
      allowExpired: true
    });

    if (!verification.ok) {
      return NextResponse.json({ error: verification.message }, { status: verification.status });
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

    const token = createSignedToken(payload, secret);
    const url = buildSubscriptionUrl(request, token);
    const createdAt = new Date(nowSeconds * 1000).toISOString();
    const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
    const previousExpiresAt = new Date(previousExpiresAtSeconds * 1000).toISOString();
    const expiresInSeconds = expiresAtSeconds - nowSeconds;
    let historyCached = false;

    try {
      const history = await appendStoredLink({
        url,
        token,
        label: payload.label,
        expiresAt,
        expiresInSeconds,
        previousExpiresAt,
        wasExpired: verification.expired,
        createdAt,
        source: "extended"
      });

      historyCached = history.enabled;
    } catch {
      historyCached = false;
    }

    return NextResponse.json({
      url,
      token,
      label: payload.label,
      expiresAt,
      expiresInSeconds,
      previousExpiresAt,
      wasExpired: verification.expired,
      createdAt,
      source: "extended",
      historyCached
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to extend link.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
