// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/pdf/pdfwriter_impl.cxx reduced
// Upstream's PDFWriterImpl is an OutputDevice that the layout paints into. Here PDFContext offers
// the subset of CanvasRenderingContext2D that Writer's painting uses, so the same paint code
// produces PDF. Text uses the 14 standard fonts (the Liberation fonts are metric-compatible with
// Times, Helvetica and Courier) stretched to the laid-out width; text those fonts cannot encode is
// embedded as an image, so nothing is lost. Font embedding, tagged PDF, links and outlines are not
// ported.
import { m_aBuildinFonts, type BuildinFont } from './pdfbuildin_fonts.ts';

/** Pixel data of an image, or JPEG data embedded as it is. */
export interface PDFImage { width: number; height: number; jpeg?: Uint8Array; rgb?: Uint8Array; alpha?: Uint8Array }

/** Platform services the writer needs: measuring CSS fonts the way the layout did, and rasterising text. */
export interface PDFEnvironment {
  /** Width of text in the CSS font, in the same units as the layout (twips at font size in px). */
  measure(cssFont: string, text: string): number;
  /** Text as an image at the given scale (device pixels per layout unit), with its baseline offset. */
  rasterText?(cssFont: string, text: string, color: string, scale: number): { image: PDFImage; width: number; ascent: number; descent: number } | null;
}

/** Marks an image handed to drawImage; the graphic callback of painting returns these when exporting. */
export interface PDFImageRef { pdfImage: PDFImage }

// WinAnsiEncoding: Latin-1 plus the 0x80-0x9F range of code page 1252.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Text as WinAnsi codes, or null if a character has no code. */
export function toWinAnsi(text: string): number[] | null {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (CP1252[c] !== undefined) out.push(CP1252[c]!);
    else return null;
  }
  return out;
}

interface ParsedFont { size: number; bold: boolean; italic: boolean; families: string[] }

function parseCssFont(css: string): ParsedFont {
  const m = /^(.*?)(\d+(?:\.\d+)?)px\s+(.*)$/.exec(css.trim());
  if (!m) return { size: 240, bold: false, italic: false, families: ['serif'] };
  const pre = m[1]!;
  const families = m[3]!.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
  return { size: parseFloat(m[2]!), bold: /\bbold\b|\b[6-9]00\b/.test(pre), italic: /\b(italic|oblique)\b/.test(pre), families };
}

/** The standard font closest to a font family list (PDFWriterImpl's replacement of non-embedded fonts). */
export function findBuildinFont(css: string): BuildinFont {
  const f = parseCssFont(css);
  const names = f.families.join(' ').toLowerCase();
  const first = f.families[0]!.toLowerCase();
  const family = /mono|courier|consol|menlo|monaco/.test(first) || (/monospace/.test(names) && !/serif|sans/.test(first)) ? 'Courier'
    : /sans|arial|helvetica|verdana|calibri|segoe|roboto|tahoma|carlito|dejavu sans|noto sans|open sans|system-ui/.test(first) ? 'Helvetica'
      : 'Times';
  const style = f.bold && f.italic ? 'Bold Italic' : f.bold ? 'Bold' : f.italic ? 'Italic' : 'Normal';
  return m_aBuildinFonts.find((b) => b.family === family && b.style === style)!;
}

function parseColor(c: string): [number, number, number] | null {
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]!].map((h) => parseInt(h + h, 16) / 255) as [number, number, number];
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  if (m) return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i.exec(c);
  if (m) return m[4] !== undefined && parseFloat(m[4]) === 0 ? null : [parseFloat(m[1]!) / 255, parseFloat(m[2]!) / 255, parseFloat(m[3]!) / 255];
  if (/^(transparent|none)$/i.test(c)) return null;
  return [0, 0, 0];
}

const num = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const rgb = (c: [number, number, number]) => c.map(num).join(' ');

/** The canvas subset Writer's painting uses, recording PDF content operators. */
export class PDFContext {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '10px serif';
  wordSpacing = '0px';
  textBaseline = 'alphabetic';
  textRendering = 'auto';
  fontKerning = 'normal';
  readonly ops: string[] = [];
  private path: string[] = [];
  private dash: number[] = [];
  private writer: PDFWriterImpl;

  constructor(writer: PDFWriterImpl) { this.writer = writer; }

