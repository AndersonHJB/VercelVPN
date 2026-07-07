import { NextResponse } from "next/server";

import { isAdminPasswordValid } from "@/lib/auth";
import { clearStoredLinks, getStoredLinks, isHistoryStoreConfigured } from "@/lib/history-store";

type HistoryBody = {
  password?: unknown;
  action?: unknown;
};

export async function POST(request: Request) {
  let body: HistoryBody;

  try {
    body = (await request.json()) as HistoryBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }

    if (body.action === "list") {
      if (!isHistoryStoreConfigured()) {
        return NextResponse.json({ enabled: false, links: [] });
      }

      const links = await getStoredLinks();

      return NextResponse.json({ enabled: true, links });
    }

    if (body.action === "clear") {
      const result = await clearStoredLinks();

      return NextResponse.json({ enabled: result.enabled, links: [] });
    }

    return NextResponse.json({ error: "Unsupported history action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to access history cache.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
