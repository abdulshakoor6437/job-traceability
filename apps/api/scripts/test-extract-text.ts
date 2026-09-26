import fs from 'fs';
import path from 'path';
import { extractCvText } from '../src/services/cv/textExtractor';

async function testExtraction() {
  const pdfPath = path.resolve(__dirname, '../test-fixtures/sample-cv.pdf');
  const docxPath = path.resolve(__dirname, '../test-fixtures/sample-cv.docx');

  const pdfBuf = fs.readFileSync(pdfPath);
  const docxBuf = fs.readFileSync(docxPath);

  const pdfExt = await extractCvText(pdfBuf);
  console.log('--- PDF EXTRACTED TEXT ---');
  console.log('Length:', pdfExt.text.length);
  console.log('Text snippet:\n', pdfExt.text);

  const docxExt = await extractCvText(docxBuf);
  console.log('\n--- DOCX EXTRACTED TEXT ---');
  console.log('Length:', docxExt.text.length);
  console.log('Text snippet:\n', docxExt.text);
}

testExtraction().catch(console.error);
