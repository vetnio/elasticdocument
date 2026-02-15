import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { processedResult } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import ResultView from "./result-view";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const result = await db.query.processedResult.findFirst({
    where: and(eq(processedResult.id, id), eq(processedResult.userId, session.user.id)),
    with: {
      documentToProcessedResults: {
        with: {
          document: {
            columns: {
              fileName: true,
              isUrl: true,
              sourceUrl: true,
            },
          },
        },
      },
    },
  });

  if (!result) {
    redirect("/history");
  }

  return (
    <ResultView
      result={{
        id: result.id,
        outputContent: result.outputContent ?? "",
        outputBreadtext: result.outputBreadtext ?? "",
        markdownContent: result.markdownContent,
        extractedImages: result.extractedImages,
        readingMinutes: result.readingMinutes,
        complexityLevel: result.complexityLevel,
        outputLanguage: result.outputLanguage,
        createdAt: result.createdAt.toISOString(),
        documents: result.documentToProcessedResults.map((dtr) => dtr.document),
        needsProcessing: !result.outputContent,
      }}
    />
  );
}
