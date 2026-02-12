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

export function buildPrompt(params: SummarizeParams): string {
  const wordsPerMinute = 230;
  const targetWords = params.readingMinutes * wordsPerMinute;

  const complexityInstruction = getComplexityInstruction(params.complexity);

  const imageInstructions =
    params.images.length > 0
      ? `\n\nThe following images were extracted from the source documents. Include relevant images in your output using markdown image syntax (![description](url)) where they add value to understanding the content:\n${params.images.map((img, i) => `- Image ${i + 1}: ${img}`).join("\n")}`
      : "";

  return `You are an expert document summarizer and restructurer. Your job is to take the following document content and rewrite it so a reader can absorb the key information in approximately ${params.readingMinutes} minute(s) of reading time (approximately ${targetWords} words).

CRITICAL CONSTRAINTS:
- Your output must NEVER exceed ${targetWords} words. This is a hard limit.
- If the original document is already short enough to fit within the time budget, keep your output at approximately the same length — do not pad, expand, or add filler.
- Write the entire output in ${params.language}.

LANGUAGE & TONE:
- ${complexityInstruction}
- Maintain a neutral, informative tone. Do not editorialize or add opinions.
- If the source material uses domain-specific terminology that is essential to understanding, keep those terms but briefly explain them when the complexity level requires it.

STRUCTURE & FORMATTING:
- Begin with a concise overview paragraph (2-3 sentences) capturing the document's main thesis or purpose.
- Use clear markdown headings (## for sections, ### for subsections) to organize the content logically.
- Use bullet points for lists of items, key takeaways, or enumerations.
- Use numbered lists only when order matters (steps, rankings, chronological events).
- Preserve any tables from the source in markdown table format if they contain important data. Simplify large tables by keeping only the most relevant rows/columns.
- Preserve code blocks and their language annotations if present in the source.
- Keep direct quotes only if they are essential — attribute them clearly.

CONTENT PRIORITIES:
- Preserve key arguments, conclusions, data points, statistics, and actionable information.
- Maintain cause-and-effect relationships and logical flow.
- If the source contains citations or references to specific studies/sources, preserve the most important ones.
- Omit redundant examples, verbose explanations, filler phrases, and tangential content.
- When multiple documents are combined, organize by topic rather than by source document. Do not label sections by source filename.${imageInstructions}

SOURCE CONTENT:

${params.markdown}`;
}

export async function* streamSummary(params: SummarizeParams): AsyncGenerator<string> {
  const prompt = buildPrompt(params);

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
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
