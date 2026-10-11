import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import {
  BadRequestError,
  extractTokenFromLinkInput
} from "@/lib/link-admin";
import { StorageError } from "@/lib/github-store";
import { originalSubscriptionUrl, resolveSubscription } from "@/lib/subscriptions";

type LinkStatusBody = {
  password?: unknown;
  link?: unknown;
  token?: unknown;
};

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: LinkStatusBody;

  try {
    body = (await request.json()) as LinkStatusBody;
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

    const invalidated = verification.invalidated;
    const { payload } = verification;
    const status = invalidated ? "invalidated" : verification.expired ? "expired" : "active";

    return NextResponse.json({
      url: verification.record?.url ?? originalSubscriptionUrl(body.link, request, token),
      token,
      label: verification.label,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(verification.expiresAtSeconds * 1000).toISOString(),
      expiresInSeconds: verification.expiresAtSeconds - nowSeconds,
      expired: verification.expired,
      invalidated,
      valid: status === "active",
      status
    });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof URIError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to query link status.";

    return NextResponse.json({ error: message }, { status: error instanceof StorageError ? error.status : 500 });
  }
}
