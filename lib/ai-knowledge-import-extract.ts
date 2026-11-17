/**
 * Text extraction for Knowledge Import (Phase 3C).
 * Never executes macros/scripts; returns plain text only.
 */

import type { AiKnowledgeImportFormat } from "@/lib/ai-knowledge-import";
import { normalizeExtractedText } from "@/lib/ai-knowledge-import";

export type ExtractResult =
  | { ok: true; text: string; parser: string }
  | { ok: false; error: string };

async function extractTxtOrMd(buffer: Buffer): Promise<ExtractResult> {
  let text: string;
  try {
    text = buffer.toString("utf8");
    // Reject if mostly replacement characters from wrong encoding
    if (text.includes("\uFFFD") && text.split("\uFFFD").length > 20) {
      text = buffer.toString("latin1");
    }
  } catch {
    return { ok: false, error: "Unable to decode text file." };
  }
  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    return { ok: false, error: "Extracted text is empty." };
  }
  return { ok: true, text: normalized, parser: "utf8-text" };
}

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  try {
    // pdf-parse v2: class PDFParse({ data }).getText()
    const mod = await import("pdf-parse");
    const PDFParse = (
      mod as unknown as {
        PDFParse?: new (opts: { data: Buffer | Uint8Array }) => {
          getText: () => Promise<{ text?: string }>;
          destroy: () => Promise<void>;
        };
      }
    ).PDFParse;
    if (!PDFParse) {
      return { ok: false, error: "PDF parser unavailable." };
    }
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const normalized = normalizeExtractedText(String(result?.text ?? ""));
      if (!normalized) {
        return {
          ok: false,
          error:
            "PDF produced empty text (scanned/image-only PDFs are not supported).",
        };
      }
      return { ok: true, text: normalized, parser: "pdf-parse" };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PDF extraction failed.";
    return { ok: false, error: `PDF extraction failed: ${message}` };
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  try {
    const mammoth = await import("mammoth");
    const extractRaw =
      mammoth.extractRawText ??
      (mammoth as unknown as { default?: { extractRawText?: typeof mammoth.extractRawText } })
        .default?.extractRawText;
    if (!extractRaw) {
      return { ok: false, error: "DOCX parser unavailable." };
    }
    const result = await extractRaw({ buffer });
    const normalized = normalizeExtractedText(String(result?.value ?? ""));
    if (!normalized) {
      return { ok: false, error: "DOCX produced empty text." };
    }
    return { ok: true, text: normalized, parser: "mammoth" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "DOCX extraction failed.";
    return { ok: false, error: `DOCX extraction failed: ${message}` };
  }
}

export async function extractKnowledgeImportText(
  format: AiKnowledgeImportFormat,
  buffer: Buffer,
): Promise<ExtractResult> {
  if (!buffer.length) {
    return { ok: false, error: "Empty file rejected." };
  }
  switch (format) {
    case "txt":
    case "md":
      return extractTxtOrMd(buffer);
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    default:
      return { ok: false, error: "Unsupported format." };
  }
}
