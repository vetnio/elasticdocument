import { put } from "@vercel/blob";

export async function scrapeUrl(url: string, userId: string): Promise<{ blobUrl: string; fileName: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; elasticdocument/1.0)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL (${response.status}): ${url}`);
    }

    const contentType = response.headers.get("content-type") || "text/html";
    const content = await response.arrayBuffer();

    // Generate a safe filename from the URL
    const urlObj = new URL(url);
    const fileName = `${urlObj.hostname}${urlObj.pathname}`
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 100) + ".html";

    // Store the scraped content in blob storage
    const blob = await put(
      `documents/${userId}/${crypto.randomUUID()}-${fileName}`,
      new Blob([content], { type: contentType }),
      { access: "public" }
    );

    return { blobUrl: blob.url, fileName };
  } finally {
    clearTimeout(timeout);
  }
}
