import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { processedResult } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id: unknown) => typeof id === "string")) {
    return NextResponse.json({ error: "Invalid IDs" }, { status: 400 });
  }

  // Only delete results owned by the current user
  const deleted = await db
    .delete(processedResult)
    .where(and(inArray(processedResult.id, ids), eq(processedResult.userId, session.user.id)))
    .returning();

  return NextResponse.json({ deleted: deleted.length });
}
