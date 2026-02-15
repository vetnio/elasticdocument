import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { document, processedResult } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { runOcr } from "@/lib/ocr";
import { scrapeUrl } from "@/lib/url-scraper";
import { streamFormattedSummary, streamBreadtextSummary } from "@/lib/summarize";

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await db.query.processedResult.findFirst({
    where: and(eq(processedResult.id, id), eq(processedResult.userId, session.user.id)),
    with: { documentToProcessedResults: { with: { document: true } } },
  });

  if (!result) {
    return new Response("Not found", { status: 404 });
  }

  const documents = result.documentToProcessedResults.map((r) => r.document);

  // If already processed, return the stored content
  if (result.outputContent) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "status", message: "Complete" })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "content", text: result.outputContent })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "breadtext", text: result.outputBreadtext })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "images", images: result.outputImages })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Atomically claim this result for processing to prevent concurrent runs.
  // Only succeeds if markdownContent is still empty (not already being processed).
  const PROCESSING_SENTINEL = "__processing__";
  const claimed = await db
    .update(processedResult)
    .set({ markdownContent: PROCESSING_SENTINEL })
    .where(
      and(
        eq(processedResult.id, result.id),
        eq(processedResult.markdownContent, ""),
      )
    )
    .returning({ id: processedResult.id });

  // If markdownContent was already non-empty (another request claimed it, or reprocessing has content),
  // check what's going on
  if (claimed.length === 0 && !result.markdownContent) {
    // Another request is already processing
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "status", message: "Already processing in another request. Please wait..." })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Process documents with streaming
  const abortSignal = request.signal;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Keep connection alive during long OCR operations
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Controller already closed
          clearInterval(heartbeat);
        }
      }, 15_000);

      // Stop processing early if client disconnects
      function onAbort() {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });

      try {
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        let combinedMarkdown = result.markdownContent === PROCESSING_SENTINEL ? "" : result.markdownContent;
        let allImages = [...result.extractedImages];

        // Skip OCR if markdown already exists (e.g., reprocessing)
        if (!combinedMarkdown) {
          // Step 1: Scrape URLs (extract text directly, no OCR needed)
          const urlDocs = documents.filter((d) => d.isUrl);
          const scrapedMarkdowns = new Map<string, string>();
          if (urlDocs.length > 0) {
            send({ type: "status", message: "Fetching web pages..." });
            for (const doc of urlDocs) {
              if (abortSignal.aborted) return;
              if (doc.sourceUrl) {
                try {
                  const scraped = await scrapeUrl(doc.sourceUrl, session.user.id);
                  await db
                    .update(document)
                    .set({ blobUrl: scraped.blobUrl, fileName: scraped.fileName })
                    .where(eq(document.id, doc.id));
                  doc.blobUrl = scraped.blobUrl;
                  scrapedMarkdowns.set(doc.id, scraped.markdown);
                } catch (err) {
                  send({ type: "error", message: `Failed to fetch ${doc.sourceUrl}: ${err instanceof Error ? err.message : "Unknown error"}` });
                }
              }
            }
          }

          if (abortSignal.aborted) return;

          // Step 2: Extract content from all documents
          send({ type: "status", message: "Extracting text and images..." });
          combinedMarkdown = "";
          allImages = [];

          for (const doc of documents) {
            if (abortSignal.aborted) return;

            // URL documents: use already-scraped markdown (no OCR)
            if (doc.isUrl) {
              const md = scrapedMarkdowns.get(doc.id);
              if (md) {
                combinedMarkdown += `\n\n--- ${doc.fileName} ---\n\n${md}`;
              }
              continue;
            }

            // File documents: run OCR
            if (!doc.blobUrl) continue;
            try {
              const ocrResult = await runOcr(doc.blobUrl, session.user.id);
              combinedMarkdown += `\n\n--- ${doc.fileName} ---\n\n${ocrResult.markdown}`;
              allImages.push(...ocrResult.images);
            } catch (err) {
              send({ type: "error", message: `OCR failed for ${doc.fileName}: ${err instanceof Error ? err.message : "Unknown error"}` });
            }
          }

          // Strip document separator lines to check if there's real content
          const contentOnly = combinedMarkdown.replace(/---\s*.+?\s*---/g, "").trim();
          if (!contentOnly) {
            // Reset sentinel so the result can be retried
            await db
              .update(processedResult)
              .set({ markdownContent: "" })
              .where(eq(processedResult.id, result.id));
            send({ type: "error", message: "No content could be extracted from the documents. The file may be empty or unreadable." });
            send({ type: "done" });
            clearInterval(heartbeat);
            abortSignal.removeEventListener("abort", onAbort);
            controller.close();
            return;
          }

          // Update the result with extracted markdown and images
          await db
            .update(processedResult)
            .set({
              markdownContent: combinedMarkdown,
              extractedImages: allImages,
            })
            .where(eq(processedResult.id, result.id));
        }

        if (abortSignal.aborted) return;

        // Step 3: Summarize with Claude — stream formatted and breadtext in parallel
        send({ type: "status", message: "Summarizing and restructuring..." });

        const summarizeParams = {
          markdown: combinedMarkdown,
          images: allImages,
          readingMinutes: result.readingMinutes,
          complexity: result.complexityLevel,
          language: result.outputLanguage,
        };

        // Parallel streaming with a shared push queue
        const pending: Array<object> = [];
        const q = { notify: null as (() => void) | null, fmtDone: false, btDone: false };

        function push(item: object) {
          pending.push(item);
          q.notify?.();
        }

        let formattedContent = "";
        let breadtext = "";

        // Start both streams concurrently
        const p1 = (async () => {
          try {
            for await (const chunk of streamFormattedSummary(summarizeParams)) {
              if (abortSignal.aborted) return;
              formattedContent += chunk;
              push({ type: "formatted_chunk", text: chunk });
            }
          } catch (err) {
            push({ type: "error", message: `Summarization failed: ${err instanceof Error ? err.message : "Unknown error"}` });
          }
          push({ type: "formatted_done" });
          q.fmtDone = true;
          q.notify?.();
        })();

        const p2 = (async () => {
          try {
            for await (const chunk of streamBreadtextSummary(summarizeParams)) {
              if (abortSignal.aborted) return;
              breadtext += chunk;
              push({ type: "breadtext_chunk", text: chunk });
            }
          } catch {
            // Breadtext failure is non-critical; formatted is the primary output
          }
          push({ type: "breadtext_done" });
          q.btDone = true;
          q.notify?.();
        })();

        // Drain loop — interleave chunks from both streams into SSE
        while (!q.fmtDone || !q.btDone) {
          if (abortSignal.aborted) return;
          if (pending.length === 0) {
            await new Promise<void>((r) => { q.notify = r; });
            q.notify = null;
          }
          while (pending.length > 0) {
            send(pending.shift()!);
          }
        }
        // Flush remaining
        while (pending.length > 0) {
          send(pending.shift()!);
        }

        await Promise.all([p1, p2]);

        formattedContent = formattedContent.trim();
        breadtext = breadtext.trim();

        // If summarization produced no output (API failure), don't cache the empty
        // result — leave markdownContent intact so retry skips OCR and just re-runs
        // summarization.
        if (!formattedContent) {
          send({ type: "error", message: "Failed to generate summary. Please try again." });
          send({ type: "done" });
          clearInterval(heartbeat);
          abortSignal.removeEventListener("abort", onAbort);
          controller.close();
          return;
        }

        // If Claude returned the "empty document" canned response, don't cache it
        const isEmptyResponse = formattedContent.includes("appears to be empty or could not be read");
        if (isEmptyResponse) {
          await db
            .update(processedResult)
            .set({ markdownContent: "" })
            .where(eq(processedResult.id, result.id));
          send({ type: "error", message: formattedContent });
          send({ type: "done" });
          clearInterval(heartbeat);
          abortSignal.removeEventListener("abort", onAbort);
          controller.close();
          return;
        }

        // Discard breadtext if it's an "empty" response
        if (breadtext.includes("appears to be empty or could not be read")) {
          breadtext = "";
        }

        // Find which images were referenced in either output
        const usedImages = allImages.filter((img) => formattedContent.includes(img) || breadtext.includes(img));

        // Save both versions
        await db
          .update(processedResult)
          .set({
            outputContent: formattedContent,
            outputBreadtext: breadtext,
            outputImages: usedImages,
          })
          .where(eq(processedResult.id, result.id));

        send({ type: "done" });
        clearInterval(heartbeat);
        abortSignal.removeEventListener("abort", onAbort);
        controller.close();
      } catch (err) {
        // Reset sentinel so the result can be retried
        await db
          .update(processedResult)
          .set({ markdownContent: "" })
          .where(
            and(
              eq(processedResult.id, result.id),
              eq(processedResult.markdownContent, PROCESSING_SENTINEL),
            )
          );
        if (abortSignal.aborted) return;
        const errorMessage = err instanceof Error ? err.message : "Processing failed";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        clearInterval(heartbeat);
        abortSignal.removeEventListener("abort", onAbort);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