  setTransform(): void { /* the page transform is fixed */ }
  setLineDash(d: number[]): void { this.dash = d; }

  fillRect(x: number, y: number, w: number, h: number): void {
    const c = parseColor(this.fillStyle);
    if (!c) return;
    this.ops.push(`${rgb(c)} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }

  /** Graphics state save and restore (q/Q), for clipping. */
  save(): void { this.ops.push('q'); }
  restore(): void { this.ops.push('Q'); }
  rect(x: number, y: number, w: number, h: number): void { this.path.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re`); }
  clip(): void { if (this.path.length) this.ops.push(`${this.path.join(' ')} W n`); this.path = []; }
  strokeRect(x: number, y: number, w: number, h: number): void { this.beginPath(); this.rect(x, y, w, h); this.stroke(); }

  beginPath(): void { this.path = []; }
  moveTo(x: number, y: number): void { this.path.push(`${num(x)} ${num(y)} m`); }
  lineTo(x: number, y: number): void { this.path.push(`${num(x)} ${num(y)} l`); }
  stroke(): void {
    const c = parseColor(this.strokeStyle);
    if (!c || !this.path.length) return;
    this.ops.push(`${rgb(c)} RG ${num(this.lineWidth)} w [${this.dash.map(num).join(' ')}] 0 d ${this.path.join(' ')} S`);
  }

  measureText(text: string): { width: number } { return { width: this.writer.env.measure(this.font, text) }; }

  fillText(text: string, x: number, y: number): void {
    if (!text) return;
    const c = parseColor(this.fillStyle);
    if (!c) return;
    const ws = parseFloat(this.wordSpacing) || 0;
    const codes = toWinAnsi(text);
    if (!codes) { this.rasterText(text, x, y, ws); return; }
    const font = findBuildinFont(this.font);
    const size = parseCssFont(this.font).size;
    // Stretch the standard font to the width the layout measured (horizontal scaling, Tz).
    const natural = codes.reduce((w, k) => w + font.widths[k]!, 0) * size / 1000;
    const target = this.writer.env.measure(this.font, text);
    const tz = natural > 0 && target > 0 ? (target / natural) * 100 : 100;
    const name = this.writer.useFont(font);
    const hex = codes.map((k) => k.toString(16).padStart(2, '0')).join('');
    // The page's y axis points down, so the text matrix flips glyphs upright again.
    this.ops.push(`BT /${name} ${num(size)} Tf ${num(tz)} Tz ${num((ws * 100) / tz)} Tw ${rgb(c)} rg 1 0 0 -1 ${num(x)} ${num(y)} Tm <${hex}> Tj ET`);
  }

  /** Text the standard fonts cannot show goes in as an image of the text. */
  private rasterText(text: string, x: number, y: number, ws: number): void {
    const words = ws ? text.split(/( )/) : [text];
    let cx = x;
    for (const w of words) {
      if (w === ' ') { cx += this.writer.env.measure(this.font, ' ') + ws; continue; }
      const r = this.writer.env.rasterText?.(this.font, w, this.fillStyle, 300 / 1440 * 4);
      if (r) {
        const name = this.writer.useImage(r.image);
        this.ops.push(`q ${num(r.width)} 0 0 ${num(-(r.ascent + r.descent))} ${num(cx)} ${num(y + r.descent)} cm /${name} Do Q`);
      }
      cx += this.writer.env.measure(this.font, w);
    }
  }

  drawImage(img: unknown, x: number, y: number, w: number, h: number): void {
    const ref = img as Partial<PDFImageRef>;
    if (!ref.pdfImage) return;
    const name = this.writer.useImage(ref.pdfImage);
    this.ops.push(`q ${num(w)} 0 0 ${num(-h)} ${num(x)} ${num(y + h)} cm /${name} Do Q`);
  }
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

interface Page { width: number; height: number; originX: number; originY: number; ctx: PDFContext }

export class PDFWriterImpl {
  readonly env: PDFEnvironment;
  private title: string;
  private pages: Page[] = [];
  private fonts = new Map<BuildinFont, string>();
  private images = new Map<PDFImage, string>();

  constructor(env: PDFEnvironment, title = '') {
    this.env = env;
    this.title = title;
  }

