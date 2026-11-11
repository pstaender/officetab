// SPDX-License-Identifier: MPL-2.0
// @upstream emfio/source/reader/mtftools.cxx reduced
// @upstream emfio/inc/mtftools.hxx reduced
// MtfTools: the device context of the WMF and EMF readers. It keeps the GDI state (pens, brushes,
// fonts, the object table, mapping mode, window and viewport, world transform, clipping, the
// current position, saved states) and records drawing as GDIMetaFile actions in 1/100 mm.
//
// Reduced: the latest-state caches only avoid repeating colour actions; clipping is kept as a list
// of regions to intersect (a union or XOR with an existing clip region is approximated by joining
// the polygons) instead of being solved with basegfx, and a complex clip is not applied to the
// geometry here but written as a clip region; font metrics are not measured, so a cell height
// (positive lfHeight) becomes a font height with Arial's ascent and descent, and text without a
// DX array is not given widths; raster operations other than copy are recorded but bitmaps are
// not combined pixel by pixel (ResolveBitmapActions draws masked pairs as their image), and
// pattern brushes fill with black; the tdf#127471 font scale correction is not ported.

import { Point, Rectangle, Size } from '../../../tools/source/generic/gen.ts';
import { Polygon, PolyPolygon, PolyFlags } from '../../../tools/source/generic/poly.ts';
import type { SvStream } from '../../../tools/source/stream/stream.ts';
import { GDIMetaFile, LineInfoDefault, RasterOp, type ClipPart, type LineInfo, type MtfBitmap, type VclFont } from '../../../vcl/source/gdi/gdimtf.ts';

/* [MS-EMF] - v20210625 - pages 43, 107 */
export const RegionMode = { RGN_AND: 0x01, RGN_OR: 0x02, RGN_XOR: 0x03, RGN_DIFF: 0x04, RGN_COPY: 0x05 } as const;
/* [MS-EMF] - v20210625 - pages 40, 198 */
export const BackgroundMode = { NONE: 0, Transparent: 1, OPAQUE: 2 } as const;
/* [MS-EMF] - v20210625 - pages 40, 210 */
export const ModifyWorldTransformMode = { MWT_IDENTITY: 0x01, MWT_LEFTMULTIPLY: 0x02, MWT_RIGHTMULTIPLY: 0x03, MWT_SET: 0x04 } as const;
export const ENHMETA_STOCK_OBJECT = 0x80000000;
/* [MS-EMF] - v20210625 - pages 44, 45, 182 */
export const StockObject = { WHITE_BRUSH: 0, LTGRAY_BRUSH: 1, GRAY_BRUSH: 2, DKGRAY_BRUSH: 3, BLACK_BRUSH: 4, NULL_BRUSH: 5, WHITE_PEN: 6, BLACK_PEN: 7, NULL_PEN: 8, ANSI_FIXED_FONT: 11, ANSI_VAR_FONT: 12, SYSTEM_FIXED_FONT: 16 } as const;
/* [MS-WMF] - v20210625 - pages 25-26 */
export const WMFRasterOp = { NONE: 0, Black: 1, Not: 6, XorPen: 7, Nop: 11, CopyPen: 13 } as const;
/* [MS-EMF] - v20210625 - pages 38-50, 202 */
export const MappingMode = { MM_TEXT: 0x01, MM_LOMETRIC: 0x02, MM_HIMETRIC: 0x03, MM_LOENGLISH: 0x04, MM_HIENGLISH: 0x05, MM_TWIPS: 0x06, MM_ISOTROPIC: 0x07, MM_ANISOTROPIC: 0x08 } as const;
/* [MS-EMF] - v20210625 - pages 35 */
export const GraphicsMode = { GM_COMPATIBLE: 0x00000001, GM_ADVANCED: 0x00000002 } as const;
/* [MS-WMF] - v20210625 - pages 153 */
export const TextAlignmentMode = { TA_NOUPDATECP: 0x0000, TA_UPDATECP: 0x0001, TA_LEFT: 0x0000, TA_RIGHT: 0x0002, TA_CENTER: 0x0006, TA_RIGHT_CENTER: 0x0006, TA_TOP: 0x0000, TA_BOTTOM: 0x0008, TA_BASELINE: 0x0010, TA_RTLREADING: 0x0100 } as const;
/* [MS-WMF] - v20210625 - pages 30, 82 */
export const CharacterSet = { ANSI_CHARSET: 0, DEFAULT_CHARSET: 1, SYMBOL_CHARSET: 2, OEM_CHARSET: 0xff } as const;
/* [MS-EMF] - v20210625 - pages 32, 283 */
export const ExtTextOutOptions = { ETO_OPAQUE: 0x0002, ETO_CLIPPED: 0x0004, ETO_GLYPH_INDEX: 0x0010, ETO_RTLREADING: 0x0080, ETO_NO_RECT: 0x0100, ETO_SMALL_CHARS: 0x0200, ETO_PDY: 0x2000 } as const;
/* [MS-WMF] - v20210625 - pages 37 */
export const PenStyle = {
  PS_COSMETIC: 0x00000000, PS_SOLID: 0x00000000, PS_DASH: 0x00000001, PS_DOT: 0x00000002, PS_DASHDOT: 0x00000003, PS_DASHDOTDOT: 0x00000004,
  PS_NULL: 0x00000005, PS_INSIDEFRAME: 0x00000006, PS_STYLE_MASK: 0x0000000f, PS_ENDCAP_ROUND: 0x00000000, PS_ENDCAP_SQUARE: 0x00000100,
  PS_ENDCAP_FLAT: 0x00000200, PS_ENDCAP_STYLE_MASK: 0x00000f00, PS_JOIN_ROUND: 0x00000000, PS_JOIN_BEVEL: 0x00001000, PS_JOIN_MITER: 0x00002000,
  PS_JOIN_STYLE_MASK: 0x0000f000,
} as const;
/* [MS-WMF] - v20210625 - pages 22 */
export const BrushStyle = { BS_SOLID: 0, BS_NULL: 1, BS_HOLLOW: 1, BS_HATCHED: 2, BS_PATTERN: 3, BS_DIBPATTERNPT: 6 } as const;
/* Raster operations of bitmaps (ternary raster operation codes) */
export const SRCCOPY = 0x00cc0020, SRCPAINT = 0x00ee0086, SRCAND = 0x008800c6, SRCINVERT = 0x00660046, PATINVERT = 0x005a0049;

const COL_BLACK = '#000000', COL_WHITE = '#ffffff', COL_TRANSPARENT = 'transparent';

/** GDIObj: an entry of the object table (an empty one for objects that are not ported). */
export class GDIObj {}

export class WinMtfFontStyle extends GDIObj {
  aFont: VclFont;
  /** WinMtfFontStyle( LOGFONTW const & rFont ) */
  constructor(rFont: LOGFONTW) {
    super();
    const bSymbol = rFont.alfFaceName === 'Symbol' || rFont.alfFaceName === 'MT Extra' || rFont.lfCharSet === CharacterSet.SYMBOL_CHARSET;
    const FAMILY: Record<number, VclFont['meFamily']> = { 1: 'roman', 2: 'swiss', 3: 'modern', 4: 'script', 5: 'decorative' };
    const eFamily = FAMILY[(rFont.lfPitchAndFamily >> 4) & 0x0f] ?? 'dontknow';
    // FontWeight: lfWeight 0 means the default weight should be used.
    const w = rFont.lfWeight;
    const eWeight = w === 0 ? 0 : w <= 100 ? 100 : w <= 200 ? 200 : w <= 300 ? 300 : w < 500 ? 400 : w === 500 ? 500 : w <= 600 ? 600 : w <= 700 ? 700 : w <= 800 ? 800 : 900;
    const aFontSize = new Size(rFont.lfWidth, rFont.lfHeight);
    if (rFont.lfHeight > 0) {
      // converting the cell height into a font height (Arial's ascent and descent, as metrics are not measured)
      const nHeight = 0.905 + 0.212;
      aFontSize.setHeight(Math.trunc(rFont.lfHeight / nHeight + 0.5));
    }
    // Convert height to positive
    aFontSize.setHeight(Math.abs(aFontSize.Height()));
    this.aFont = {
      maFamilyName: rFont.alfFaceName, maFontSize: aFontSize, meWeight: eWeight, mbItalic: !!rFont.lfItalic, mbUnderline: !!rFont.lfUnderline,
      mbStrikeout: !!rFont.lfStrikeOut, mnOrientation: ((rFont.lfEscapement << 16) >> 16), meAlign: 'TOP', maColor: COL_BLACK, maFillColor: COL_TRANSPARENT,
      mbTransparent: true, meFamily: eFamily, mbSymbol: bSymbol,
    };
    this.lfCharSet = rFont.lfCharSet;
  }
  lfCharSet: number;
}

export class WinMtfFillStyle extends GDIObj {
  aFillColor: string;
  bTransparent: boolean;
  aType: 'Solid' | 'Pattern';
  aBmp: MtfBitmap | null = null;
  constructor(rColor: string = COL_BLACK, bTrans = false, aBmp: MtfBitmap | null = null) {
    super();
    this.aFillColor = rColor;
    this.bTransparent = bTrans;
    this.aType = aBmp ? 'Pattern' : 'Solid';
    this.aBmp = aBmp;
  }
  equals(o: WinMtfFillStyle): boolean { return this.aFillColor === o.aFillColor && this.bTransparent === o.bTransparent && this.aType === o.aType; }
}

