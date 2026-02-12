import * as mupdf from "mupdf";
import { extractAndUploadImages } from "@/lib/image-extract";

export interface OcrResult {
  markdown: string;
  images: string[];
}

const OCR_TIMEOUT_MS = 180_000;
const MAX_PDF_PAGES = 50;

const DOTS_OCR_PROMPT = `Please output the layout information from the PDF image, including each layout element's bbox, its category, and the corresponding text content within the bbox.

1. Bbox format: [x1, y1, x2, y2]

2. Layout Categories: ['Caption', 'Footnote', 'Formula', 'List-item', 'Page-footer', 'Page-header', 'Picture', 'Section-header', 'Table', 'Text', 'Title'].

3. Text Extraction & Formatting Rules:
    - Picture: Omit text field
    - Formula: Format as LaTeX
    - Table: Format as HTML
    - Others: Format as Markdown

4. Constraints:
    - Output original text with no translation
    - Sort all layout elements by reading order

5. Final Output: Single JSON object`;

interface LayoutElement {
  bbox: number[];
  category: string;
  text?: string;
}

function layoutToMarkdown(elements: LayoutElement[]): { markdown: string; pictureBboxes: number[][] } {
  const parts: string[] = [];
  const pictureBboxes: number[][] = [];

  for (const el of elements) {
    switch (el.category) {
      case "Title":
        parts.push(`# ${el.text ?? ""}`);
        break;
      case "Section-header":
        parts.push(`## ${el.text ?? ""}`);
        break;
      case "Text":
        parts.push(el.text ?? "");
        break;
      case "List-item":
        parts.push(`- ${el.text ?? ""}`);
        break;
      case "Formula":
        parts.push(`$$\n${el.text ?? ""}\n$$`);
        break;
      case "Table":
        // Already formatted as HTML by the model
        parts.push(el.text ?? "");
        break;
      case "Caption":
        parts.push(`*${el.text ?? ""}*`);
        break;
      case "Footnote":
        parts.push(`> ${el.text ?? ""}`);
        break;
      case "Picture": {
        const idx = pictureBboxes.length;
        pictureBboxes.push(el.bbox);
        parts.push(`__IMAGE_PLACEHOLDER_${idx}__`);
        break;
      }
      case "Page-header":
      case "Page-footer":
        // Skip headers/footers for cleaner output
        break;
      default:
        if (el.text) parts.push(el.text);
    }
  }

  return { markdown: parts.join("\n\n"), pictureBboxes };
}

function detectMimeType(contentType: string | null, url: string): string {
  if (contentType?.includes("image/png")) return "image/png";
  if (contentType?.includes("image/webp")) return "image/webp";
  if (contentType?.includes("image/gif")) return "image/gif";
  if (contentType?.includes("application/pdf")) return "application/pdf";
  if (contentType?.includes("image/jpeg") || contentType?.includes("image/jpg")) return "image/jpeg";

  // Fallback: guess from URL extension
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

/** Convert a PDF buffer into an array of PNG page images using MuPDF WASM. */
function pdfToImages(pdfBuffer: Buffer): Buffer[] {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageCount = Math.min(doc.countPages(), MAX_PDF_PAGES);
  const images: Buffer[] = [];

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    // Scale 2x (≈200 DPI) for optimal OCR quality per model docs
    const pixmap = page.toPixmap(
      [2, 0, 0, 2, 0, 0],
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    images.push(Buffer.from(pixmap.asPNG()));
  }

  return images;
}

/** Send a single image buffer to the dots.ocr endpoint and parse the response. */
async function ocrSingleImage(
  base64Content: string,
  mimeType: string,
  apiUrl: string,
  apiKey: string,
  signal: AbortSignal,
  imageBuffer: Buffer,
  userId: string,
  pageIndex: number,
): Promise<OcrResult> {
  const dataUri = `data:${mimeType};base64,${base64Content}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "rednote-hilab/dots.ocr",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUri } },
            { type: "text", text: DOTS_OCR_PROMPT },
          ],
        },
      ],
      max_tokens: 24000,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OCR failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const content: string = result.choices?.[0]?.message?.content ?? "";

  // Try to parse structured JSON, fall back to raw text
  try {
    const jsonStr = content.replace(/^```json\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    const parsed = JSON.parse(jsonStr);
    const elements: LayoutElement[] = parsed.layout_elements ?? parsed;
    if (Array.isArray(elements)) {
      const { markdown, pictureBboxes } = layoutToMarkdown(elements);

      // Extract and upload images from detected picture regions
      const extracted = await extractAndUploadImages(imageBuffer, pictureBboxes, userId, pageIndex);

      // Build a map from placeholder index to URL
      const urlByIndex = new Map<number, string>();
      for (const img of extracted) {
        const idx = pictureBboxes.indexOf(img.bbox);
        if (idx !== -1) urlByIndex.set(idx, img.url);
      }

      // Replace placeholders with real image markdown or remove them
      let finalMarkdown = markdown;
      for (let i = 0; i < pictureBboxes.length; i++) {
        const placeholder = `__IMAGE_PLACEHOLDER_${i}__`;
        const url = urlByIndex.get(i);
        if (url) {
          finalMarkdown = finalMarkdown.replace(placeholder, `![Document image](${url})`);
        } else {
          finalMarkdown = finalMarkdown.replace(placeholder, "");
        }
      }

      const images = extracted.map((e) => e.url);
      return { markdown: finalMarkdown, images };
    }
  } catch {
    // JSON parsing failed — use raw content as markdown
  }

  return { markdown: content, images: [] };
}

export async function runOcr(fileUrl: string, userId: string): Promise<OcrResult> {
  const endpoint = process.env.HUGGINGFACE_OCR_ENDPOINT;
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("Hugging Face OCR endpoint or API key not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    // Fetch the file content
    const fileResponse = await fetch(fileUrl, { signal: controller.signal });
    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch file from ${fileUrl}`);
    }

    const mimeType = detectMimeType(fileResponse.headers.get("content-type"), fileUrl);
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const apiUrl = endpoint.replace(/\/+$/, "") + "/v1/chat/completions";

    // PDFs: convert each page to a PNG image, OCR each page separately
    if (mimeType === "application/pdf") {
      const pageImages = pdfToImages(fileBuffer);

      if (pageImages.length === 0) {
        throw new Error("PDF has no pages");
      }

      let combinedMarkdown = "";
      const allImages: string[] = [];

      for (let i = 0; i < pageImages.length; i++) {
        if (controller.signal.aborted) break;
        const pageBase64 = pageImages[i].toString("base64");
        const pageResult = await ocrSingleImage(
          pageBase64, "image/png", apiUrl, apiKey, controller.signal,
          pageImages[i], userId, i,
        );
        combinedMarkdown += (i > 0 ? "\n\n" : "") + pageResult.markdown;
        allImages.push(...pageResult.images);
      }

      return { markdown: combinedMarkdown, images: allImages };
    }

    // Images: send directly
    const base64Content = fileBuffer.toString("base64");
    return await ocrSingleImage(
      base64Content, mimeType, apiUrl, apiKey, controller.signal,
      fileBuffer, userId, 0,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("OCR timed out after 180 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
