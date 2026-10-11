import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import { BadRequestError, extractTokenFromLinkInput } from "@/lib/link-admin";
import { revokeToken } from "@/lib/revoked-links";
import { hasGitHubStorage, StorageError } from "@/lib/github-store";
import { invalidateStoredSubscription, originalSubscriptionUrl, resolveSubscription } from "@/lib/subscriptions";

type InvalidateLinkBody = {
  password?: unknown;
  link?: unknown;
  token?: unknown;
};

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: InvalidateLinkBody;

  try {
    body = (await request.json()) as InvalidateLinkBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError("Request body must be an object.");
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = extractTokenFromLinkInput(body.link ?? body.token);
    const verification = await resolveSubscription(token, nowSeconds);

    if (!verification.ok) {
      return NextResponse.json({ error: verification.message }, { status: verification.status });
    }

    if (hasGitHubStorage()) {
      const url = originalSubscriptionUrl(body.link, request, token);
      const record = await invalidateStoredSubscription(token, verification.payload, url, nowSeconds);
      return NextResponse.json({ ...record, alreadyExpired: record.expiresInSeconds <= 0 });
    }

    const alreadyInvalidated = verification.invalidated;
    const record = await revokeToken(token, verification.payload, nowSeconds);

    return NextResponse.json({
      token,
      tokenHash: record.tokenHash,
      label: record.label,
      expiresAt: record.expiresAt,
      invalidatedAt: record.invalidatedAt,
      alreadyExpired: verification.expired,
      alreadyInvalidated
    });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof URIError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to invalidate link.";

    return NextResponse.json({ error: message }, { status: error instanceof StorageError ? error.status : 500 });
  }
}