export class WinMtfLineStyle extends GDIObj {
  aLineColor: string;
  aLineInfo: LineInfo = LineInfoDefault();
  bTransparent: boolean;
  /** WinMtfLineStyle( rColor, bTrans ), or with a pen style and width. */
  constructor(rColor: string = COL_BLACK, bTransOrStyle: boolean | number = false, nPenWidth?: number) {
    super();
    this.aLineColor = rColor;
    if (typeof bTransOrStyle === 'boolean') { this.bTransparent = bTransOrStyle; return; }
    const nStyle = bTransOrStyle;
    // Width 0 means default width for LineInfo (HairLine) with 1 pixel wide
    const li = this.aLineInfo;
    li.mnWidth = nPenWidth ?? 0;
    switch (nStyle & PenStyle.PS_STYLE_MASK) {
      case PenStyle.PS_DASHDOTDOT: li.meStyle = 'DASH'; li.mnDashCount = 1; li.mnDotCount = 2; break;
      case PenStyle.PS_DASHDOT: li.meStyle = 'DASH'; li.mnDashCount = 1; li.mnDotCount = 1; break;
      case PenStyle.PS_DOT: li.meStyle = 'DASH'; li.mnDashCount = 0; li.mnDotCount = 1; break;
      case PenStyle.PS_DASH: li.meStyle = 'DASH'; li.mnDashCount = 1; li.mnDotCount = 0; break;
      case PenStyle.PS_NULL: li.meStyle = 'NONE'; break;
      case PenStyle.PS_INSIDEFRAME: // TODO Implement PS_INSIDEFRAME
      case PenStyle.PS_SOLID:
      default: li.meStyle = 'SOLID';
    }
    if (nPenWidth) {
      switch (nStyle & PenStyle.PS_ENDCAP_STYLE_MASK) {
        case PenStyle.PS_ENDCAP_ROUND: li.meLineCap = 'round'; break;
        case PenStyle.PS_ENDCAP_SQUARE: li.meLineCap = 'square'; break;
        case PenStyle.PS_ENDCAP_FLAT:
        default: li.meLineCap = 'butt';
      }
    } else li.meLineCap = 'butt';
    switch (nStyle & PenStyle.PS_JOIN_STYLE_MASK) {
      case PenStyle.PS_JOIN_ROUND: li.meLineJoin = 'round'; break;
      case PenStyle.PS_JOIN_BEVEL: li.meLineJoin = 'bevel'; break;
      // Undocumented but based on experiments with MS Paint and MS Word,
      // the default Join Style is PS_JOIN_MITER
      case PenStyle.PS_JOIN_MITER:
      default: li.meLineJoin = 'miter';
    }
    this.bTransparent = li.meStyle === 'NONE';
  }
  clone(): WinMtfLineStyle {
    const c = new WinMtfLineStyle(this.aLineColor, this.bTransparent);
    c.aLineInfo = { ...this.aLineInfo };
    return c;
  }
  equals(o: WinMtfLineStyle): boolean { return this.aLineColor === o.aLineColor && this.bTransparent === o.bTransparent && JSON.stringify(this.aLineInfo) === JSON.stringify(o.aLineInfo); }
}

export class WinMtfPalette extends GDIObj {
  aPaletteColors: string[];
  constructor(aPaletteColors: string[] = []) { super(); this.aPaletteColors = aPaletteColors; }
}

export interface LOGFONTW {
  lfHeight: number; lfWidth: number; lfEscapement: number; lfOrientation: number; lfWeight: number;
  lfItalic: number; lfUnderline: number; lfStrikeOut: number; lfCharSet: number; lfOutPrecision: number;
  lfClipPrecision: number; lfQuality: number; lfPitchAndFamily: number; alfFaceName: string;
}

export interface XForm { eM11: number; eM12: number; eM21: number; eM22: number; eDx: number; eDy: number }
const XFormIdentity = (): XForm => ({ eM11: 1, eM12: 0, eM21: 0, eM22: 1, eDx: 0, eDy: 0 });

/** operator >> (SvStream&, XForm&) */
export function ReadXForm(rInStream: SvStream): XForm {
  return { eM11: rInStream.ReadFloat(), eM12: rInStream.ReadFloat(), eM21: rInStream.ReadFloat(), eM22: rInStream.ReadFloat(), eDx: rInStream.ReadFloat(), eDy: rInStream.ReadFloat() };
}

/** WinMtfPathObj: the path being recorded (BeginPath … EndPath), a PolyPolygon. */
export class WinMtfPathObj extends PolyPolygon {
  bClosed = true;
  ClearPath(): void { this.Clear(); this.bClosed = true; }
  AddPoint(rPoint: Point): void {
    if (this.bClosed) this.Insert(new Polygon());
    const rPoly = this.mpPolyAry[this.Count() - 1]!;
    rPoly.Insert(rPoly.GetSize(), rPoint);
    this.bClosed = false;
  }
  AddPolyLine(rPolyLine: Polygon): void {
    this.Insert(rPolyLine);
    this.bClosed = false;
  }
  AddPolygon(rPoly: Polygon): void {
    this.Insert(rPoly);
    this.bClosed = true;
  }
  AddPolyPolygon(rPolyPoly: PolyPolygon): void {
    for (const p of rPolyPoly.mpPolyAry) this.Insert(p);
    this.bClosed = true;
  }
  ClosePath(): void {
    if (this.Count()) {
      const rPoly = this.mpPolyAry[this.Count() - 1]!;
      if (rPoly.GetSize() > 2) {
        const aFirst = rPoly.GetPoint(0);
        if (!aFirst.equals(rPoly.GetPoint(rPoly.GetSize() - 1))) rPoly.Insert(rPoly.GetSize(), aFirst.clone());
      }
    }
    this.bClosed = true;
  }
  cloneObj(): WinMtfPathObj {
    const c = new WinMtfPathObj(this.mpPolyAry.map((p) => p.clone()));
    c.bClosed = this.bClosed;
    return c;
  }
}

/** WinMtfClipPath: the clip region, as regions intersected in turn (empty: no clipping). */
export class WinMtfClipPath {
  maParts: ClipPart[] = [];
  /** A rectangle beyond any metafile coordinates, for excluding parts. */
  private static readonly HUGE = 1e8;
  intersectClip(rPolyPolygon: PolyPolygon): void { this.maParts.push({ aPolyPoly: rPolyPolygon, bEvenOdd: true }); }
  excludeClip(rPolyPolygon: PolyPolygon): void {
    const H = WinMtfClipPath.HUGE;
    const aAll = new Polygon([new Point(-H, -H), new Point(H, -H), new Point(H, H), new Point(-H, H)]);
    this.maParts.push({ aPolyPoly: new PolyPolygon([aAll, ...rPolyPolygon.mpPolyAry]), bEvenOdd: true });
  }
  setClipPath(rPolyPolygon: PolyPolygon, nClippingMode: number, bEvenOdd = true): void {
    switch (nClippingMode) {
      case RegionMode.RGN_OR:
      case RegionMode.RGN_XOR: {
        // The union with no clip region is no clip region; else the polygons are joined.
        const last = this.maParts[this.maParts.length - 1];
        if (last) this.maParts[this.maParts.length - 1] = { aPolyPoly: new PolyPolygon([...last.aPolyPoly.mpPolyAry, ...rPolyPolygon.mpPolyAry]), bEvenOdd: nClippingMode === RegionMode.RGN_XOR };
        break;
      }
      case RegionMode.RGN_DIFF: this.excludeClip(rPolyPolygon); break;
      case RegionMode.RGN_AND: this.maParts.push({ aPolyPoly: rPolyPolygon, bEvenOdd }); break;
      case RegionMode.RGN_COPY: this.maParts = [{ aPolyPoly: rPolyPolygon, bEvenOdd }]; break;
    }
  }
  moveClipRegion(rSize: Size): void {
    this.maParts = this.maParts.map((p) => ({ ...p, aPolyPoly: new PolyPolygon(p.aPolyPoly.mpPolyAry.map((poly) => new Polygon(poly.mxPointAry.map((pt) => new Point(pt.X() + rSize.Width(), pt.Y() + rSize.Height())), poly.mxFlagAry))) }));
  }
  setDefaultClipPath(): void { this.maParts = []; }
  isEmpty(): boolean { return this.maParts.length === 0; }
  clone(): WinMtfClipPath { const c = new WinMtfClipPath(); c.maParts = [...this.maParts]; return c; }
  equals(o: WinMtfClipPath): boolean { return this.maParts.length === o.maParts.length && this.maParts.every((p, i) => p === o.maParts[i]); }
}

interface SaveStruct {
  nBkMode: number; eMapMode: number; eGfxMode: number;
  nWinOrgX: number; nWinOrgY: number; nWinExtX: number; nWinExtY: number;
  nDevOrgX: number; nDevOrgY: number; nDevWidth: number; nDevHeight: number;
  aLineStyle: WinMtfLineStyle; aFillStyle: WinMtfFillStyle; aFont: VclFont; aBkColor: string; aTextColor: string;
  nTextAlign: number; eRasterOp: number; aActPos: Point; maPathObj: WinMtfPathObj; maClipPath: WinMtfClipPath; aXForm: XForm;
  bClockWiseArcDirection: boolean; bFillStyleSelected: boolean;
}

export interface BSaveStruct { aBmp: MtfBitmap; aOutRect: Rectangle; nWinRop: number }

