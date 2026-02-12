import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  processedResult,
  usageLog,
  documentToProcessedResult,
} from "@/lib/db/schema";
import { eq, gte, and, count } from "drizzle-orm";
import { USAGE_LIMIT_PER_DAY, COMPLEXITY_LEVELS, LANGUAGES } from "@/lib/constants";

const VALID_COMPLEXITY_VALUES = COMPLEXITY_LEVELS.map((l) => l.value);

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.banned) {
    return NextResponse.json({ error: "Your account has been suspended" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { originalResultId, readingMinutes, complexity, language } = body;

  // Validate inputs
  if (typeof originalResultId !== "string" || !originalResultId) {
    return NextResponse.json({ error: "Missing original result ID" }, { status: 400 });
  }

  if (typeof readingMinutes !== "number" || readingMinutes < 1 || readingMinutes > 1000) {
    return NextResponse.json({ error: "Invalid reading time" }, { status: 400 });
  }

  if (!VALID_COMPLEXITY_VALUES.includes(complexity)) {
    return NextResponse.json({ error: "Invalid complexity level" }, { status: 400 });
  }

  if (!LANGUAGES.includes(language)) {
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  }

  // Get original result with its documents
  const original = await db.query.processedResult.findFirst({
    where: and(eq(processedResult.id, originalResultId), eq(processedResult.userId, session.user.id)),
    with: { documentToProcessedResults: { with: { document: true } } },
  });

  if (!original) {
    return NextResponse.json({ error: "Original result not found" }, { status: 404 });
  }

  const originalDocuments = original.documentToProcessedResults.map((r) => r.document);

  // Create new result + check usage + log in a single transaction to prevent race conditions
  let limitExceeded = false;
  const result = await db.transaction(async (tx) => {
    // Check usage limits inside transaction to prevent race conditions
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ value: usageCount }] = await tx
      .select({ value: count() })
      .from(usageLog)
      .where(and(eq(usageLog.userId, session.user.id), gte(usageLog.createdAt, today)));

    if (usageCount >= USAGE_LIMIT_PER_DAY) {
      limitExceeded = true;
      return null;
    }

    const [newResult] = await tx
      .insert(processedResult)
      .values({
        userId: session.user.id,
        readingMinutes,
        complexityLevel: complexity,
        outputLanguage: language,
        markdownContent: original.markdownContent,
        extractedImages: original.extractedImages,
        outputContent: "",
        outputImages: [],
      })
      .returning();

    // Link documents to the new result via the join table
    for (const doc of originalDocuments) {
      await tx.insert(documentToProcessedResult).values({
        A: doc.id,
        B: newResult.id,
      });
    }

    await tx.insert(usageLog).values({
      userId: session.user.id,
      action: "reprocess_document",
    });

    return newResult;
  });

  if (limitExceeded || !result) {
    return NextResponse.json(
      { error: `Daily limit of ${USAGE_LIMIT_PER_DAY} reached. Try again tomorrow.` },
      { status: 429 }
    );
  }

  return NextResponse.json({ resultId: result.id });
}
