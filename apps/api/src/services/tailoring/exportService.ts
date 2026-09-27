/**
 * exportService.ts
 *
 * Provides explicit, on-demand export to PDF and DOCX.
 * This module is NEVER called automatically during generation or preview.
 * Export is triggered only by an explicit API call from the user.
 *
 * Rule: Export must be a distinct, explicit user action — not a side-effect of
 * tailoring or preview rendering.
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { FullTailoredCv, TailoredCvWorkHistoryRow } from '../../dal/tailoredCvDal';

// ---------------------------------------------------------------------------
// DOCX export
// ---------------------------------------------------------------------------
export async function exportToDocx(tailoredCv: FullTailoredCv): Promise<Buffer> {
  const { tailoredCv: cv, workHistory, education, skills, certifications } = tailoredCv;

  const children: Paragraph[] = [];

  // Header: Name
  children.push(
    new Paragraph({
      text: cv.full_name || 'Unnamed',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );

  // Contact line
  const contactParts = [cv.email, cv.phone, cv.location].filter(Boolean);
  if (contactParts.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: contactParts.join(' | '), size: 20 })],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  // Summary
  if (cv.summary) {
    children.push(new Paragraph({ text: '' }));
    children.push(
      new Paragraph({ text: 'Professional Summary', heading: HeadingLevel.HEADING_1 })
    );
    children.push(new Paragraph({ children: [new TextRun({ text: cv.summary })] }));
  }

  // Work History
  if (workHistory.length > 0) {
    children.push(new Paragraph({ text: '' }));
    children.push(
      new Paragraph({ text: 'Work Experience', heading: HeadingLevel.HEADING_1 })
    );
    for (const w of workHistory) {
      const dateStr = [w.start_date, w.end_date || (w.is_current ? 'Present' : '')].filter(Boolean).join(' – ');
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${w.title} at ${w.company || ''}`, bold: true }),
            new TextRun({ text: dateStr ? `  (${dateStr})` : '', color: '666666' }),
          ],
        })
      );
      if (w.location) {
        children.push(new Paragraph({ children: [new TextRun({ text: w.location, italics: true, size: 18 })] }));
      }
      let bullets: string[] = [];
      try {
        bullets = typeof w.bullet_points === 'string' ? JSON.parse(w.bullet_points) : (w.bullet_points || []);
      } catch {
        bullets = [];
      }
      for (const bp of bullets) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `• ${bp}` })],
            indent: { left: 360 },
          })
        );
      }
    }
  }

  // Education
  if (education.length > 0) {
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: 'Education', heading: HeadingLevel.HEADING_1 }));
    for (const e of education) {
      const dateStr = [e.start_date, e.end_date].filter(Boolean).join(' – ');
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${e.degree || ''}${e.field_of_study ? ', ' + e.field_of_study : ''}`, bold: true }),
            new TextRun({ text: ` — ${e.institution}` }),
            new TextRun({ text: dateStr ? `  (${dateStr})` : '', color: '666666' }),
          ],
        })
      );
    }
  }

  // Skills
  if (skills.length > 0) {
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: 'Skills', heading: HeadingLevel.HEADING_1 }));
    const skillText = skills.map((s) => s.skill_name).join(', ');
    children.push(new Paragraph({ children: [new TextRun({ text: skillText })] }));
  }

  // Certifications
  if (certifications.length > 0) {
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: 'Certifications', heading: HeadingLevel.HEADING_1 }));
    for (const c of certifications) {
      const dateStr = [c.issue_date, c.expiration_date].filter(Boolean).join(' – ');
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: c.name, bold: true }),
            c.issuing_organization
              ? new TextRun({ text: ` — ${c.issuing_organization}` })
              : new TextRun({ text: '' }),
            new TextRun({ text: dateStr ? `  (${dateStr})` : '', color: '666666' }),
          ],
        })
      );
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// PDF export (plain-text layout using pdf-lib; no external fonts required)
// ---------------------------------------------------------------------------
export async function exportToPdf(tailoredCv: FullTailoredCv): Promise<Uint8Array> {
  const { tailoredCv: cv, workHistory, education, skills, certifications } = tailoredCv;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const MARGIN = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const LINE_HEIGHT = 15;
  const SECTION_GAP = 8;
  const FONT_SIZE = 10;
  const HEADING_SIZE = 13;
  const TITLE_SIZE = 16;

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPageIfNeeded(needed: number = LINE_HEIGHT * 2) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function drawText(
    text: string,
    opts: { bold?: boolean; size?: number; indent?: number; color?: [number, number, number] } = {}
  ) {
    const f = opts.bold ? boldFont : font;
    const sz = opts.size || FONT_SIZE;
    const x = MARGIN + (opts.indent || 0);
    const maxWidth = CONTENT_WIDTH - (opts.indent || 0);

    // Crude word wrap
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(test, sz) > maxWidth && line) {
        newPageIfNeeded();
        page.drawText(line, {
          x,
          y,
          size: sz,
          font: f,
          color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0),
        });
        y -= LINE_HEIGHT;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      newPageIfNeeded();
      page.drawText(line, {
        x,
        y,
        size: sz,
        font: f,
        color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0),
      });
      y -= LINE_HEIGHT;
    }
  }

  function drawDivider() {
    newPageIfNeeded(8);
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: PAGE_WIDTH - MARGIN, y: y + 4 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 4;
  }

  // Title
  drawText(cv.full_name || 'Unnamed', { bold: true, size: TITLE_SIZE });
  const contactParts = [cv.email, cv.phone, cv.location].filter(Boolean).join(' | ');
  if (contactParts) drawText(contactParts, { size: FONT_SIZE - 1, color: [0.3, 0.3, 0.3] });
  y -= SECTION_GAP;

  // Summary
  if (cv.summary) {
    drawDivider();
    drawText('Professional Summary', { bold: true, size: HEADING_SIZE });
    y -= 2;
    drawText(cv.summary, { size: FONT_SIZE });
    y -= SECTION_GAP;
  }

  // Work History
  if (workHistory.length > 0) {
    drawDivider();
    drawText('Work Experience', { bold: true, size: HEADING_SIZE });
    y -= 2;
    for (const w of workHistory) {
      const dateStr = [w.start_date, w.end_date || (w.is_current ? 'Present' : '')].filter(Boolean).join(' – ');
      drawText(`${w.title} — ${w.company || ''}${dateStr ? '  (' + dateStr + ')' : ''}`, { bold: true });
      if (w.location) drawText(w.location, { size: FONT_SIZE - 1, color: [0.4, 0.4, 0.4] });
      let bullets: string[] = [];
      try {
        bullets = typeof w.bullet_points === 'string' ? JSON.parse(w.bullet_points) : (w.bullet_points || []);
      } catch {
        bullets = [];
      }
      for (const bp of bullets) {
        drawText(`• ${bp}`, { indent: 12 });
      }
      y -= 4;
    }
    y -= SECTION_GAP;
  }

  // Education
  if (education.length > 0) {
    drawDivider();
    drawText('Education', { bold: true, size: HEADING_SIZE });
    y -= 2;
    for (const e of education) {
      const dateStr = [e.start_date, e.end_date].filter(Boolean).join(' – ');
      drawText(
        `${e.degree || ''}${e.field_of_study ? ', ' + e.field_of_study : ''} — ${e.institution}${dateStr ? '  (' + dateStr + ')' : ''}`,
        { bold: true }
      );
    }
    y -= SECTION_GAP;
  }

  // Skills
  if (skills.length > 0) {
    drawDivider();
    drawText('Skills', { bold: true, size: HEADING_SIZE });
    y -= 2;
    drawText(skills.map((s) => s.skill_name).join(', '));
    y -= SECTION_GAP;
  }

  // Certifications
  if (certifications.length > 0) {
    drawDivider();
    drawText('Certifications', { bold: true, size: HEADING_SIZE });
    y -= 2;
    for (const c of certifications) {
      const dateStr = [c.issue_date, c.expiration_date].filter(Boolean).join(' – ');
      drawText(
        `${c.name}${c.issuing_organization ? ' — ' + c.issuing_organization : ''}${dateStr ? '  (' + dateStr + ')' : ''}`,
        { bold: true }
      );
    }
  }

  return pdfDoc.save();
}