/** A character set of LOGFONT as a TextDecoder label (rtl_getTextEncodingFromWindowsCharset). */
export function GetTextEncoding(nCharSet: number): string {
  const M: Record<number, string> = {
    0x80: 'shift_jis', 0x81: 'euc-kr', 0x86: 'gbk', 0x88: 'big5', 0xa1: 'windows-1253', 0xa2: 'windows-1254', 0xa3: 'windows-1258',
    0xb1: 'windows-1255', 0xb2: 'windows-1256', 0xba: 'windows-1257', 0xcc: 'windows-1251', 0xde: 'windows-874', 0xee: 'windows-1250',
  };
  return M[nCharSet] ?? 'windows-1252';
}

export class MtfTools {
  protected maPathObj = new WinMtfPathObj();
  protected maClipPath = new WinMtfClipPath();

  protected maLatestLineStyle = new WinMtfLineStyle('#123456');
  protected maLineStyle = new WinMtfLineStyle();
  protected maNopLineStyle = new WinMtfLineStyle();
  protected maLatestFillStyle = new WinMtfFillStyle('#123456');
  protected maFillStyle = new WinMtfFillStyle();
  protected maNopFillStyle = new WinMtfFillStyle();

  protected maLatestFont: VclFont | null = null;
  protected maFont: VclFont;
  protected mnLatestTextAlign = 90;
  protected mnTextAlign = TextAlignmentMode.TA_LEFT | TextAlignmentMode.TA_TOP | TextAlignmentMode.TA_NOUPDATECP;
  protected maLatestTextColor = '';
  protected maTextColor = COL_BLACK;
  protected maLatestBkColor = '#123456';
  protected maBkColor = COL_WHITE;
  protected mnLatestBkMode: number = BackgroundMode.NONE;
  protected mnBkMode: number = BackgroundMode.OPAQUE;
  protected meLatestRasterOp: number = RasterOp.Invert;
  protected meRasterOp: number = RasterOp.OverPaint;
  /** The character set of the selected font, for 8-bit strings. */
  protected mnFontCharSet = CharacterSet.ANSI_CHARSET as number;

  protected mvGDIObj: (GDIObj | null)[] = [];
  protected mnLowestFreeGDIObj = 0;
  protected maActPos = new Point();
  protected mnRop: number = WMFRasterOp.Black;
  protected mvSaveStack: SaveStruct[] = [];

  protected meGfxMode: number = GraphicsMode.GM_COMPATIBLE;
  protected meMapMode: number = MappingMode.MM_TEXT;

  protected maXForm: XForm = XFormIdentity();
  protected mnDevOrgX = 0;
  protected mnDevOrgY = 0;
  protected mnDevWidth = 1;
  protected mnDevHeight = 1;
  protected mnWinOrgX = 0;
  protected mnWinOrgY = 0;
  protected mnWinExtX = 1;
  protected mnWinExtY = 1;

  protected mnPixX = 100; // Reference Device in pixel
  protected mnPixY = 100; // Reference Device in pixel
  protected mnMillX = 1; // Reference Device in Mill
  protected mnMillY = 1; // Reference Device in Mill
  protected mrclFrame = new Rectangle();
  protected mrclBounds = new Rectangle();

  protected mpGDIMetaFile: GDIMetaFile;
  protected mpInputStream: SvStream;
  protected mnStartPos = 0;
  protected mnEndPos = 0;
  protected maBmpSaveList: BSaveStruct[] = [];
  protected maPalette = new WinMtfPalette();

  protected mbNopMode = false;
  protected mbClockWiseArcDirection = false;
  protected mbFillStyleSelected = false;
  protected mbClipNeedsUpdate = true;
  protected mbIsMapWinSet = false;
  protected mbIsMapDevSet = false;

  constructor(rGDIMetaFile: GDIMetaFile, rStreamWMF: SvStream) {
    this.mpGDIMetaFile = rGDIMetaFile;
    this.mpInputStream = rStreamWMF;
    this.mnStartPos = this.mpInputStream.Tell();
    this.SetDevOrg(new Point());
    // sj: #i57205#, we do have some scaling problems if using the default font then most times a x11
    // font is used, we will prevent this defining a font
    this.maFont = {
      maFamilyName: 'Arial', maFontSize: new Size(0, 423), meWeight: 0, mbItalic: false, mbUnderline: false, mbStrikeout: false, mnOrientation: 0,
      meAlign: 'TOP', maColor: COL_BLACK, maFillColor: COL_TRANSPARENT, mbTransparent: true, meFamily: 'swiss', mbSymbol: false,
    };
    this.mnRop = WMFRasterOp.Black;
    this.meRasterOp = RasterOp.OverPaint;
    this.mpGDIMetaFile.AddAction({ mnType: 'RASTEROP', meRasterOp: RasterOp.OverPaint });
  }

  /** ~MtfTools: the preferred size of the metafile. */
  Finish(): void {
    this.mpGDIMetaFile.AddAction({ mnType: 'CLIPREGION', maRegion: null });
    if (this.mrclFrame.IsEmpty()) this.mpGDIMetaFile.SetPrefSize({ width: this.mnDevWidth, height: this.mnDevHeight });
    else this.mpGDIMetaFile.SetPrefSize({ width: this.mrclFrame.GetWidth(), height: this.mrclFrame.GetHeight() });
  }

  ReadColor(): string {
    const nColor = this.mpInputStream.ReadUInt32();
    let aColor = COL_BLACK;
    if ((nColor & 0xffff0000) >>> 0 === 0x01000000) {
      const index = nColor & 0x0000ffff;
      if (index < this.maPalette.aPaletteColors.length) aColor = this.maPalette.aPaletteColors[index]!;
    } else aColor = RGB(nColor & 0xff, (nColor >> 8) & 0xff, (nColor >> 16) & 0xff);
    return aColor;
  }

  /** The 8-bit text encoding of the selected font (GetCharSet). */
  GetCharSet(): string { return GetTextEncoding(this.mnFontCharSet); }
  DecodeText(aBytes: Uint8Array): string {
    try { return new TextDecoder(this.GetCharSet()).decode(aBytes); } catch { return new TextDecoder('windows-1252').decode(aBytes); }
  }

  ImplMap(rPt: Point): Point {
    if (this.mnWinExtX && this.mnWinExtY) {
      const fX = rPt.X(), fY = rPt.Y();
      let fX2 = fX * this.maXForm.eM11 + fY * this.maXForm.eM21 + this.maXForm.eDx;
      let fY2 = fX * this.maXForm.eM12 + fY * this.maXForm.eM22 + this.maXForm.eDy;
      if (this.meGfxMode === GraphicsMode.GM_COMPATIBLE) {
        fX2 -= this.mnWinOrgX;
        fY2 -= this.mnWinOrgY;
        switch (this.meMapMode) {
          case MappingMode.MM_LOENGLISH: fX2 = fX2 * 25.4; fY2 = -fY2 * 25.4; break;
          case MappingMode.MM_HIENGLISH: fX2 = fX2 * 2.54; fY2 = -fY2 * 2.54; break;
          case MappingMode.MM_TWIPS: fX2 = (fX2 * 2540) / 1440; fY2 = (-fY2 * 2540) / 1440; break;
          case MappingMode.MM_LOMETRIC: fX2 = fX2 * 10; fY2 = -fY2 * 10; break;
          case MappingMode.MM_HIMETRIC: fY2 *= -1; break; // in hundredth of a millimeter
          default: {
            if (this.mnPixX === 0 || this.mnPixY === 0) return new Point();
            if (this.meMapMode !== MappingMode.MM_TEXT) {
              fX2 /= this.mnWinExtX;
              fY2 /= this.mnWinExtY;
              fX2 *= this.mnDevWidth;
              fY2 *= this.mnDevHeight;
            }
            fX2 *= (this.mnMillX * 100.0) / this.mnPixX;
            fY2 *= (this.mnMillY * 100.0) / this.mnPixY;
          }
        }
        let nDevOrgX = this.mnDevOrgX;
        if (this.mnPixX) nDevOrgX *= (this.mnMillX * 100.0) / this.mnPixX;
        fX2 += nDevOrgX;
        let nDevOrgY = this.mnDevOrgY;
        if (this.mnPixY) nDevOrgY *= (this.mnMillY * 100.0) / this.mnPixY;
        fY2 += nDevOrgY;
        fX2 -= this.mrclFrame.Left();
        fY2 -= this.mrclFrame.Top();
      }
      return new Point(Math.round(fX2), Math.round(fY2));
    }
    return new Point();
  }

  ImplMapSize(rSz: Size, bDoWorldTransform = true): Size {
    if (this.mnWinExtX && this.mnWinExtY) {
      // #i121382# apply the whole WorldTransform, else a rotation will be misinterpreted
      let fWidth: number, fHeight: number;
      if (bDoWorldTransform) {
        fWidth = rSz.Width() * this.maXForm.eM11 + rSz.Height() * this.maXForm.eM21;
        fHeight = rSz.Width() * this.maXForm.eM12 + rSz.Height() * this.maXForm.eM22;
      } else {
        //take the scale, but not the rotation
        const m = this.maXForm, det = m.eM11 * m.eM22 - m.eM12 * m.eM21;
        const sx = Math.hypot(m.eM11, m.eM12) || 1, sy = (det < 0 ? -1 : 1) * (Math.hypot(m.eM21, m.eM22) || 1);
        fWidth = rSz.Width() * sx;
        fHeight = rSz.Height() * sy;
      }
      if (this.meGfxMode === GraphicsMode.GM_COMPATIBLE) {
        switch (this.meMapMode) {
          case MappingMode.MM_LOENGLISH: fWidth = fWidth * 25.4; fHeight = -fHeight * 25.4; break;
          case MappingMode.MM_HIENGLISH: fWidth = fWidth * 2.54; fHeight = -fHeight * 2.54; break;
          case MappingMode.MM_LOMETRIC: fWidth = fWidth * 10; fHeight = -fHeight * 10; break;
          case MappingMode.MM_HIMETRIC: fHeight *= -1; break; // in hundredth of millimeters
          case MappingMode.MM_TWIPS: fWidth = (fWidth * 2540) / 1440; fHeight = (-fHeight * 2540) / 1440; break;
          default: {
            if (this.mnPixX === 0 || this.mnPixY === 0) return new Size();
            if (this.meMapMode !== MappingMode.MM_TEXT) {
              fWidth /= this.mnWinExtX;
              fHeight /= this.mnWinExtY;
              fWidth *= this.mnDevWidth;
              fHeight *= this.mnDevHeight;
            }
            fWidth *= (this.mnMillX * 100.0) / this.mnPixX;
            fHeight *= (this.mnMillY * 100.0) / this.mnPixY;
          }
        }
      }
      return new Size(Math.round(fWidth), Math.round(fHeight));
    }
    return new Size();
  }

