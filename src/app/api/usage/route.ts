import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { usageLog } from "@/lib/db/schema";
import { eq, gte, and, count } from "drizzle-orm";
import { USAGE_LIMIT_PER_DAY } from "@/lib/constants";

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ value: used }] = await db
    .select({ value: count() })
    .from(usageLog)
    .where(and(eq(usageLog.userId, session.user.id), gte(usageLog.createdAt, today)));

  return NextResponse.json({ used, limit: USAGE_LIMIT_PER_DAY });
}
