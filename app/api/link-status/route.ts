import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import {
  BadRequestError,
  buildSubscriptionUrl,
  extractTokenFromLinkInput
} from "@/lib/link-admin";
import { isTokenRevoked } from "@/lib/revoked-links";
import { requireLinkSecret, verifySignedToken } from "@/lib/token";

type LinkStatusBody = {
  password?: unknown;
  link?: unknown;
  token?: unknown;
};

export async function POST(request: Request) {
  let body: LinkStatusBody;

  try {
    body = (await request.json()) as LinkStatusBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = extractTokenFromLinkInput(body.link ?? body.token);
    const verification = verifySignedToken(token, requireLinkSecret(), nowSeconds, {
      allowExpired: true
    });

    if (!verification.ok) {
      return NextResponse.json({ error: verification.message }, { status: verification.status });
    }

    const invalidated = await isTokenRevoked(token, nowSeconds);
    const { payload } = verification;
    const status = invalidated ? "invalidated" : verification.expired ? "expired" : "active";

    return NextResponse.json({
      url: buildSubscriptionUrl(request, token),
      token,
      label: payload.label,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      expiresInSeconds: payload.exp - nowSeconds,
      expired: verification.expired,
      invalidated,
      valid: status === "active",
      status
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to query link status.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