  ImplMapRect(rRect: Rectangle): Rectangle {
    const aRect = new Rectangle();
    aRect.SetPos(this.ImplMap(rRect.TopLeft()));
    aRect.SaturatingSetSize(this.ImplMapSize(rRect.GetSize()));
    return aRect;
  }

  ImplMapFont(rFont: VclFont): void {
    // !!! HACK: we now always set the width to zero because the OS width is interpreted differently;
    // must later be made portable in SV (KA 1996-02-08)
    const aFontSize = this.ImplMapSize(rFont.maFontSize, false);
    const nHeight = aFontSize.Height();
    if (nHeight < 0) aFontSize.setHeight(-nHeight);
    rFont.maFontSize = aFontSize;
    if (this.mnWinExtX * this.mnWinExtY < 0) rFont.mnOrientation = 3600 - rFont.mnOrientation;
  }

  ImplMapPolygon(rPolygon: Polygon): Polygon {
    for (let i = 0; i < rPolygon.GetSize(); i++) rPolygon.SetPoint(i, this.ImplMap(rPolygon.GetPoint(i)));
    return rPolygon;
  }

  ImplMapPolyPolygon(rPolyPolygon: PolyPolygon): PolyPolygon {
    for (const p of rPolyPolygon.mpPolyAry) this.ImplMapPolygon(p);
    return rPolyPolygon;
  }

  SelectObject(nIndex: number): void {
    if (nIndex & ENHMETA_STOCK_OBJECT) {
      const nStockId = nIndex & 0xff;
      switch (nStockId) {
        case StockObject.WHITE_BRUSH: this.maFillStyle = new WinMtfFillStyle(COL_WHITE); this.mbFillStyleSelected = true; break;
        case StockObject.LTGRAY_BRUSH: this.maFillStyle = new WinMtfFillStyle('#c0c0c0'); this.mbFillStyleSelected = true; break;
        case StockObject.GRAY_BRUSH: this.maFillStyle = new WinMtfFillStyle('#808080'); this.mbFillStyleSelected = true; break;
        case StockObject.DKGRAY_BRUSH: this.maFillStyle = new WinMtfFillStyle('#666666'); this.mbFillStyleSelected = true; break;
        case StockObject.BLACK_BRUSH: this.maFillStyle = new WinMtfFillStyle(COL_BLACK); this.mbFillStyleSelected = true; break;
        case StockObject.NULL_BRUSH: this.maFillStyle = new WinMtfFillStyle(COL_TRANSPARENT, true); this.mbFillStyleSelected = true; break;
        case StockObject.WHITE_PEN: this.maLineStyle = new WinMtfLineStyle(COL_WHITE, PenStyle.PS_COSMETIC, 1); break;
        case StockObject.BLACK_PEN: this.maLineStyle = new WinMtfLineStyle(COL_BLACK, PenStyle.PS_COSMETIC, 1); break;
        case StockObject.NULL_PEN: this.maLineStyle = new WinMtfLineStyle(COL_TRANSPARENT, true); break;
        default: break;
      }
    } else {
      nIndex &= 0xffff; // safety check: don't allow index to be > 65535
      const pGDIObj = nIndex < this.mvGDIObj.length ? this.mvGDIObj[nIndex] : null;
      if (pGDIObj) {
        if (pGDIObj instanceof WinMtfLineStyle) this.maLineStyle = pGDIObj.clone();
        else if (pGDIObj instanceof WinMtfFillStyle) { this.maFillStyle = pGDIObj; this.mbFillStyleSelected = true; }
        else if (pGDIObj instanceof WinMtfFontStyle) { this.maFont = { ...pGDIObj.aFont }; this.mnFontCharSet = pGDIObj.lfCharSet; }
        else if (pGDIObj instanceof WinMtfPalette) this.maPalette = pGDIObj;
      }
    }
  }

  SetArcDirection(bClockWise: boolean): void { this.mbClockWiseArcDirection = bClockWise; }
  IsArcDirectionClockWise(): boolean { return this.mbClockWiseArcDirection; }
  SetBkMode(nMode: number): void { this.mnBkMode = nMode; }
  SetBkColor(rColor: string): void { this.maBkColor = rColor; }
  SetTextColor(rColor: string): void { this.maTextColor = rColor; }
  SetTextAlign(nAlign: number): void { this.mnTextAlign = nAlign; }
  SetGfxMode(nGfxMode: number): void { this.meGfxMode = nGfxMode; }
  GetGfxMode(): number { return this.meGfxMode; }
  GetWinOrg(): Point { return new Point(this.mnWinOrgX, this.mnWinOrgY); }
  GetPathObj(): PolyPolygon { return this.maPathObj; }
  ClearPath(): void { this.maPathObj.ClearPath(); }
  ClosePath(): void { this.maPathObj.ClosePath(); }

  private ImplResizeObjectArry(nNewEntrys: number): void {
    while (this.mvGDIObj.length < nNewEntrys) this.mvGDIObj.push(null);
  }

  ImplDrawClippedPolyPolygon(rPolyPoly: PolyPolygon): void {
    if (!rPolyPoly.Count()) return;
    this.ImplSetNonPersistentLineColorTransparenz();
    if (rPolyPoly.Count() === 1) {
      const aPoly = rPolyPoly.GetObject(0).clone();
      const nCount = aPoly.GetSize();
      if (nCount) {
        if (!aPoly.GetPoint(nCount - 1).equals(aPoly.GetPoint(0))) aPoly.Insert(nCount, aPoly.GetPoint(0).clone());
        this.mpGDIMetaFile.AddAction({ mnType: 'POLYGON', maPoly: aPoly });
      }
    } else this.mpGDIMetaFile.AddAction({ mnType: 'POLYPOLYGON', maPolyPoly: rPolyPoly });
  }

  CreateObject(pObject: GDIObj | null = new GDIObj()): void {
    if (pObject) {
      if (pObject instanceof WinMtfFontStyle) {
        if (pObject.aFont.maFontSize.Height() === 0) pObject.aFont.maFontSize.setHeight(423);
        this.ImplMapFont(pObject.aFont); // defaulting to 12pt
      } else if (pObject instanceof WinMtfLineStyle) {
        const aSize = this.ImplMapSize(new Size(pObject.aLineInfo.mnWidth, 0));
        pObject.aLineInfo.mnWidth = aSize.Width();
      }
    }
    let nIndex: number;
    for (nIndex = this.mnLowestFreeGDIObj; nIndex < this.mvGDIObj.length; nIndex++) if (!this.mvGDIObj[nIndex]) break;
    if (nIndex > 0xffff) return; // the same ceiling an indexed object has
    if (nIndex === this.mvGDIObj.length) this.ImplResizeObjectArry(this.mvGDIObj.length + 16);
    this.mvGDIObj[nIndex] = pObject;
    this.mnLowestFreeGDIObj = nIndex + 1;
  }

  CreateObjectIndexed(nIndex: number, pObject: GDIObj | null): void {
    if ((nIndex & ENHMETA_STOCK_OBJECT) !== 0) return;
    nIndex &= 0xffff; // safety check: do not allow index to be > 65535
    if (pObject) {
      if (pObject instanceof WinMtfFontStyle) {
        if (pObject.aFont.maFontSize.Height() === 0) pObject.aFont.maFontSize.setHeight(423);
        this.ImplMapFont(pObject.aFont);
      } else if (pObject instanceof WinMtfLineStyle) {
        const aSize = new Size(pObject.aLineInfo.mnWidth, 0);
        pObject.aLineInfo.mnWidth = this.ImplMapSize(aSize).Width();
        if (pObject.aLineInfo.meStyle === 'DASH') {
          aSize.AdjustWidth(1);
          const nDotLen = this.ImplMapSize(aSize).Width();
          pObject.aLineInfo.mnDistance = nDotLen;
          pObject.aLineInfo.mnDotLen = nDotLen;
          pObject.aLineInfo.mnDashLen = nDotLen * 3;
        }
      }
    }
    if (nIndex >= this.mvGDIObj.length) this.ImplResizeObjectArry(nIndex + 16);
    if (!pObject && nIndex < this.mnLowestFreeGDIObj) this.mnLowestFreeGDIObj = nIndex;
    this.mvGDIObj[nIndex] = pObject;
  }

  DeleteObject(nIndex: number): void {
    if ((nIndex & ENHMETA_STOCK_OBJECT) === 0) {
      if (nIndex < this.mvGDIObj.length) {
        this.mvGDIObj[nIndex] = null;
        if (nIndex < this.mnLowestFreeGDIObj) this.mnLowestFreeGDIObj = nIndex;
      }
    }
  }

