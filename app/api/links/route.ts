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
import { appendStoredLink } from "@/lib/history-store";
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
    const createdAt = new Date(nowSeconds * 1000).toISOString();
    const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
    const expiresInSeconds = expiresAtSeconds - nowSeconds;
    let historyCached = false;

    try {
      const history = await appendStoredLink({
        url,
        token,
        label: payload.label,
        expiresAt,
        expiresInSeconds,
        createdAt,
        source: "created"
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
      createdAt,
      source: "created",
      historyCached
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to create link.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
