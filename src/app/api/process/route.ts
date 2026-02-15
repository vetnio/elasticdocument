import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  document,
  processedResult,
  usageLog,
  documentToProcessedResult,
} from "@/lib/db/schema";
import { eq, gte, and, count } from "drizzle-orm";
import { USAGE_LIMIT_PER_DAY, COMPLEXITY_LEVELS, LANGUAGES, MAX_FILES } from "@/lib/constants";

const VALID_COMPLEXITY_VALUES = COMPLEXITY_LEVELS.map((l) => l.value);

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

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

  const { files, urls, readingMinutes, complexity, language } = body;

  // Validate inputs
  if ((!Array.isArray(files) || files.length === 0) && (!Array.isArray(urls) || urls.length === 0)) {
    return NextResponse.json({ error: "No files or URLs provided" }, { status: 400 });
  }

  if ((files?.length || 0) + (urls?.length || 0) > MAX_FILES) {
    return NextResponse.json({ error: `Maximum ${MAX_FILES} items allowed` }, { status: 400 });
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

  // Validate URLs
  for (const url of urls || []) {
    if (typeof url !== "string" || !isValidUrl(url)) {
      return NextResponse.json({ error: `Invalid URL: ${url}` }, { status: 400 });
    }
  }

  // Validate files
  for (const file of files || []) {
    if (!file.fileName || !file.blobUrl || typeof file.fileSize !== "number") {
      return NextResponse.json({ error: "Invalid file data" }, { status: 400 });
    }
  }

  // Create all records in a transaction to prevent orphaned records and race conditions
  let limitExceeded = false;
  let result;
  try {
  result = await db.transaction(async (tx) => {
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

    // Create document records for uploaded files
    const documentIds: string[] = [];

    for (const file of files || []) {
      const [doc] = await tx
        .insert(document)
        .values({
          userId: session.user.id,
          fileName: String(file.fileName).slice(0, 500),
          fileType: String(file.fileType || "application/octet-stream").slice(0, 100),
          fileSize: file.fileSize,
          blobUrl: file.blobUrl,
          isUrl: false,
        })
        .returning();
      documentIds.push(doc.id);
    }

    // Create document records for URLs
    for (const url of urls || []) {
      const [doc] = await tx
        .insert(document)
        .values({
          userId: session.user.id,
          fileName: String(url).slice(0, 500),
          fileType: "text/html",
          fileSize: 0,
          blobUrl: "",
          isUrl: true,
          sourceUrl: url,
        })
        .returning();
      documentIds.push(doc.id);
    }

    // Create the processed result record
    const [result] = await tx
      .insert(processedResult)
      .values({
        userId: session.user.id,
        readingMinutes,
        complexityLevel: complexity,
        outputLanguage: language,
        markdownContent: "",
        extractedImages: [],
        outputContent: "",
        outputImages: [],
      })
      .returning();

    // Link documents to the processed result via the join table
    for (const docId of documentIds) {
      await tx.insert(documentToProcessedResult).values({
        A: docId,
        B: result.id,
      });
    }

    // Log usage
    await tx.insert(usageLog).values({
      userId: session.user.id,
      action: "process_document",
    });

    return result;
  });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create summarization job";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (limitExceeded || !result) {
    return NextResponse.json(
      { error: `Daily limit of ${USAGE_LIMIT_PER_DAY} summarized documents reached. Try again tomorrow.` },
      { status: 429 }
    );
  }

  return NextResponse.json({ resultId: result.id });
}