  IntersectClipRect(rRect: Rectangle): void {
    this.mbClipNeedsUpdate = true;
    if (rRect.Left() - rRect.Right() === 0 && rRect.Top() - rRect.Bottom() === 0) return; // empty rectangles cause trouble
    const aPoly = Polygon.FromRect(rRect);
    this.maClipPath = this.maClipPath.clone();
    this.maClipPath.intersectClip(new PolyPolygon([this.ImplMapPolygon(aPoly)]));
  }

  ExcludeClipRect(rRect: Rectangle): void {
    this.mbClipNeedsUpdate = true;
    const aPoly = Polygon.FromRect(rRect);
    this.maClipPath = this.maClipPath.clone();
    this.maClipPath.excludeClip(new PolyPolygon([this.ImplMapPolygon(aPoly)]));
  }

  MoveClipRegion(rSize: Size): void {
    this.mbClipNeedsUpdate = true;
    this.maClipPath = this.maClipPath.clone();
    this.maClipPath.moveClipRegion(this.ImplMapSize(rSize));
  }

  SetClipPath(rPolyPolygon: PolyPolygon, eClippingMode: number, bIsMapped: boolean, bEvenOdd = true): void {
    this.mbClipNeedsUpdate = true;
    let aPolyPolygon = rPolyPolygon.clone();
    if (!bIsMapped) aPolyPolygon = this.ImplMapPolyPolygon(aPolyPolygon);
    this.maClipPath = this.maClipPath.clone();
    this.maClipPath.setClipPath(aPolyPolygon, eClippingMode, bEvenOdd);
  }

  SetDefaultClipPath(): void {
    this.mbClipNeedsUpdate = true;
    this.maClipPath = new WinMtfClipPath();
  }

  UpdateClipRegion(): void {
    if (!this.mbClipNeedsUpdate) return;
    this.mbClipNeedsUpdate = false;
    // skip for 'no clipping at all' case
    this.mpGDIMetaFile.AddAction({ mnType: 'CLIPREGION', maRegion: this.maClipPath.isEmpty() ? null : [...this.maClipPath.maParts] });
  }

  ImplSetNonPersistentLineColorTransparenz(): void {
    const aTransparentLine = new WinMtfLineStyle(COL_TRANSPARENT, true);
    if (!this.maLatestLineStyle.equals(aTransparentLine)) {
      this.maLatestLineStyle = aTransparentLine;
      this.mpGDIMetaFile.AddAction({ mnType: 'LINECOLOR', maColor: aTransparentLine.aLineColor, mbSet: !aTransparentLine.bTransparent });
    }
  }

  UpdateLineStyle(): void {
    if (!this.maLatestLineStyle.equals(this.maLineStyle)) {
      this.maLatestLineStyle = this.maLineStyle.clone();
      this.mpGDIMetaFile.AddAction({ mnType: 'LINECOLOR', maColor: this.maLineStyle.aLineColor, mbSet: !this.maLineStyle.bTransparent });
    }
  }

  UpdateFillStyle(): void {
    if (!this.mbFillStyleSelected) // SJ: #i57205# taking care of bkcolor if no brush is selected
      this.maFillStyle = new WinMtfFillStyle(this.maBkColor, this.mnBkMode === BackgroundMode.Transparent);
    if (!this.maLatestFillStyle.equals(this.maFillStyle)) {
      this.maLatestFillStyle = this.maFillStyle;
      if (this.maFillStyle.aType === 'Solid') this.mpGDIMetaFile.AddAction({ mnType: 'FILLCOLOR', maColor: this.maFillStyle.aFillColor, mbSet: !this.maFillStyle.bTransparent });
      // Pattern brushes are not ported: they fill with black.
      else this.mpGDIMetaFile.AddAction({ mnType: 'FILLCOLOR', maColor: COL_BLACK, mbSet: true });
    }
  }

  SetRasterOp(nRasterOp: number): number {
    const nRetROP = this.mnRop;
    if (nRasterOp !== this.mnRop) {
      this.mnRop = nRasterOp;
      if (this.mbNopMode && nRasterOp !== WMFRasterOp.Nop) {
        // changing modes from WMFRasterOp::Nop so set pen and brush
        this.maFillStyle = this.maNopFillStyle;
        this.maLineStyle = this.maNopLineStyle;
        this.mbNopMode = false;
      }
      switch (nRasterOp) {
        case WMFRasterOp.Not: this.meRasterOp = RasterOp.Invert; break;
        case WMFRasterOp.XorPen: this.meRasterOp = RasterOp.Xor; break;
        case WMFRasterOp.Nop: {
          this.meRasterOp = RasterOp.OverPaint;
          if (!this.mbNopMode) {
            this.maNopFillStyle = this.maFillStyle;
            this.maNopLineStyle = this.maLineStyle;
            this.maFillStyle = new WinMtfFillStyle(COL_TRANSPARENT, true);
            this.maLineStyle = new WinMtfLineStyle(COL_TRANSPARENT, true);
            this.mbNopMode = true;
          }
          break;
        }
        default: this.meRasterOp = RasterOp.OverPaint; break;
      }
    }
    if (nRetROP !== nRasterOp) this.mpGDIMetaFile.AddAction({ mnType: 'RASTEROP', meRasterOp: this.meRasterOp });
    return nRetROP;
  }

  private HasLineWidth(): boolean {
    return !!this.maLineStyle.aLineInfo.mnWidth || this.maLineStyle.aLineInfo.meStyle === 'DASH';
  }

