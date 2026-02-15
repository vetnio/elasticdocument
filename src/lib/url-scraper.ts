import { put } from "@vercel/blob";

/**
 * Scrape a URL and return the extracted text as markdown along with the blob URL.
 * Uses Jina Reader API to render JavaScript-heavy pages, with direct fetch as fallback.
 */
export async function scrapeUrl(
  url: string,
  userId: string
): Promise<{ blobUrl: string; fileName: string; markdown: string }> {
  // Generate a safe filename from the URL
  const urlObj = new URL(url);
  const fileName =
    `${urlObj.hostname}${urlObj.pathname}`
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 100) + ".html";

  // Try Jina Reader first (handles JS-rendered SPAs)
  let markdown = await fetchViaJinaReader(url);

  // Fallback: direct fetch + HTML-to-markdown if Jina fails or returns empty
  if (!markdown) {
    const { content, contentType } = await directFetch(url);

    // Store in blob storage
    const blob = await put(
      `documents/${userId}/${crypto.randomUUID()}-${fileName}`,
      new Blob([content], { type: contentType }),
      { access: "public" }
    );

    const html = new TextDecoder().decode(content);
    markdown = htmlToMarkdown(html);

    return { blobUrl: blob.url, fileName, markdown };
  }

  // Store the Jina Reader markdown in blob storage for reference
  const blob = await put(
    `documents/${userId}/${crypto.randomUUID()}-${fileName}`,
    new Blob([markdown], { type: "text/markdown" }),
    { access: "public" }
  );

  return { blobUrl: blob.url, fileName, markdown };
}

/**
 * Fetch a URL via Jina Reader API which renders JavaScript and returns markdown.
 * Returns the markdown string, or empty string if the request fails.
 */
async function fetchViaJinaReader(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/markdown",
        "X-Return-Format": "markdown",
        "X-No-Cache": "true",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return "";
    }

    const text = await response.text();

    // Check if the result has meaningful content
    const stripped = text.replace(/\s+/g, " ").trim();
    if (stripped.length < 50) {
      return "";
    }

    return text;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Direct HTTP fetch of a URL. Used as fallback when Jina Reader fails.
 */
async function directFetch(url: string): Promise<{ content: ArrayBuffer; contentType: string }> {
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

    return { content, contentType };
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
