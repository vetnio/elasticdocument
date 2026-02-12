import sharp from "sharp";
import { put } from "@vercel/blob";
import { MAX_EXTRACTED_IMAGES_PER_PAGE, MIN_EXTRACTED_IMAGE_DIMENSION } from "@/lib/constants";

interface ExtractedImage {
  url: string;
  bbox: number[];
}

/**
 * Crop detected picture regions from a page image and upload to Vercel Blob.
 * Best-effort: individual failures are silently skipped.
 */
export async function extractAndUploadImages(
  imageBuffer: Buffer,
  bboxes: number[][],
  userId: string,
  pageIndex: number,
): Promise<ExtractedImage[]> {
  if (bboxes.length === 0) return [];

  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width ?? 0;
  const imgHeight = metadata.height ?? 0;

  if (imgWidth === 0 || imgHeight === 0) return [];

  const toProcess = bboxes.slice(0, MAX_EXTRACTED_IMAGES_PER_PAGE);

  const results = await Promise.allSettled(
    toProcess.map(async (bbox, i) => {
      const [x1, y1, x2, y2] = bbox;

      // Clamp to image bounds
      const left = Math.max(0, Math.round(x1));
      const top = Math.max(0, Math.round(y1));
      const right = Math.min(imgWidth, Math.round(x2));
      const bottom = Math.min(imgHeight, Math.round(y2));

      const width = right - left;
      const height = bottom - top;

      if (width < MIN_EXTRACTED_IMAGE_DIMENSION || height < MIN_EXTRACTED_IMAGE_DIMENSION) {
        return null;
      }

      const cropped = await sharp(imageBuffer)
        .extract({ left, top, width, height })
        .png()
        .toBuffer();

      const blobPath = `images/${userId}/${crypto.randomUUID()}-p${pageIndex}-img${i}.png`;
      const blob = await put(blobPath, cropped, {
        access: "public",
        contentType: "image/png",
      });

      return { url: blob.url, bbox } as ExtractedImage;
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<ExtractedImage | null> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value!);
}
