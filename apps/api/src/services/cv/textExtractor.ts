import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { sniffFileType } from '../storage/fileSniffer';

// Security: maximum uncompressed text size accepted from a DOCX/ZIP entry (50 MB).
// This guards against decompression bombs where a tiny .docx expands to gigabytes.
const DOCX_MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;

export interface ExtractionResult {
  text: string;
  isScanned: boolean;
  fileType: 'pdf' | 'docx';
}

export async function extractCvText(buffer: Buffer): Promise<ExtractionResult> {
  const fileType = sniffFileType(buffer);

  if (fileType === 'unknown') {
    throw new Error('Unsupported or corrupted file format. Only valid PDF and DOCX files are allowed.');
  }

  if (fileType === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = (result.value || '').trim();

      // Decompression size cap: reject if extracted text is unreasonably large
      if (Buffer.byteLength(text, 'utf8') > DOCX_MAX_EXTRACTED_BYTES) {
        throw new Error(
          `DOCX extracted text exceeds the 50 MB decompression cap (possible zip-bomb). File rejected.`
        );
      }

      return {
        text: text || '[EMPTY_DOCX_FILE]',
        isScanned: false,
        fileType: 'docx',
      };
    } catch (err: any) {
      // Re-throw our own security errors immediately
      if (err.message?.includes('decompression cap')) throw err;

      // Fallback: extract <w:t> XML tags from buffer
      const str = buffer.toString('utf-8');
      const wtRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
      const textMatches: string[] = [];
      let match;
      while ((match = wtRegex.exec(str)) !== null) {
        textMatches.push(match[1]);
      }
      if (textMatches.length > 0) {
        const joined = textMatches.join(' ').trim();
        // Decompression size cap applies to the fallback path too
        if (Buffer.byteLength(joined, 'utf8') > DOCX_MAX_EXTRACTED_BYTES) {
          throw new Error(
            `DOCX extracted text exceeds the 50 MB decompression cap (possible zip-bomb). File rejected.`
          );
        }
        return {
          text: joined,
          isScanned: false,
          fileType: 'docx',
        };
      }
      throw new Error(`Failed to extract text from DOCX file: ${err.message}`);
    }
  }

  // PDF processing
  try {
    let rawText = '';
    try {
      const data = await pdfParse(buffer);
      rawText = (data.text || '').trim();
    } catch {
      // Fallback: extract text stream markers from PDF buffer
      const str = buffer.toString('utf-8');
      const textMatches: string[] = [];
      const tjRegex = /\(([^)]+)\)\s*Tj/g;
      let match;
      while ((match = tjRegex.exec(str)) !== null) {
        textMatches.push(match[1]);
      }
      rawText = textMatches.join(' ').trim();
    }

    // Check if extracted text is empty or image-only scanned PDF
    const cleanWordCount = rawText.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/).filter(Boolean).length;

    if (cleanWordCount < 5) {
      // Scanned PDF or image-only PDF detected
      return {
        text: '[SCANNED_PDF_IMAGE_ONLY: OCR_REQUIRED]',
        isScanned: true,
        fileType: 'pdf',
      };
    }

    return {
      text: rawText,
      isScanned: false,
      fileType: 'pdf',
    };
  } catch (err: any) {
    throw new Error(`Failed to extract text from PDF file: ${err.message}`);
  }
}