  StrokeAndFillPath(bStroke: boolean, bFill: boolean): void {
    if (!this.maPathObj.Count()) return;
    this.UpdateClipRegion();
    this.UpdateLineStyle();
    this.UpdateFillStyle();
    if (bFill) {
      if (!bStroke) {
        this.mpGDIMetaFile.AddAction({ mnType: 'LINECOLOR', maColor: COL_BLACK, mbSet: false });
        this.maLatestLineStyle = new WinMtfLineStyle('#123456');
      }
      if (this.maPathObj.Count() === 1) this.mpGDIMetaFile.AddAction({ mnType: 'POLYGON', maPoly: this.maPathObj.GetObject(0).clone() });
      else this.mpGDIMetaFile.AddAction({ mnType: 'POLYPOLYGON', maPolyPoly: this.maPathObj.clone() });
      if (!bStroke) this.UpdateLineStyle();
    }
    // tdf#142014 By default the stroke is made with hairline. If width is bigger, we need to use PolyLineAction
    if (bStroke) {
      // bFill is drawing hairstyle line. So we need to draw it only when the width is different than 0
      if (!bFill || this.HasLineWidth()) {
        for (let i = 0; i < this.maPathObj.Count(); i++) this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: this.maPathObj.GetObject(i).clone(), maLineInfo: { ...this.maLineStyle.aLineInfo } });
      }
    }
    this.ClearPath();
  }

  DrawPixel(rSource: Point, rColor: string): void {
    this.mpGDIMetaFile.AddAction({ mnType: 'PIXEL', maPt: this.ImplMap(rSource), maColor: rColor });
  }

  MoveTo(rPoint: Point, bRecordPath = false): void {
    const aDest = this.ImplMap(rPoint);
    if (bRecordPath) {
      // fdo#57353 create new subpath for subsequent moves
      if (this.maPathObj.Count() && this.maPathObj.GetObject(this.maPathObj.Count() - 1).GetSize()) this.maPathObj.Insert(new Polygon());
      this.maPathObj.AddPoint(aDest);
    }
    this.maActPos = aDest;
  }

  LineTo(rPoint: Point, bRecordPath = false): void {
    this.UpdateClipRegion();
    const aDest = this.ImplMap(rPoint);
    if (bRecordPath) this.maPathObj.AddPoint(aDest);
    else {
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType: 'LINE', maStartPt: this.maActPos, maEndPt: aDest, maLineInfo: { ...this.maLineStyle.aLineInfo } });
    }
    this.maActPos = aDest;
  }

  DrawRectWithBGColor(rRect: Rectangle): void {
    const aFillStyleBackup = this.maFillStyle;
    const bTransparentBackup = this.maLineStyle.bTransparent;
    const mnBkModeBackup = this.mnBkMode;
    const aPoly = Polygon.FromRect(rRect);
    this.maLineStyle.bTransparent = true;
    this.maFillStyle = new WinMtfFillStyle(this.maBkColor);
    this.mnBkMode = BackgroundMode.OPAQUE;
    this.ImplSetNonPersistentLineColorTransparenz();
    this.DrawPolygon(aPoly, false);
    this.mnBkMode = mnBkModeBackup; // The rectangle needs to be always drawned even if mode is transparent
    this.maFillStyle = aFillStyleBackup;
    this.maLineStyle.bTransparent = bTransparentBackup;
  }

  DrawRect(rRect: Rectangle, bEdge = true): void {
    this.UpdateClipRegion();
    this.UpdateFillStyle();
    if (bEdge) {
      if (this.HasLineWidth()) {
        this.ImplSetNonPersistentLineColorTransparenz();
        this.mpGDIMetaFile.AddAction({ mnType: 'RECT', maRect: this.ImplMapRect(rRect) });
        this.UpdateLineStyle();
        this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: Polygon.FromRect(this.ImplMapRect(rRect)), maLineInfo: { ...this.maLineStyle.aLineInfo } });
      } else {
        this.UpdateLineStyle();
        this.mpGDIMetaFile.AddAction({ mnType: 'RECT', maRect: this.ImplMapRect(rRect) });
      }
    } else {
      this.ImplSetNonPersistentLineColorTransparenz();
      this.mpGDIMetaFile.AddAction({ mnType: 'RECT', maRect: this.ImplMapRect(rRect) });
    }
  }

  DrawRoundRect(rRect: Rectangle, rSize: Size): void {
    this.UpdateClipRegion();
    this.UpdateLineStyle();
    this.UpdateFillStyle();
    const aSize = this.ImplMapSize(rSize);
    this.mpGDIMetaFile.AddAction({ mnType: 'ROUNDRECT', maRect: this.ImplMapRect(rRect), mnHorzRound: Math.abs(aSize.Width()), mnVertRound: Math.abs(aSize.Height()) });
    // tdf#142139 Wrong line width during WMF import
    if (this.HasLineWidth()) {
      const aRoundRectPoly = Polygon.FromRoundRect(rRect, rSize.Width(), rSize.Height());
      this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: this.ImplMapPolygon(aRoundRectPoly), maLineInfo: { ...this.maLineStyle.aLineInfo } });
    }
  }

  DrawEllipse(rRect: Rectangle): void {
    this.UpdateClipRegion();
    this.UpdateFillStyle();
    if (this.HasLineWidth()) {
      const aCenter = this.ImplMap(rRect.Center());
      const aRad = this.ImplMapSize(new Size(Math.trunc(rRect.GetWidth() / 2), Math.trunc(rRect.GetHeight() / 2)));
      this.ImplSetNonPersistentLineColorTransparenz();
      this.mpGDIMetaFile.AddAction({ mnType: 'ELLIPSE', maRect: this.ImplMapRect(rRect) });
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: Polygon.FromEllipse(aCenter, aRad.Width(), aRad.Height()), maLineInfo: { ...this.maLineStyle.aLineInfo } });
    } else {
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType: 'ELLIPSE', maRect: this.ImplMapRect(rRect) });
    }
  }

  DrawArc(rRect: Rectangle, rStart: Point, rEnd: Point, bTo = false): void {
    this.UpdateClipRegion();
    this.UpdateLineStyle();
    this.UpdateFillStyle();
    const aRect = this.ImplMapRect(rRect), aStart = this.ImplMap(rStart), aEnd = this.ImplMap(rEnd);
    if (this.HasLineWidth()) {
      if (aStart.equals(aEnd)) {
        // SJ: #i53768# if start & end is identical, then we have to draw a full ellipse
        const aCenter = aRect.Center();
        this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: Polygon.FromEllipse(aCenter, Math.trunc(aRect.GetWidth() / 2), Math.trunc(aRect.GetHeight() / 2)), maLineInfo: { ...this.maLineStyle.aLineInfo } });
      } else this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: Polygon.FromArc(aRect, aStart, aEnd, 1), maLineInfo: { ...this.maLineStyle.aLineInfo } });
    } else this.mpGDIMetaFile.AddAction({ mnType: 'ARC', maPoly: Polygon.FromArc(aRect, aStart, aEnd, 1) });
    if (bTo) this.maActPos = aEnd;
  }

  DrawPie(rRect: Rectangle, rStart: Point, rEnd: Point): void {
    this.DrawArcShape(rRect, rStart, rEnd, 2);
  }

  DrawChord(rRect: Rectangle, rStart: Point, rEnd: Point): void {
    this.DrawArcShape(rRect, rStart, rEnd, 3);
  }

  /** DrawPie and DrawChord: the closed shape filled, its outline drawn with the pen. */
  private DrawArcShape(rRect: Rectangle, rStart: Point, rEnd: Point, eStyle: 2 | 3): void {
    this.UpdateClipRegion();
    this.UpdateFillStyle();
    const aRect = this.ImplMapRect(rRect), aStart = this.ImplMap(rStart), aEnd = this.ImplMap(rEnd);
    const aPoly = Polygon.FromArc(aRect, aStart, aEnd, eStyle);
    const mnType = eStyle === 2 ? 'PIE' : 'CHORD';
    if (this.HasLineWidth()) {
      this.ImplSetNonPersistentLineColorTransparenz();
      this.mpGDIMetaFile.AddAction({ mnType, maPoly: aPoly });
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: aPoly.clone(), maLineInfo: { ...this.maLineStyle.aLineInfo } });
    } else {
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType, maPoly: aPoly });
    }
  }

  DrawPolygon(rPolygon: Polygon, bRecordPath: boolean): void {
    this.UpdateClipRegion();
    this.ImplMapPolygon(rPolygon);
    if (bRecordPath) this.maPathObj.AddPolygon(rPolygon);
    else {
      this.UpdateFillStyle();
      if (this.HasLineWidth()) {
        const nCount = rPolygon.GetSize();
        if (nCount && !rPolygon.GetPoint(nCount - 1).equals(rPolygon.GetPoint(0))) rPolygon.Insert(nCount, rPolygon.GetPoint(0).clone());
        this.ImplSetNonPersistentLineColorTransparenz();
        this.mpGDIMetaFile.AddAction({ mnType: 'POLYGON', maPoly: rPolygon });
        this.UpdateLineStyle();
        this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: rPolygon.clone(), maLineInfo: { ...this.maLineStyle.aLineInfo } });
      } else {
        this.UpdateLineStyle();
        this.mpGDIMetaFile.AddAction({ mnType: 'POLYGON', maPoly: rPolygon });
      }
    }
  }

  DrawPolyPolygon(rPolyPolygon: PolyPolygon, bRecordPath = false): void {
    this.UpdateClipRegion();
    this.ImplMapPolyPolygon(rPolyPolygon);
    if (bRecordPath) this.maPathObj.AddPolyPolygon(rPolyPolygon);
    else {
      this.UpdateFillStyle();
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType: 'POLYPOLYGON', maPolyPoly: rPolyPolygon });
      if (this.maLineStyle.aLineInfo.mnWidth > 0 || this.maLineStyle.aLineInfo.meStyle === 'DASH') {
        for (const p of rPolyPolygon.mpPolyAry) this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: p.clone(), maLineInfo: { ...this.maLineStyle.aLineInfo } });
      }
    }
  }

  DrawPolyLine(rPolygon: Polygon, bTo = false, bRecordPath = false): void {
    this.UpdateClipRegion();
    const nPoints = rPolygon.GetSize();
    if (nPoints < 1) return;
    this.ImplMapPolygon(rPolygon);
    if (bTo) {
      rPolygon.SetPoint(0, this.maActPos);
      this.maActPos = rPolygon.GetPoint(rPolygon.GetSize() - 1);
    }
    if (bRecordPath) this.maPathObj.AddPolyLine(rPolygon);
    else {
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: rPolygon, maLineInfo: { ...this.maLineStyle.aLineInfo } });
    }
  }

  DrawPolyBezier(rPolygon: Polygon, bTo: boolean, bRecordPath: boolean): void {
    const nPoints = rPolygon.GetSize();
    if (nPoints < 4 || (nPoints - 4) % 3 !== 0) return; // EMF file error: Number of Bezier points is not set of three
    this.UpdateClipRegion();
    this.ImplMapPolygon(rPolygon);
    if (bTo) {
      rPolygon.SetPoint(0, this.maActPos);
      this.maActPos = rPolygon.GetPoint(nPoints - 1);
    }
    for (let i = 0; i + 2 < nPoints;) {
      rPolygon.SetFlags(i++, PolyFlags.Normal);
      rPolygon.SetFlags(i++, PolyFlags.Control);
      rPolygon.SetFlags(i++, PolyFlags.Control);
    }
    if (bRecordPath) this.maPathObj.AddPolyLine(rPolygon);
    else {
      this.UpdateLineStyle();
      this.mpGDIMetaFile.AddAction({ mnType: 'POLYLINE', maPoly: rPolygon, maLineInfo: { ...this.maLineStyle.aLineInfo } });
    }
  }

  DrawText(rPosition: Point, rText: string, pDXArry: number[] | null = null, pDYArry: number[] | null = null, fXScale = 1, fYScale = 1, bRecordPath = false, nGfxMode: number = GraphicsMode.GM_COMPATIBLE): void {
    this.UpdateClipRegion();
    rPosition = this.ImplMap(rPosition);
    const nOldGfxMode = this.GetGfxMode();
    this.SetGfxMode(GraphicsMode.GM_COMPATIBLE);
    if (pDXArry) {
      let nSumX = 0, nSumY = 0;
      for (let i = 0; i < rText.length; i++) {
        nSumX += pDXArry[i] ?? 0;
        // #i121382# Map DXArray using WorldTransform
        const aSizeX = this.ImplMapSize(new Size(nSumX, 0));
        pDXArry[i] = Math.hypot(aSizeX.Width(), aSizeX.Height()) * (nSumX >= 0 ? 1 : -1);
        if (pDYArry) {
          nSumY += pDYArry[i] ?? 0;
          const aSizeY = this.ImplMapSize(new Size(0, nSumY));
          // Reverse Y
          pDYArry[i] = Math.round(Math.hypot(aSizeY.Width(), aSizeY.Height())) * (nSumY >= 0 ? -1 : 1);
        }
      }
    }
    this.SetGfxMode(nGfxMode);
    const eTextAlign = this.mnTextAlign & TextAlignmentMode.TA_BASELINE ? 'BASELINE' : this.mnTextAlign & TextAlignmentMode.TA_BOTTOM ? 'BOTTOM' : 'TOP';
    // Create a local copy of the current font to apply transient modifications
    // (such as color, alignment, and custom scaling) before recording it to the metafile.
    const aTmp: VclFont = { ...this.maFont, maFontSize: this.maFont.maFontSize.clone() };
    aTmp.maColor = this.maTextColor;
    if (this.mnBkMode === BackgroundMode.Transparent) { aTmp.maFillColor = COL_TRANSPARENT; aTmp.mbTransparent = true; }
    else { aTmp.maFillColor = this.maBkColor; aTmp.mbTransparent = false; }
    aTmp.meAlign = eTextAlign;

    if (nGfxMode === GraphicsMode.GM_ADVANCED) {
      // check whether there is a font rotation applied via transformation
      const aP1 = this.ImplMap(new Point());
      const aP2 = this.ImplMap(new Point(0, 100));
      const fX = aP2.X() - aP1.X(), fY = aP2.Y() - aP1.Y();
      if (fX) {
        let fOrientation = (Math.acos(fX / Math.hypot(fX, fY)) * 180) / Math.PI;
        if (fY > 0) fOrientation = 360 - fOrientation;
        fOrientation += 90;
        fOrientation *= 10;
        aTmp.mnOrientation = aTmp.mnOrientation + Math.trunc(fOrientation);
      }
    } else if (nGfxMode === GraphicsMode.GM_COMPATIBLE) {
      if (fXScale !== 0.0) {
        // As we changing only font width, we are skippin if scales have the same values
        if (Math.abs(fYScale) !== Math.abs(fXScale)) {
          const fTestWidthScale = Math.abs(fYScale / fXScale);
          const aFontSize = aTmp.maFontSize;
          // If Width is 0, the font is scaled proportionally based on Height.
          if (aFontSize.Width() === 0) aFontSize.setWidth(Math.round(aFontSize.Height() * fTestWidthScale));
          else aFontSize.setWidth(Math.round(aFontSize.Width() * fTestWidthScale));
        }
      }
      // Both scales negative = 180 degree rotation.
      if (fYScale < 0.0 && fXScale < 0.0) aTmp.mnOrientation += 1800;
      // Single-axis mirroring: the flipped coordinate system reverses the rotation direction.
      else if (fYScale < 0.0 || fXScale < 0.0) aTmp.mnOrientation = 3600 - aTmp.mnOrientation;
    }

    let meAnchor: 'start' | 'middle' | 'end' = 'start';
    if (this.mnTextAlign & (TextAlignmentMode.TA_UPDATECP | TextAlignmentMode.TA_RIGHT_CENTER)) {
      // The text width is known from the DX array only (fonts are not measured here): without one,
      // the text is anchored at its end or middle instead.
      const nLen = pDXArry ? rText.length : 0;
      let nTextWidth = 0;
      const aActPosDelta = new Point();
      if (nLen) {
        nTextWidth = nLen > 1 ? pDXArry![nLen - 1]! : pDXArry![0]!;
        // tdf#39894: We should consider the distance to next character cell origin
        aActPosDelta.setX(pDXArry![nLen - 1]!);
        if (pDYArry) aActPosDelta.setY(pDYArry[nLen - 1]!);
      } else if (this.mnTextAlign & TextAlignmentMode.TA_RIGHT_CENTER) {
        meAnchor = (this.mnTextAlign & TextAlignmentMode.TA_RIGHT_CENTER) === TextAlignmentMode.TA_CENTER ? 'middle' : 'end';
      }
      if (this.mnTextAlign & TextAlignmentMode.TA_UPDATECP) rPosition = this.maActPos;
      if (nLen && this.mnTextAlign & TextAlignmentMode.TA_RIGHT_CENTER) {
        const d = (this.mnTextAlign & TextAlignmentMode.TA_RIGHT_CENTER) === TextAlignmentMode.TA_CENTER ? nTextWidth / 2 : nTextWidth;
        const a = (this.maFont.mnOrientation * Math.PI) / 1800;
        rPosition = new Point(Math.round(rPosition.X() - d * Math.cos(a)), Math.round(rPosition.Y() + d * Math.sin(a)));
      }
      if (this.mnTextAlign & TextAlignmentMode.TA_UPDATECP) {
        const a = (this.maFont.mnOrientation * Math.PI) / 1800;
        this.maActPos = new Point(Math.round(rPosition.X() + aActPosDelta.X() * Math.cos(a) + aActPosDelta.Y() * Math.sin(a)), Math.round(rPosition.Y() - aActPosDelta.X() * Math.sin(a) + aActPosDelta.Y() * Math.cos(a)));
      }
    }

    if (!this.maLatestFont || JSON.stringify(this.maLatestFont) !== JSON.stringify(aTmp)) {
      this.maLatestFont = aTmp;
      this.mpGDIMetaFile.AddAction({ mnType: 'FONT', maFont: aTmp });
    }

    if (bRecordPath) {
      // TODO
    } else if (pDXArry && pDYArry) {
      for (let i = 0; i < rText.length; ++i) {
        const dx = i ? pDXArry[i - 1]! : 0, dy = i ? pDYArry[i - 1]! : 0;
        const a = (this.maFont.mnOrientation * Math.PI) / 1800;
        const aCharDisplacement = new Point(Math.round(dx * Math.cos(a) + dy * Math.sin(a)), Math.round(-dx * Math.sin(a) + dy * Math.cos(a)));
        this.mpGDIMetaFile.AddAction({ mnType: 'TEXTARRAY', maStartPt: new Point(rPosition.X() + aCharDisplacement.X(), rPosition.Y() + aCharDisplacement.Y()), maStr: rText[i]!, maDXAry: null });
      }
    } else {
      this.mpGDIMetaFile.AddAction({ mnType: 'TEXTARRAY', maStartPt: rPosition, maStr: rText, maDXAry: pDXArry ? pDXArry.slice(0, rText.length) : null, ...(meAnchor !== 'start' ? { meAnchor } : {}) });
    }
    this.SetGfxMode(nOldGfxMode);
  }

  ImplDrawBitmap(rPos: Point, rSize: Size, rBitmap: MtfBitmap): void {
    this.mpGDIMetaFile.AddAction({ mnType: 'BMPSCALE', maPt: rPos, maSz: rSize, maBmp: rBitmap });
  }

  ResolveBitmapActions(rSaveList: BSaveStruct[]): void {
    this.UpdateClipRegion();
    const nObjects = rSaveList.length;
    let nObjectsLeft = nObjects;
    while (nObjectsLeft) {
      let i: number;
      let nObjectsOfSameSize = 0;
      const nObjectStartIndex = nObjects - nObjectsLeft;
      let pSave = rSaveList[nObjectStartIndex]!;
      const aRect = pSave.aOutRect;
      for (i = nObjectStartIndex; i < nObjects;) {
        nObjectsOfSameSize++;
        if (++i < nObjects) {
          pSave = rSaveList[i]!;
          if (!pSave.aOutRect.equals(aRect)) break;
        }
      }
      const aPos = this.ImplMap(aRect.TopLeft());
      const aSize = this.ImplMapSize(aRect.GetSize());

      for (i = nObjectStartIndex; i < nObjectStartIndex + nObjectsOfSameSize; i++) {
        pSave = rSaveList[i]!;
        const nWinRop = pSave.nWinRop;
        const nRasterOperation = (nWinRop >>> 16) & 0xff;
        let nUsed = 0;
        if ((nRasterOperation & 0xf) !== nRasterOperation >> 4) nUsed |= 1; // pattern is used
        if ((nRasterOperation & 0x33) !== (nRasterOperation & 0xcc) >> 2) nUsed |= 2; // source is used
        if ((nRasterOperation & 0xaa) !== (nRasterOperation & 0x55) << 1) nUsed |= 4; // destination is used

        if (nUsed & 1 && (nUsed & 2) === 0 && nWinRop !== PATINVERT) {
          // patterns aren't well supported yet
          const nOldRop = this.SetRasterOp(WMFRasterOp.NONE); // in this case nRasterOperation is either 0 or 0xff
          this.UpdateFillStyle();
          this.DrawRect(aRect, false);
          this.SetRasterOp(nOldRop);
        } else {
          let bDrawn = false;
          if (i === nObjectStartIndex && nObjectsOfSameSize === 2) {
            // optimizing, sometimes it is possible to create just one transparent bitmap: a mask and its
            // image, here drawn as the image (masks are not combined pixel by pixel)
            const pSave2 = rSaveList[i + 1]!;
            if ((nWinRop === SRCPAINT && pSave2.nWinRop === SRCAND) || (nWinRop === SRCAND && pSave2.nWinRop === SRCPAINT) || (nWinRop === SRCAND && pSave2.nWinRop === SRCINVERT)) {
              this.ImplDrawBitmap(aPos, aSize, pSave2.aBmp);
              bDrawn = true;
              i++;
            }
          }
          if (!bDrawn) {
            this.Push();
            const nOldRop = this.SetRasterOp(WMFRasterOp.CopyPen);
            const nOperation = nRasterOperation & 0xf;
            switch (nOperation) {
              case 0x6:
              case 0x9:
                this.SetRasterOp(WMFRasterOp.XorPen);
                this.ImplDrawBitmap(aPos, aSize, pSave.aBmp);
                if (nOperation === 0x9) { this.SetRasterOp(WMFRasterOp.Not); this.DrawRect(aRect, false); }
                break;
              case 0x0: // WHITENESS
              case 0xf: { // BLACKNESS
                // in this case nRasterOperation is either 0 or 0xff
                const c = nRasterOperation ? COL_WHITE : COL_BLACK;
                this.maFillStyle = new WinMtfFillStyle(c);
                this.mbFillStyleSelected = true;
                this.UpdateFillStyle();
                this.DrawRect(aRect, false);
                break;
              }
              case 0x5: // only destination is used
                this.SetRasterOp(WMFRasterOp.Not);
                this.DrawRect(aRect, false);
                break;
              case 0xa: // no operation
                break;
              default:
                // 0x3, 0xc (only source is used) and the combinations of source and destination
                // draw the bitmap; they are not combined pixel by pixel.
                this.ImplDrawBitmap(aPos, aSize, pSave.aBmp);
                break;
            }
            this.SetRasterOp(nOldRop);
            this.Pop();
          }
        }
      }
      nObjectsLeft -= nObjectsOfSameSize;
    }
    rSaveList.length = 0;
  }

  SetDevOrg(rPoint: Point): void { this.mnDevOrgX = rPoint.X(); this.mnDevOrgY = rPoint.Y(); }
  SetDevOrgOffset(nXAdd: number, nYAdd: number): void { this.mnDevOrgX += nXAdd; this.mnDevOrgY += nYAdd; }

  SetDevExt(rSize: Size, regular = true): void {
    if (!(rSize.Width() && rSize.Height())) return;
    switch (this.meMapMode) {
      case MappingMode.MM_ISOTROPIC:
      case MappingMode.MM_ANISOTROPIC:
        this.mnDevWidth = rSize.Width();
        this.mnDevHeight = rSize.Height();
        break;
      //do nothing
      default: break;
    }
    if (regular) this.mbIsMapDevSet = true;
  }

  ScaleDevExt(fX: number, fY: number): void {
    this.mnDevWidth = Math.round(this.mnDevWidth * fX);
    this.mnDevHeight = Math.round(this.mnDevHeight * fY);
  }

  SetWinOrg(rPoint: Point, bIsEMF = false): void {
    this.mnWinOrgX = rPoint.X();
    this.mnWinOrgY = rPoint.Y();
    if (bIsEMF) this.SetDevByWin();
    this.mbIsMapWinSet = true;
  }

  SetWinOrgOffset(nXAdd: number, nYAdd: number): void { this.mnWinOrgX += nXAdd; this.mnWinOrgY += nYAdd; }

  SetDevByWin(): void { //mnWinExt...-stuff has to be assigned before.
    if (!this.mbIsMapDevSet) {
      if (this.meMapMode === MappingMode.MM_ISOTROPIC) { //TODO: WHAT ABOUT ANISOTROPIC???
        const nX = this.mnWinExtX + this.mnWinOrgX, nY = this.mnWinExtY - this.mnWinOrgY;
        const aSize = new Size(nX >> 4, -(nY >> 4)); // MS_FIXPOINT_BITCOUNT_28_4
        this.SetDevExt(aSize, false);
      }
    }
  }

  SetWinExt(rSize: Size, bIsEMF = false): void {
    if (!(rSize.Width() && rSize.Height())) return;
    switch (this.meMapMode) {
      case MappingMode.MM_ISOTROPIC:
      case MappingMode.MM_ANISOTROPIC:
        this.mnWinExtX = rSize.Width();
        this.mnWinExtY = rSize.Height();
        if (bIsEMF) this.SetDevByWin();
        this.mbIsMapWinSet = true;
        break;
      default: //do nothing
        break;
    }
  }

  ScaleWinExt(fX: number, fY: number): void {
    this.mnWinExtX = Math.round(this.mnWinExtX * fX);
    this.mnWinExtY = Math.round(this.mnWinExtY * fY);
  }

  SetrclBounds(rRect: Rectangle): void { this.mrclBounds = rRect; }
  SetrclFrame(rRect: Rectangle): void { this.mrclFrame = rRect; }
  SetRefPix(rSize: Size): void { this.mnPixX = rSize.Width(); this.mnPixY = rSize.Height(); }
  SetRefMill(rSize: Size): void { this.mnMillX = rSize.Width(); this.mnMillY = rSize.Height(); }

  SetMapMode(nMapMode: number): void {
    this.meMapMode = nMapMode;
    if (nMapMode === MappingMode.MM_TEXT && !this.mbIsMapWinSet) {
      this.mnWinExtX = this.mnDevWidth;
      this.mnWinExtY = this.mnDevHeight;
    } else if (this.meMapMode === MappingMode.MM_HIMETRIC) {
      this.mnWinExtX = this.mnMillX * 100;
      this.mnWinExtY = this.mnMillY * 100;
    }
  }

  SetWorldTransform(rXForm: XForm): void { this.maXForm = { ...rXForm }; }

  ModifyWorldTransform(rXForm: XForm, nMode: number): void {
    switch (nMode) {
      case ModifyWorldTransformMode.MWT_IDENTITY: this.maXForm = XFormIdentity(); break;
      case ModifyWorldTransformMode.MWT_RIGHTMULTIPLY:
      case ModifyWorldTransformMode.MWT_LEFTMULTIPLY: {
        const pLeft = nMode === ModifyWorldTransformMode.MWT_LEFTMULTIPLY ? rXForm : this.maXForm;
        const pRight = nMode === ModifyWorldTransformMode.MWT_LEFTMULTIPLY ? this.maXForm : rXForm;
        const aF = [[pLeft.eM11, pLeft.eM12, 0], [pLeft.eM21, pLeft.eM22, 0], [pLeft.eDx, pLeft.eDy, 1]];
        const bF = [[pRight.eM11, pRight.eM12, 0], [pRight.eM21, pRight.eM22, 0], [pRight.eDx, pRight.eDy, 1]];
        const cF = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) cF[i]![j]! += aF[i]![k]! * bF[k]![j]!;
        this.maXForm = { eM11: cF[0]![0]!, eM12: cF[0]![1]!, eM21: cF[1]![0]!, eM22: cF[1]![1]!, eDx: cF[2]![0]!, eDy: cF[2]![1]! };
        break;
      }
      case ModifyWorldTransformMode.MWT_SET: this.SetWorldTransform(rXForm); break;
    }
  }

  Push(): void { // !! to be able to access the original ClipRegion it
    this.UpdateClipRegion(); // is not allowed to use the MetaPushAction()
    this.mvSaveStack.push({
      aLineStyle: this.maLineStyle.clone(), aFillStyle: this.maFillStyle, aFont: { ...this.maFont }, aTextColor: this.maTextColor,
      nTextAlign: this.mnTextAlign, eMapMode: this.meMapMode, eGfxMode: this.meGfxMode, nBkMode: this.mnBkMode, aBkColor: this.maBkColor,
      bClockWiseArcDirection: this.mbClockWiseArcDirection, bFillStyleSelected: this.mbFillStyleSelected, aActPos: this.maActPos,
      aXForm: { ...this.maXForm }, eRasterOp: this.meRasterOp, nWinOrgX: this.mnWinOrgX, nWinOrgY: this.mnWinOrgY, nWinExtX: this.mnWinExtX,
      nWinExtY: this.mnWinExtY, nDevOrgX: this.mnDevOrgX, nDevOrgY: this.mnDevOrgY, nDevWidth: this.mnDevWidth, nDevHeight: this.mnDevHeight,
      maPathObj: this.maPathObj.cloneObj(), maClipPath: this.maClipPath.clone(),
    });
  }

  Pop(nSavedDC = -1): void {
    if (nSavedDC === 0) return;
    // WMF/EMF, if negative, nSavedDC represents an instance relative to the current state.
    // WMF, if positive, nSavedDC represents a specific instance of the state to be restored.
    const aIndex = nSavedDC < 0 ? this.mvSaveStack.length + nSavedDC : nSavedDC;
    if (aIndex < 0) { this.mvSaveStack = []; return; }
    if (!this.mvSaveStack.length || aIndex >= this.mvSaveStack.length) return;
    this.mvSaveStack.length = aIndex + 1;
    // Backup the current data on the stack
    const pSave = this.mvSaveStack[this.mvSaveStack.length - 1]!;
    this.maLineStyle = pSave.aLineStyle;
    this.maFillStyle = pSave.aFillStyle;
    this.maFont = pSave.aFont;
    this.maTextColor = pSave.aTextColor;
    this.mnTextAlign = pSave.nTextAlign;
    this.mnBkMode = pSave.nBkMode;
    this.meGfxMode = pSave.eGfxMode;
    this.meMapMode = pSave.eMapMode;
    this.maBkColor = pSave.aBkColor;
    this.mbClockWiseArcDirection = pSave.bClockWiseArcDirection;
    this.mbFillStyleSelected = pSave.bFillStyleSelected;
    this.maActPos = pSave.aActPos;
    this.maXForm = pSave.aXForm;
    this.meRasterOp = pSave.eRasterOp;
    this.mnWinOrgX = pSave.nWinOrgX;
    this.mnWinOrgY = pSave.nWinOrgY;
    this.mnWinExtX = pSave.nWinExtX;
    this.mnWinExtY = pSave.nWinExtY;
    this.mnDevOrgX = pSave.nDevOrgX;
    this.mnDevOrgY = pSave.nDevOrgY;
    this.mnDevWidth = pSave.nDevWidth;
    this.mnDevHeight = pSave.nDevHeight;
    this.maPathObj = pSave.maPathObj;
    if (!this.maClipPath.equals(pSave.maClipPath)) {
      this.maClipPath = pSave.maClipPath;
      this.mbClipNeedsUpdate = true;
    }
    if (this.meLatestRasterOp !== this.meRasterOp) {
      this.mpGDIMetaFile.AddAction({ mnType: 'RASTEROP', meRasterOp: this.meRasterOp });
      this.meLatestRasterOp = this.meRasterOp;
    }
    this.mvSaveStack.pop();
  }
}

export function RGB(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
