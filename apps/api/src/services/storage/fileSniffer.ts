export type DetectedFileType = 'pdf' | 'docx' | 'unknown';

export function sniffFileType(buffer: Buffer): DetectedFileType {
  if (!buffer || buffer.length < 4) {
    return 'unknown';
  }

  // 1. PDF Magic Bytes Check: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'pdf';
  }

  // 2. DOCX / ZIP Magic Bytes Check: PK\x03\x04 (0x50 0x4B 0x03 0x04)
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    // Inspect buffer contents for docx zip structure indicators (word/ or [Content_Types].xml)
    const strHeader = buffer.toString('binary', 0, Math.min(buffer.length, 2000));
    if (strHeader.includes('word/') || strHeader.includes('[Content_Types].xml') || strHeader.includes('docProps/')) {
      return 'docx';
    }
  }

  return 'unknown';
}
