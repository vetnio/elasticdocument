import { Mistral } from "@mistralai/mistralai";
import { put } from "@vercel/blob";

export interface OcrResult {
  markdown: string;
  images: string[];
}

const OCR_TIMEOUT_MS = 180_000;

function detectMimeType(contentType: string | null, url: string): string {
  if (contentType?.includes("image/png")) return "image/png";
  if (contentType?.includes("image/webp")) return "image/webp";
  if (contentType?.includes("image/gif")) return "image/gif";
  if (contentType?.includes("application/pdf")) return "application/pdf";
  if (contentType?.includes("image/jpeg") || contentType?.includes("image/jpg")) return "image/jpeg";

  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

export async function runOcr(fileUrl: string, userId: string): Promise<OcrResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY not configured");
  }

  const mistral = new Mistral({ apiKey });

  // Fetch file to determine type and build a data URI for the API
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    const fileResponse = await fetch(fileUrl, { signal: controller.signal });
    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch file from ${fileUrl}`);
    }

    const mimeType = detectMimeType(fileResponse.headers.get("content-type"), fileUrl);
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const base64 = fileBuffer.toString("base64");
    const dataUri = `data:${mimeType};base64,${base64}`;

    const isImage = mimeType.startsWith("image/");

    const ocrResponse = await mistral.ocr.process({
      model: "mistral-ocr-latest",
      document: isImage
        ? { type: "image_url", imageUrl: dataUri }
        : { type: "document_url", documentUrl: dataUri },
      includeImageBase64: true,
    });

    // Combine per-page markdown
    const pages = ocrResponse.pages ?? [];
    let combinedMarkdown = pages.map((p) => p.markdown).join("\n\n");

    // Upload extracted images to Vercel Blob and replace references in markdown
    const allImageUrls: string[] = [];

    for (const page of pages) {
      if (!page.images || page.images.length === 0) continue;

      for (const img of page.images) {
        if (!img.imageBase64) continue;

        // Upload base64 image to Vercel Blob
        const imageBuffer = Buffer.from(img.imageBase64, "base64");
        const blobPath = `images/${userId}/${crypto.randomUUID()}.png`;
        const blob = await put(blobPath, imageBuffer, {
          access: "public",
          contentType: "image/png",
        });

        allImageUrls.push(blob.url);

        // Replace the image reference in markdown (Mistral uses ![id](id) format)
        if (img.id) {
          combinedMarkdown = combinedMarkdown.replaceAll(
            `](${img.id})`,
            `](${blob.url})`
          );
        }
      }
    }

    return { markdown: combinedMarkdown, images: allImageUrls };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("OCR timed out after 180 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
