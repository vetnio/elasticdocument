import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { processedResult } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db.query.processedResult.findFirst({
    where: and(eq(processedResult.id, id), eq(processedResult.userId, session.user.id)),
  });

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(processedResult).where(eq(processedResult.id, id));

  return NextResponse.json({ success: true });
}
