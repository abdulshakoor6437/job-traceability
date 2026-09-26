import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

const fixturesDir = path.resolve(__dirname, '../test-fixtures');

if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

export const FIXTURE_DATA = {
  fullName: 'Jane Doe',
  email: 'jane.doe@example.com',
  phone: '+1 555-234-5678',
  location: 'San Francisco, CA',
  linkedinUrl: 'https://linkedin.com/in/janedoe',
  website: 'https://janedoe.dev',
  summary: 'Full-Stack Software Engineer with over 6 years of experience building scalable web applications and cloud architectures.',
  workHistory: [
    {
      title: 'Senior Software Engineer',
      company: 'Acme Corporation',
      location: 'San Francisco, CA',
      startDate: '2022-03',
      endDate: 'Present',
      isCurrent: true,
      bulletPoints: [
        'Architected microservices platform handling 10M daily active users using TypeScript and Node.js.',
        'Reduced database query latency by 45% through Redis caching and PostgreSQL query optimization.',
        'Mentored 5 junior developers and established CI/CD best practices.',
      ],
    },
    {
      title: 'Software Engineer',
      company: 'CloudTech Solutions',
      location: 'San Jose, CA',
      startDate: '2019-06',
      endDate: '2022-02',
      isCurrent: false,
      bulletPoints: [
        'Developed real-time collaborative dashboard features using React, WebSockets, and Express.',
        'Integrated third-party payment processing gateway handling $2M monthly transactions.',
      ],
    },
  ],
  education: [
    {
      institution: 'University of California, Berkeley',
      degree: 'Bachelor of Science',
      fieldOfStudy: 'Computer Science',
      startDate: '2015-08',
      endDate: '2019-05',
    },
  ],
  skills: [
    'TypeScript',
    'JavaScript',
    'Node.js',
    'React',
    'Express',
    'PostgreSQL',
    'Redis',
    'Docker',
    'AWS',
    'GraphQL',
  ],
};

async function generatePdf() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  let y = height - 50;

  // Header: Name
  page.drawText(FIXTURE_DATA.fullName, { x: 50, y, size: 22, font: boldFont, color: rgb(0.1, 0.1, 0.3) });
  y -= 25;

  // Contact Info
  const contactStr = `${FIXTURE_DATA.email}  |  ${FIXTURE_DATA.phone}  |  ${FIXTURE_DATA.location}`;
  page.drawText(contactStr, { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 15;
  const linkStr = `${FIXTURE_DATA.linkedinUrl}  |  ${FIXTURE_DATA.website}`;
  page.drawText(linkStr, { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 30;

  // Summary Section
  page.drawText('SUMMARY', { x: 50, y, size: 12, font: boldFont, color: rgb(0.2, 0.2, 0.4) });
  y -= 15;
  page.drawText(FIXTURE_DATA.summary, { x: 50, y, size: 10, font });
  y -= 30;

  // Work History Section
  page.drawText('WORK EXPERIENCE', { x: 50, y, size: 12, font: boldFont, color: rgb(0.2, 0.2, 0.4) });
  y -= 20;

  for (const job of FIXTURE_DATA.workHistory) {
    const jobTitleLine = `${job.title} — ${job.company} (${job.location})`;
    const dateLine = `${job.startDate} to ${job.endDate}`;
    page.drawText(jobTitleLine, { x: 50, y, size: 11, font: boldFont });
    page.drawText(dateLine, { x: 420, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 15;

    for (const bullet of job.bulletPoints) {
      page.drawText(`•  ${bullet}`, { x: 65, y, size: 9.5, font });
      y -= 14;
    }
    y -= 10;
  }

  y -= 10;

  // Education Section
  page.drawText('EDUCATION', { x: 50, y, size: 12, font: boldFont, color: rgb(0.2, 0.2, 0.4) });
  y -= 20;
  for (const edu of FIXTURE_DATA.education) {
    const eduLine = `${edu.degree} in ${edu.fieldOfStudy} — ${edu.institution}`;
    const dateLine = `${edu.startDate} to ${edu.endDate}`;
    page.drawText(eduLine, { x: 50, y, size: 10, font: boldFont });
    page.drawText(dateLine, { x: 420, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 20;
  }

  y -= 10;

  // Skills Section
  page.drawText('SKILLS', { x: 50, y, size: 12, font: boldFont, color: rgb(0.2, 0.2, 0.4) });
  y -= 15;
  page.drawText(FIXTURE_DATA.skills.join(', '), { x: 50, y, size: 10, font });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  const pdfPath = path.join(fixturesDir, 'sample-cv.pdf');
  fs.writeFileSync(pdfPath, pdfBytes);
  console.log(`✅ Generated PDF fixture: ${pdfPath} (${pdfBytes.length} bytes)`);
}

async function generateDocx() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: FIXTURE_DATA.fullName,
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun(`${FIXTURE_DATA.email} | ${FIXTURE_DATA.phone} | ${FIXTURE_DATA.location}`),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(`${FIXTURE_DATA.linkedinUrl} | ${FIXTURE_DATA.website}`),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: 'PROFESSIONAL SUMMARY',
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: FIXTURE_DATA.summary,
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: 'WORK EXPERIENCE',
            heading: HeadingLevel.HEADING_2,
          }),
          ...FIXTURE_DATA.workHistory.flatMap((job) => [
            new Paragraph({
              children: [
                new TextRun({ text: `${job.title} — ${job.company} (${job.location})`, bold: true }),
                new TextRun({ text: `   [${job.startDate} to ${job.endDate}]`, italics: true }),
              ],
            }),
            ...job.bulletPoints.map(
              (bullet) =>
                new Paragraph({
                  text: `• ${bullet}`,
                })
            ),
            new Paragraph({ text: '' }),
          ]),
          new Paragraph({
            text: 'EDUCATION',
            heading: HeadingLevel.HEADING_2,
          }),
          ...FIXTURE_DATA.education.map(
            (edu) =>
              new Paragraph({
                children: [
                  new TextRun({ text: `${edu.degree} in ${edu.fieldOfStudy} — ${edu.institution}`, bold: true }),
                  new TextRun({ text: ` (${edu.startDate} to ${edu.endDate})`, italics: true }),
                ],
              })
          ),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: 'SKILLS',
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: FIXTURE_DATA.skills.join(', '),
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const docxPath = path.join(fixturesDir, 'sample-cv.docx');
  fs.writeFileSync(docxPath, buffer);
  console.log(`✅ Generated DOCX fixture: ${docxPath} (${buffer.length} bytes)`);
}

async function main() {
  console.log('Generating realistic CV test fixtures...');
  await generatePdf();
  await generateDocx();
  console.log('Done.');
}

main().catch(console.error);
