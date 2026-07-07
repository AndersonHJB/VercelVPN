import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import { BadRequestError, extractTokenFromLinkInput } from "@/lib/link-admin";
import { isTokenRevoked, revokeToken } from "@/lib/revoked-links";
import { requireLinkSecret, verifySignedToken } from "@/lib/token";

type InvalidateLinkBody = {
  password?: unknown;
  link?: unknown;
  token?: unknown;
};

export async function POST(request: Request) {
  let body: InvalidateLinkBody;

  try {
    body = (await request.json()) as InvalidateLinkBody;
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

    const alreadyInvalidated = await isTokenRevoked(token, nowSeconds);
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
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to invalidate link.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
