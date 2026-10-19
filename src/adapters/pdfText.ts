// Lokal tekstuttrekk fra PDF med pdf.js. Ingenting sendes ut av enheten her.
// Henter side 1–2 og sidene med «Merknader i sjekklisten». Tekstbiter grupperes til linjer etter y-posisjon,
// og store mellomrom mellom biter blir « | » slik at tabellceller holdes fra hverandre.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Item { str: string; x: number; y: number; w: number }

function pageLines(items: Item[]): string {
  const rows: { y: number; items: Item[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) < 3);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let out = '';
      let lastEnd = -1;
      for (const it of r.items) {
        if (lastEnd >= 0) out += it.x - lastEnd > 18 ? ' | ' : ' ';
        out += it.str.trim();
        lastEnd = it.x + it.w;
      }
      return out;
    })
    .join('\n');
}

export async function pdfToText(file: File | ArrayBuffer): Promise<string> {
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: Item[] = (tc.items as any[]).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    const text = pageLines(items);
    if (p <= 2 || /Merknader i sjekklisten/i.test(text)) parts.push(text + `\nSide ${p} av ${doc.numPages}`);
  }
  await doc.destroy();
  return parts.join('\n');
}
