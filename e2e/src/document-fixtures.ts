import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makePng } from './image-fixtures';

/** IDEA-146: a small text PDF (Helvetica, so the text layer is selectable and searchable). */
export function makePdf(pages: readonly string[][]): Buffer {
    const objects: string[] = [];
    const pageIds = pages.map((_, i) => 4 + i * 2);
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    pages.forEach((lines, i) => {
        const escape = (text: string) => text.replace(/([\\()])/g, '\\$1');
        const stream = `BT /F1 20 Tf 72 720 Td 28 TL ${lines.map(line => `(${escape(line)}) Tj T*`).join(' ')} ET`;
        objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
        objects[pageIds[i] + 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    });
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let id = 1; id < objects.length; id++) {
        offsets[id] = Buffer.byteLength(out);
        out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

export const PDF_PAGES = [
    ['Ingot quarterly report', 'Page one: kiwi exports grew.', 'Selectable text lives here.'],
    ['Page two: market overview', 'Apples were flat this quarter.', 'The kiwi harvest was early.'],
    ['Page three: outlook', 'Expect more kiwi next year.', 'End of report.']
] as const;

const sections = Array.from({ length: 12 }, (_, i) => [
    `## Section ${i + 1}`,
    '',
    ...Array.from({ length: 6 }, (__, n) => `Paragraph ${n + 1} of section ${i + 1}. The preview should keep this line next to its source while scrolling.`).flatMap(line => [line, '']),
].join('\n')).join('\n');

export const README_SOURCE = `# Ingot Preview Demo

Rendered **Markdown** with \`inline code\`, [a web link](https://example.com) and an image:

![Logo](assets/logo.png)

| Feature | Status |
| --- | --- |
| Tables | Done |
| Mermaid | Done |

\`\`\`ts
export const answer: number = 42;
\`\`\`

\`\`\`mermaid
flowchart LR
  Write --> Preview --> Ship
\`\`\`

- [x] Code only
- [ ] Preview only

> A quote for good measure.

${sections}
`;

/** A throwaway project with a long README (image, table, code, mermaid) and a three-page PDF. */
export function makeDocumentProject(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-docs-')));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), makePng(64, 32));
    fs.writeFileSync(path.join(dir, 'README.md'), README_SOURCE);
    fs.writeFileSync(path.join(dir, 'docs', 'report.pdf'), makePdf(PDF_PAGES.map(page => [...page])));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'docs-project', private: true }, undefined, 2));
    return dir;
}
