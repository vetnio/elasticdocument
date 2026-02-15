import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

interface SummarizeParams {
  markdown: string;
  images: string[];
  readingMinutes: number;
  complexity: string;
  language: string;
}

function getComplexityInstruction(complexity: string): string {
  switch (complexity) {
    case "very_simple":
      return "Use very simple language that a 10-year-old could understand. Avoid jargon and technical terms entirely. Use short sentences and common words.";
    case "simple":
      return "Use simple, accessible language. Minimize jargon and explain any technical terms when they must be used. Keep sentences clear and straightforward.";
    case "standard":
      return "Use standard language appropriate for a general adult audience. Technical terms are acceptable when relevant, but keep the writing clear and well-organized.";
    default:
      return "Use simple, accessible language.";
  }
}

function buildSharedConstraints(params: SummarizeParams): string {
  const wordsPerMinute = 230;
  const targetWords = params.readingMinutes * wordsPerMinute;
  const complexityInstruction = getComplexityInstruction(params.complexity);

  return `CRITICAL CONSTRAINTS:
- Your output must NEVER exceed ${targetWords} words (approximately ${params.readingMinutes} minute(s) of reading at ${wordsPerMinute} WPM). This is a hard limit.
- If the original document is already short enough to fit within the time budget, keep your output at approximately the same length — do not pad, expand, or add filler.
- Write the entire output in ${params.language}.
- NEVER fabricate, infer, or hallucinate information that is not explicitly present in the source content below. Every fact, claim, and detail in your output must come directly from the provided source material.
- If the source content is empty, nearly empty, or contains only meaningless fragments (e.g. garbled OCR output, just filenames, only whitespace/separators), respond ONLY with: "The uploaded document appears to be empty or could not be read. Please try uploading a different file."
- Do NOT attempt to guess what a document might contain based on its filename, metadata, or any other context outside the source content itself.
- If parts of the source are unclear or incomplete due to OCR errors, summarize only what is legible. Do not fill in gaps with assumptions.

LANGUAGE & TONE:
- ${complexityInstruction}
- Maintain a neutral, informative tone. Do not editorialize or add opinions.
- If the source material uses domain-specific terminology that is essential to understanding, keep those terms but briefly explain them when the complexity level requires it.

CONTENT PRIORITIES:
- Preserve key arguments, conclusions, data points, statistics, and actionable information.
- Maintain cause-and-effect relationships and logical flow.
- If the source contains citations or references to specific studies/sources, preserve the most important ones.
- Omit redundant examples, verbose explanations, filler phrases, and tangential content.
- When multiple documents are combined, organize by topic rather than by source document. Do not label sections by source filename.`;
}

export function buildFormattedPrompt(params: SummarizeParams): string {
  const shared = buildSharedConstraints(params);

  const imageInstructions =
    params.images.length > 0
      ? `\n\nThe following images were extracted from the source documents. Include relevant images using markdown image syntax (![description](url)) where they add value to understanding the content:\n${params.images.map((img, i) => `- Image ${i + 1}: ${img}`).join("\n")}`
      : "";

  return `You are an expert document summarizer and restructurer. Your job is to take the following document content and produce a well-formatted summary for reading on screen.

${shared}

FORMAT INSTRUCTIONS:
- Begin with a concise overview paragraph (2-3 sentences) capturing the document's main thesis or purpose.
- Use clear markdown headings (## for sections, ### for subsections) to organize the content logically.
- Use bullet points for lists of items, key takeaways, or enumerations.
- Use numbered lists only when order matters (steps, rankings, chronological events).
- Preserve any tables from the source in markdown table format if they contain important data. Simplify large tables by keeping only the most relevant rows/columns.
- Preserve code blocks and their language annotations if present in the source.
- Keep direct quotes only if they are essential — attribute them clearly.${imageInstructions}

SOURCE CONTENT:

${params.markdown}`;
}

export function buildBreadtextPrompt(params: SummarizeParams): string {
  const shared = buildSharedConstraints(params);

  return `You are an expert document summarizer. Your job is to take the following document content and produce a continuous prose summary optimized for speed reading (one word at a time on screen).

${shared}

FORMAT INSTRUCTIONS:
- Write as continuous flowing prose. NO headings, NO bullet points, NO numbered lists, NO tables, NO code blocks, NO markdown formatting of any kind (no bold, no italic, no links).
- Use only plain sentences organized into paragraphs separated by blank lines.
- Use clear topic transitions between paragraphs so the reader can follow the logical flow without visual formatting cues.
- Optimize for one-word-at-a-time reading: prefer shorter sentences, avoid parenthetical asides, and keep clause structures simple.
- Do NOT include any images.

SOURCE CONTENT:

${params.markdown}`;
}

/**
 * Stream the formatted summary from Claude. Yields text chunks as they arrive.
 */
export async function* streamFormattedSummary(params: SummarizeParams): AsyncGenerator<string> {
  const prompt = buildFormattedPrompt(params);

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

/**
 * Stream the breadtext summary from Claude. Yields text chunks as they arrive.
 */
export async function* streamBreadtextSummary(params: SummarizeParams): AsyncGenerator<string> {
  const prompt = buildBreadtextPrompt(params);

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
