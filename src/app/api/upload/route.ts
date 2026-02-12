import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { MAX_FILE_SIZE } from "@/lib/constants";

// Magic byte signatures for allowed file types
const MAGIC_SIGNATURES: { bytes: number[]; offset?: number; mime: string }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" }, // %PDF
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" }, // PNG
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" }, // JPEG
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" }, // GIF
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp" }, // RIFF (WebP)
  { bytes: [0x42, 0x4d], mime: "image/bmp" }, // BMP
  { bytes: [0x49, 0x49, 0x2a, 0x00], mime: "image/tiff" }, // TIFF LE
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], mime: "image/tiff" }, // TIFF BE
  { bytes: [0x50, 0x4b, 0x03, 0x04], mime: "application/zip" }, // ZIP (docx/xlsx/pptx)
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], mime: "application/msoffice" }, // OLE2 (doc/xls/ppt)
];

function validateMagicBytes(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 16));

  // Allow text-based files (txt, md, csv, html, svg, rtf) — they won't match binary signatures
  // Check if the first bytes look like text (printable ASCII/UTF-8)
  const isLikelyText = bytes.length > 0 && bytes.slice(0, 4).every(
    (b) => (b >= 0x09 && b <= 0x0d) || (b >= 0x20 && b <= 0x7e) || b >= 0x80
  );

  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (bytes.length >= offset + sig.bytes.length) {
      const match = sig.bytes.every((b, i) => bytes[offset + i] === b);
      if (match) return true;
    }
  }

  return isLikelyText;
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 });
  }

  // Validate file content matches expected types via magic bytes
  const headerBytes = await file.slice(0, 16).arrayBuffer();
  if (!validateMagicBytes(headerBytes)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const blob = await put(`documents/${session.user.id}/${crypto.randomUUID()}-${file.name}`, file, {
    access: "public",
  });

  return NextResponse.json({ url: blob.url });
}
