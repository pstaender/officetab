// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/graphic/Manager.cxx reduced
// Upstream swaps graphics in and out of memory; here decoded bitmaps are cached per document data
// and decoding is asynchronous, so painting asks again once a graphic is ready. A graphic with
// colour attributes is shown as its modified bitmap (Bitmap::Modify with the attributes' modifier
// stack), cached per graphic and attributes as upstream buffers it (BufferedData_ModifiedBitmap).
import type { SwDoc } from '../../../sw/inc/doc.ts';
import { GraphicModifierKey, GraphicModifierStack, type GraphicAttr } from '../../../drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import { Modify } from '../bitmap/bitmap.ts';
import { ImportTiffGraphicImport } from '../filter/itiff/itiff.ts';
import { ReadWindowMetafile } from '../filter/wmf/wmf.ts';
import { WriteMetaFileSVG } from '../../../filter/source/svg/svgwriter.ts';

export class GraphicManager {
  private m_aDecoded = new Map<string, ImageBitmap | 'pending' | 'failed'>();
  private m_aPending = new Map<string, Promise<ImageBitmap | null>>();
  /** Called after a graphic finished decoding, to repaint. */
  onLoaded: () => void = () => {};

  private decode(doc: SwDoc, key: string): Promise<ImageBitmap | null> {
    let p = this.m_aPending.get(key);
    if (p) return p;
    const g = doc.m_aGraphics.get(key);
    if (!g) return Promise.resolve(null);
    this.m_aDecoded.set(key, 'pending');
    p = ImportBitmap(g.data, g.mime)
      .then((b) => { this.m_aDecoded.set(key, b); this.onLoaded(); return b; })
      .catch(() => { this.m_aDecoded.set(key, 'failed'); return null; });
    this.m_aPending.set(key, p);
    return p;
  }

  /** The decoded graphic, or null while it decodes (decoding starts on the first request). */
  Get(doc: SwDoc, key: string, attr?: GraphicAttr): ImageBitmap | null {
    const mod = GraphicModifierKey(attr);
    if (mod) {
      const m = this.m_aDecoded.get(`${key}|${mod}`);
      if (m === undefined) { void this.modified(doc, key, attr!); return null; }
      return typeof m === 'string' ? null : m;
    }
    const d = this.m_aDecoded.get(key);
    if (d === undefined) { void this.decode(doc, key); return null; }
    return typeof d === 'string' ? null : d;
  }

  /** The modified pixels of a graphic, for its colour attributes. */
  private async modifiedPixels(doc: SwDoc, key: string, attr: GraphicAttr): Promise<ImageData | null> {
    const b = await this.decode(doc, key);
    if (!b) return null;
    const cv = new OffscreenCanvas(b.width, b.height);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(b, 0, 0);
    const src = ctx.getImageData(0, 0, b.width, b.height);
    const out = Modify({ width: src.width, height: src.height, data: src.data }, GraphicModifierStack(attr));
    return new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height);
  }

  private modified(doc: SwDoc, key: string, attr: GraphicAttr): Promise<ImageBitmap | null> {
    const id = `${key}|${GraphicModifierKey(attr)}`;
    let p = this.m_aPending.get(id);
    if (p) return p;
    this.m_aDecoded.set(id, 'pending');
    p = this.modifiedPixels(doc, key, attr)
      .then((img) => (img ? createImageBitmap(img) : null))
      .then((b) => { this.m_aDecoded.set(id, b ?? 'failed'); if (b) this.onLoaded(); return b; })
      .catch(() => { this.m_aDecoded.set(id, 'failed'); return null; });
    this.m_aPending.set(id, p);
    return p;
  }

  /** The graphic as it is shown, as image data for printing: the stored data, or a PNG of the modified bitmap. */
  async GetPrintBlob(doc: SwDoc, key: string, attr?: GraphicAttr): Promise<Blob | null> {
    const g = doc.m_aGraphics.get(key);
    if (!g) return null;
    if (!GraphicModifierKey(attr)) return BrowserBlob(g.data, g.mime);
    const img = await this.modifiedPixels(doc, key, attr!);
    if (!img) return null;
    const cv = new OffscreenCanvas(img.width, img.height);
    cv.getContext('2d')!.putImageData(img, 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  }

  /** Waits for every graphic of the document, for printing. */
  async LoadAll(doc: SwDoc): Promise<void> {
    await Promise.all([...doc.m_aGraphics.keys()].map((k) => this.decode(doc, k)));
  }
}

