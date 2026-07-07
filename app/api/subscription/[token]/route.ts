import { getYamlContent } from "@/lib/yaml";
import { requireLinkSecret, verifySignedToken } from "@/lib/token";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;

  try {
    const verification = verifySignedToken(decodeURIComponent(token), requireLinkSecret());

    if (!verification.ok) {
      return new Response(verification.message, {
        status: verification.status,
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
        "content-disposition": 'inline; filename="subscription.yaml"',
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server configuration error.";

    return new Response(message, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0"
      }
    });
  }
}
