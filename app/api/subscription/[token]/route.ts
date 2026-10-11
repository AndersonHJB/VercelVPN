import { getYamlContent } from "@/lib/yaml";
import { StorageError } from "@/lib/github-store";
import { resolveSubscription } from "@/lib/subscriptions";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

const subscriptionFilename = "subscription.yaml";

export const runtime = "nodejs";
export const maxDuration = 60;

function buildSubscriptionUserinfo(expiresAtSeconds: number): string {
  return `upload=0; download=0; total=0; expire=${expiresAtSeconds}`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    const decodedToken = decodeURIComponent(token);
    const verification = await resolveSubscription(decodedToken);

    if (!verification.ok) {
      return new Response(verification.message, {
        status: verification.status,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store, max-age=0"
        }
      });
    }

    if (verification.invalidated || verification.expired) {
      return new Response(verification.invalidated ? "This link has been invalidated." : "This link has expired.", {
        status: 410,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store, max-age=0"
        }
      });
    }

    const yaml = await getYamlContent();

    return new Response(yaml, {
      status: 200,
      headers: {
        "content-type": "text/yaml; charset=utf-8",
        "content-disposition": `inline; filename=${subscriptionFilename}`,
        "subscription-userinfo": buildSubscriptionUserinfo(verification.expiresAtSeconds),
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    const message = error instanceof StorageError ? "Subscription storage is temporarily unavailable. Please retry later." : "Server configuration error.";

    return new Response(message, {
      status: error instanceof URIError ? 400 : error instanceof StorageError ? error.status : 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0"
      }
    });
  }
}