/** Formats the graphic filter decodes itself, which browsers do not show (GraphicFilter::ImportGraphic). */
const OWN_FORMATS = new Set(['image/tiff', 'image/x-wmf', 'image/x-emf']);

/** Whether the mime type is a Windows metafile (WMF or EMF), read by emfio. */
export function IsMetafileMime(mime: string): boolean { return mime === 'image/x-wmf' || mime === 'image/x-emf'; }

/**
 * Decodes an SVG document to a bitmap of the given size (or its own), for browsers whose
 * createImageBitmap does not read SVG. The shell sets it, as it needs an image element.
 */
type SvgDecoder = (svg: Blob, width?: number, height?: number) => Promise<ImageBitmap>;
let pSvgDecoder: SvgDecoder | null = null;
export function SetSvgDecoder(f: SvgDecoder | null): void { pSvgDecoder = f; }

async function DecodeSvg(svg: Blob, width?: number, height?: number): Promise<ImageBitmap> {
  if (pSvgDecoder) return pSvgDecoder(svg, width, height);
  return createImageBitmap(svg, width && height ? { resizeWidth: width, resizeHeight: height } : undefined);
}

/** A metafile as an SVG document of `width` × `height` pixels (its preferred size at 96 DPI by default). */
export function MetafileSVG(data: Uint8Array, width?: number, height?: number): { svg: string; prefSize: { width: number; height: number } } | null {
  const mtf = ReadWindowMetafile(data);
  if (!mtf) return null;
  return { svg: WriteMetaFileSVG(mtf, width, height), prefSize: mtf.GetPrefSize() };
}

/** The pixel size a metafile is drawn at for the screen: its preferred size at 192 DPI, at most 3072 pixels wide or high. */
function MetafilePixelSize(prefSize: { width: number; height: number }): { width: number; height: number } {
  let w = (Math.max(1, prefSize.width) / 2540) * 192, h = (Math.max(1, prefSize.height) / 2540) * 192;
  const f = Math.min(1, 3072 / Math.max(w, h));
  w *= f; h *= f;
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/**
 * GraphicFilter::ImportGraphic: decodes graphic data, TIFF through ImportTiffGraphicImport, WMF and
 * EMF through emfio (drawn as SVG), the rest by the browser.
 */
export async function ImportBitmap(data: Uint8Array, mime: string): Promise<ImageBitmap> {
  if (mime === 'image/tiff') {
    const img = await ImportTiffGraphicImport(data);
    if (!img) throw new Error('TIFF could not be read');
    return createImageBitmap(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height));
  }
  if (IsMetafileMime(mime)) {
    const mtf = ReadWindowMetafile(data);
    if (!mtf) throw new Error('Metafile could not be read');
    const px = MetafilePixelSize(mtf.GetPrefSize());
    return DecodeSvg(new Blob([WriteMetaFileSVG(mtf, px.width, px.height)], { type: 'image/svg+xml' }), px.width, px.height);
  }
  const blob = new Blob([data as BlobPart], { type: mime });
  if (mime === 'image/svg+xml' && pSvgDecoder) {
    const decode = pSvgDecoder;
    return createImageBitmap(blob).catch(() => decode(blob));
  }
  return createImageBitmap(blob);
}

/**
 * The graphic as data a browser shows (an <img>, an SVG <image>): its own data, SVG for metafiles
 * (so they stay vector graphics in print), or PNG for other formats it cannot show.
 */
export async function BrowserBlob(data: Uint8Array, mime: string): Promise<Blob> {
  if (!OWN_FORMATS.has(mime)) return new Blob([data as BlobPart], { type: mime });
  if (IsMetafileMime(mime)) {
    const m = MetafileSVG(data);
    if (m) return new Blob([m.svg], { type: 'image/svg+xml' });
  }
  const b = await ImportBitmap(data, mime);
  const cv = new OffscreenCanvas(b.width, b.height);
  cv.getContext('2d')!.drawImage(b, 0, 0);
  b.close();
  return cv.convertToBlob({ type: 'image/png' });
}

/** Natural size of graphic data in twips at 96 dpi, as Writer sizes pixel graphics without a resolution. */
export async function GetPrefSize(data: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  // A metafile's preferred size is in 1/100 mm.
  if (IsMetafileMime(mime)) {
    const mtf = ReadWindowMetafile(data);
    if (!mtf) throw new Error('Metafile could not be read');
    const p = mtf.GetPrefSize();
    return { width: Math.round((p.width * 1440) / 2540), height: Math.round((p.height * 1440) / 2540) };
  }
  const b = await ImportBitmap(data, mime);
  const size = { width: b.width * 15, height: b.height * 15 };
  b.close();
  return size;
}
