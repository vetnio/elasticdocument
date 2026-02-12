export interface OcrResult {
  markdown: string;
  images: string[];
}

const OCR_TIMEOUT_MS = 120_000;

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

function layoutToMarkdown(elements: LayoutElement[]): { markdown: string; images: string[] } {
  const parts: string[] = [];
  const images: string[] = [];

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
      case "Picture":
        // No text content for pictures, but track them
        images.push(`picture_bbox_${el.bbox.join("_")}`);
        break;
      case "Page-header":
      case "Page-footer":
        // Skip headers/footers for cleaner output
        break;
      default:
        if (el.text) parts.push(el.text);
    }
  }

  return { markdown: parts.join("\n\n"), images };
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

export async function runOcr(fileUrl: string): Promise<OcrResult> {
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
    const fileBuffer = await fileResponse.arrayBuffer();
    const base64Content = Buffer.from(fileBuffer).toString("base64");
    const dataUri = `data:${mimeType};base64,${base64Content}`;

    // Call the HF Inference Endpoint using OpenAI-compatible chat completions API
    const apiUrl = endpoint.replace(/\/+$/, "") + "/v1/chat/completions";

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tgi",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: dataUri },
              },
              {
                type: "text",
                text: DOTS_OCR_PROMPT,
              },
            ],
          },
        ],
        max_tokens: 24000,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OCR failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Extract the model's text output from the chat completions response
    const content: string = result.choices?.[0]?.message?.content ?? "";

    // The model returns a JSON object with layout_elements
    // Try to parse it, falling back to raw text if parsing fails
    try {
      // The content may be wrapped in ```json ... ``` code fences
      const jsonStr = content.replace(/^```json\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
      const parsed = JSON.parse(jsonStr);
      const elements: LayoutElement[] = parsed.layout_elements ?? parsed;
      if (Array.isArray(elements)) {
        return layoutToMarkdown(elements);
      }
    } catch {
      // JSON parsing failed — use raw content as markdown
    }

    return { markdown: content, images: [] };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("OCR timed out after 120 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