  useFont(f: BuildinFont): string {
    let n = this.fonts.get(f);
    if (!n) { n = `F${this.fonts.size + 1}`; this.fonts.set(f, n); }
    return n;
  }

  useImage(i: PDFImage): string {
    let n = this.images.get(i);
    if (!n) { n = `Im${this.images.size + 1}`; this.images.set(i, n); }
    return n;
  }

  /** A new page in layout units (twips); content is painted in document coordinates offset by the origin. */
  NewPage(width: number, height: number, originX: number, originY: number): PDFContext {
    const ctx = new PDFContext(this);
    this.pages.push({ width, height, originX, originY, ctx });
    return ctx;
  }

  /** PDFWriterImpl::emit: objects, cross-reference table and trailer. */
  async Emit(): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const write = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); length += u.length; };
    let next = 1;
    const alloc = () => next++;
    const writeObj = (id: number, body: string, stream?: Uint8Array) => {
      offsets[id] = length;
      write(`${id} 0 obj\n${body}\n`);
      if (stream) { write('stream\n'); write(stream); write('\nendstream\n'); }
      write('endobj\n');
    };
    // Text strings in UTF-16BE with a byte order mark; surrogate pairs stay as they are.
    const pdfString = (s: string) => `<FEFF${Array.from({ length: s.length }, (_, k) => s.charCodeAt(k).toString(16).padStart(4, '0')).join('')}>`;

    write('%PDF-1.7\n%âãÏÓ\n');
    const catalog = alloc(), pagesId = alloc(), info = alloc();
    const pageIds = this.pages.map(() => ({ page: alloc(), content: alloc() }));
    // Contents first, so that every font and image used is known.
    const contents: Uint8Array[] = [];
    for (const p of this.pages) {
      const k = 1 / 20; // twips to points
      const ops = `${num(k)} 0 0 ${num(-k)} ${num(-p.originX * k)} ${num(p.height * k + p.originY * k)} cm\n${p.ctx.ops.join('\n')}`;
      contents.push(await deflate(enc.encode(ops)));
    }
    const fontIds = new Map<string, number>();
    for (const [f, name] of this.fonts) {
      const id = alloc();
      fontIds.set(name, id);
      const encoding = f.family === 'PDF_Base14_Symbol' || f.family === 'ZapfDingbats' ? '' : ' /Encoding /WinAnsiEncoding';
      writeObj(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${f.psName}${encoding} >>`);
    }
    const imageIds = new Map<string, number>();
    for (const [img, name] of this.images) {
      const id = alloc();
      imageIds.set(name, id);
      if (img.jpeg) {
        writeObj(id, `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>`, img.jpeg);
        continue;
      }
      let smask = '';
      if (img.alpha && img.alpha.some((a) => a !== 255)) {
        const sid = alloc();
        const data = await deflate(img.alpha);
        writeObj(sid, `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`, data);
        smask = ` /SMask ${sid} 0 R`;
      }
      const data = await deflate(img.rgb ?? new Uint8Array(img.width * img.height * 3).fill(255));
      writeObj(id, `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask} /Length ${data.length} >>`, data);
    }
    const fontRes = [...fontIds].map(([n, id]) => `/${n} ${id} 0 R`).join(' ');
    const imageRes = [...imageIds].map(([n, id]) => `/${n} ${id} 0 R`).join(' ');
    this.pages.forEach((p, i) => {
      const ids = pageIds[i]!;
      writeObj(ids.content, `<< /Length ${contents[i]!.length} /Filter /FlateDecode >>`, contents[i]);
      writeObj(ids.page, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.width / 20)} ${num(p.height / 20)}] /Contents ${ids.content} 0 R /Resources << /Font << ${fontRes} >> /XObject << ${imageRes} >> >> >>`);
    });
    writeObj(pagesId, `<< /Type /Pages /Kids [${pageIds.map((p) => `${p.page} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    writeObj(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    writeObj(info, `<< /Producer ${pdfString('LibreOffice Writer for the Web')}${this.title ? ` /Title ${pdfString(this.title)}` : ''} >>`);
    const xref = length;
    const count = next;
    write(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let id = 1; id < count; id++) write(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 ${offsets[id] !== undefined ? 'n' : 'f'} \n`);
    write(`trailer\n<< /Size ${count} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}
