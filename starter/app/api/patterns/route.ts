import { NextResponse } from "next/server"
import { patternsForOrder, sitePatterns } from "@/lib/agent/patterns"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const order = new URL(request.url).searchParams.get("order")
  return NextResponse.json({ patterns: order ? await patternsForOrder(order) : await sitePatterns() })
}
