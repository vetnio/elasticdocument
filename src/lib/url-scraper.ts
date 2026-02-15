import { put } from "@vercel/blob";

/**
 * Scrape a URL and return the extracted text as markdown along with the blob URL.
 * Stores the raw HTML in blob storage for reference, and converts to markdown for processing.
 */
export async function scrapeUrl(
  url: string,
  userId: string
): Promise<{ blobUrl: string; fileName: string; markdown: string }> {
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
    const fileName =
      `${urlObj.hostname}${urlObj.pathname}`
        .replace(/[^a-zA-Z0-9]/g, "_")
        .slice(0, 100) + ".html";

    // Store the scraped content in blob storage
    const blob = await put(
      `documents/${userId}/${crypto.randomUUID()}-${fileName}`,
      new Blob([content], { type: contentType }),
      { access: "public" }
    );

    // Convert HTML to markdown-ish text for processing
    const html = new TextDecoder().decode(content);
    const markdown = htmlToMarkdown(html);

    return { blobUrl: blob.url, fileName, markdown };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Lightweight HTML to markdown converter.
 * Strips scripts, styles, and tags, preserving structure.
 */
function htmlToMarkdown(html: string): string {
  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Convert headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Convert paragraphs and divs to line breaks
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Convert links: <a href="url">text</a> → [text](url)
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert bold/italic
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");

  // Convert blockquotes
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "> $1\n");

  // Convert pre/code blocks
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  // Clean up whitespace: collapse runs of blank lines
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
