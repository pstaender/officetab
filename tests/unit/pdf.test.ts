import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportPDF } from '../../src/lo/sw/source/core/view/vprint.ts';
import { findBuildinFont, toWinAnsi } from '../../src/lo/vcl/source/pdf/pdfwriter_impl.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const env = { measure: (_css: string, t: string) => t.length * 100 };
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

async function inflate(b: Uint8Array): Promise<string> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new TextDecoder().decode(await new Response(s).arrayBuffer());
}

/** Checks the cross-reference table and returns each object's body and decoded stream. */
async function parse(pdf: Uint8Array): Promise<Map<number, { body: string; stream?: string }>> {
  const s = latin1(pdf);
  expect(s.startsWith('%PDF-1.7')).toBe(true);
  const startxref = parseInt(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]!, 10);
  expect(s.slice(startxref, startxref + 4)).toBe('xref');
  const [, count] = /xref\n0 (\d+)\n/.exec(s.slice(startxref))!.map(Number) as [number, number];
  const entries = s.slice(startxref).split('\n').slice(3, 2 + count);
  const objs = new Map<number, { body: string; stream?: string }>();
  for (const [i, e] of entries.entries()) {
    expect(e.length).toBe(19); // 20 bytes with the newline
    const off = parseInt(e.slice(0, 10), 10);
    const id = i + 1;
    expect(s.slice(off).startsWith(`${id} 0 obj\n`)).toBe(true);
    const end = s.indexOf('endobj', off);
    const body = s.slice(off, end);
    const len = /\/Length (\d+)/.exec(body);
    let stream: string | undefined;
    if (len && body.includes('stream\n')) {
      const st = off + body.indexOf('stream\n') + 7;
      expect(s.slice(st + parseInt(len[1]!, 10), st + parseInt(len[1]!, 10) + 10)).toBe('\nendstream');
      if (body.includes('/FlateDecode') && !body.includes('/Image')) stream = await inflate(pdf.subarray(st, st + parseInt(len[1]!, 10)));
    }
    objs.set(id, { body, stream });
  }
  return objs;
}

describe('PDF export', () => {
  it('maps fonts and encodes WinAnsi', () => {
    expect(findBuildinFont('bold 240px "Liberation Sans", Arial, sans-serif').psName).toBe('Helvetica-Bold');
    expect(findBuildinFont('italic 240px "Liberation Serif", "Times New Roman", serif').psName).toBe('Times-Italic');
    expect(findBuildinFont('240px "Liberation Mono", "Courier New", monospace').psName).toBe('Courier');
    expect(toWinAnsi('€ “ok” – ü')).toEqual([0x80, 0x20, 0x93, 0x6f, 0x6b, 0x94, 0x20, 0x96, 0x20, 0xfc]);
    expect(toWinAnsi('日本')).toBeNull();
  });

  it('writes a valid file with one page per layout page, text and table borders', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('Hello PDF');
    sh.SplitNode();
    sh.InsertTable(1, 2);
    sh.Insert('cell');
    const objs = await parse(await ExportPDF(sh, env, new Map(), 'Report'));
    const pages = [...objs.values()].filter((o) => o.body.includes('/Type /Page '));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.body).toContain('/MediaBox [0 0 595.3 841.9]');
    const content = [...objs.values()].find((o) => o.stream?.includes('Tf'))!.stream!;
    expect(content).toContain(`<${[...'Hello PDF'].map((c) => c.charCodeAt(0).toString(16)).join('')}> Tj`);
    expect(content).toMatch(/ re f|RG [\d.]+ w/);
    expect([...objs.values()].some((o) => o.body.includes('/BaseFont /Times-Roman /Encoding /WinAnsiEncoding'))).toBe(true);
    // "Report" in UTF-16BE with a byte order mark.
    expect([...objs.values()].some((o) => o.body.includes('/Title <FEFF005200650070006f00720074>'))).toBe(true);
  });
});
