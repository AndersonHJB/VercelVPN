import { NextResponse } from "next/server";
import { isAdminPasswordValid } from "@/lib/auth";
import { hasGitHubStorage, StorageError } from "@/lib/github-store";
import { BadRequestError } from "@/lib/link-admin";
import { listSubscriptions, syncSubscriptions } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError("请求格式无效。");
    if (!isAdminPasswordValid(body.password)) {
      return NextResponse.json({ error: "Admin password is incorrect." }, { status: 401 });
    }
    if (body.action === "list") {
      return NextResponse.json({ configured: hasGitHubStorage(), links: hasGitHubStorage() ? await listSubscriptions() : [] }, { headers: { "cache-control": "private, no-store" } });
    }
    if (body.action !== "sync" || !Array.isArray(body.links)) throw new BadRequestError("请指定 list 或 sync 操作及有效的记录列表。");
    if (!hasGitHubStorage()) throw new StorageError("GitHub 存储尚未配置，请先设置服务端环境变量。");
    return NextResponse.json(await syncSubscriptions(body.links, request), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof BadRequestError || error instanceof SyntaxError ? 400 : error instanceof StorageError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "订阅数据操作失败。" }, { status });
  }
}
