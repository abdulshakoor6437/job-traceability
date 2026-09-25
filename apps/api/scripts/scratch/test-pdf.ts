import pdfParse from 'pdf-parse';

function buildPdfBuffer(text: string): Buffer {
  const body = `1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length ${text.length + 30} >>
stream
BT /F1 12 Tf 72 712 Td (${text}) Tj ET
endstream
endobj
`;

  const header = '%PDF-1.4\n';
  const fullBody = header + body;
  const startXref = Buffer.byteLength(fullBody);

  const xref = `xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000056 00000 n 
0000000111 00000 n 
0000000257 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
${startXref}
%%EOF`;

  return Buffer.from(fullBody + xref);
}

const buf = buildPdfBuffer('John Doe Software Developer');
pdfParse(buf).then((res) => {
  console.log('PDF PARSE SUCCESS! Extracted text:', JSON.stringify(res.text));
}).catch((err) => {
  console.error('PDF PARSE ERROR:', err.message);
});
