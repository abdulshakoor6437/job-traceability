import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { sniffFileType } from '../storage/fileSniffer';

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
      return {
        text: text || '[EMPTY_DOCX_FILE]',
        isScanned: false,
        fileType: 'docx',
      };
    } catch (err: any) {
      // Fallback: extract <w:t> XML tags from buffer
      const str = buffer.toString('utf-8');
      const wtRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
      const textMatches: string[] = [];
      let match;
      while ((match = wtRegex.exec(str)) !== null) {
        textMatches.push(match[1]);
      }
      if (textMatches.length > 0) {
        return {
          text: textMatches.join(' ').trim(),
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
