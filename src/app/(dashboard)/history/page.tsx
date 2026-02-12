import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { processedResult } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import HistoryList from "./history-list";

export default async function HistoryPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const results = await db.query.processedResult.findMany({
    where: eq(processedResult.userId, session.user.id),
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
    orderBy: desc(processedResult.createdAt),
    limit: 200,
  });

  const serialized = results.map((r) => ({
    id: r.id,
    readingMinutes: r.readingMinutes,
    complexityLevel: r.complexityLevel,
    outputLanguage: r.outputLanguage,
    createdAt: r.createdAt.toISOString(),
    hasOutput: !!r.outputContent,
    documents: r.documentToProcessedResults.map((dtr) => dtr.document),
  }));

  return <HistoryList results={serialized} />;
}
