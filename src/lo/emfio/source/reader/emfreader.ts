// SPDX-License-Identifier: MPL-2.0
// @upstream emfio/source/reader/emfreader.cxx reduced
// EmfReader: reads an Enhanced Metafile into a GDIMetaFile, record by record through MtfTools.
//
// Reduced: EMF+ records (EMR_COMMENT with EMF+ data) are skipped, and the EMF records of a dual
// EMF+ file are drawn instead (upstream draws the EMF+ ones); other comments (GDI comments,
// EMFSPOOL) are skipped too. Regions are a union of their rectangles (not solved with basegfx).
// The alpha of ALPHABLEND bitmaps is the browser's reading of a 32 bit DIB (upstream builds a
// DIBV5 with its alpha mask), and a constant source alpha is not applied. Pattern brushes
// (CREATEDIBPATTERNBRUSHPT) fill with black.

import { Point, Rectangle, Size } from '../../../tools/source/generic/gen.ts';
import { Polygon, PolyPolygon } from '../../../tools/source/generic/poly.ts';
import type { SvStream } from '../../../tools/source/stream/stream.ts';
import type { GDIMetaFile } from '../../../vcl/source/gdi/gdimtf.ts';
import { ReadDIBParts } from '../../../vcl/source/bitmap/dibtools.ts';
import {
  BackgroundMode, BrushStyle, ENHMETA_STOCK_OBJECT, ExtTextOutOptions, MtfTools, PenStyle, ReadXForm, RegionMode, SRCAND, SRCINVERT,
  WinMtfFillStyle, WinMtfFontStyle, WinMtfLineStyle, type LOGFONTW,
} from './mtftools.ts';

// [MS-EMF] record types
const EMR_HEADER = 1, EMR_POLYBEZIER = 2, EMR_POLYGON = 3, EMR_POLYLINE = 4, EMR_POLYBEZIERTO = 5, EMR_POLYLINETO = 6, EMR_POLYPOLYLINE = 7,
  EMR_POLYPOLYGON = 8, EMR_SETWINDOWEXTEX = 9, EMR_SETWINDOWORGEX = 10, EMR_SETVIEWPORTEXTEX = 11, EMR_SETVIEWPORTORGEX = 12, EMR_EOF = 14,
  EMR_SETPIXELV = 15, EMR_SETMAPMODE = 17, EMR_SETBKMODE = 18, EMR_SETPOLYFILLMODE = 19, EMR_SETROP2 = 20, EMR_SETSTRETCHBLTMODE = 21,
  EMR_SETTEXTALIGN = 22, EMR_SETTEXTCOLOR = 24, EMR_SETBKCOLOR = 25, EMR_OFFSETCLIPRGN = 26, EMR_MOVETOEX = 27, EMR_EXCLUDECLIPRECT = 29,
  EMR_INTERSECTCLIPRECT = 30, EMR_SCALEVIEWPORTEXTEX = 31, EMR_SCALEWINDOWEXTEX = 32, EMR_SAVEDC = 33, EMR_RESTOREDC = 34,
  EMR_SETWORLDTRANSFORM = 35, EMR_MODIFYWORLDTRANSFORM = 36, EMR_SELECTOBJECT = 37, EMR_CREATEPEN = 38, EMR_CREATEBRUSHINDIRECT = 39,
  EMR_DELETEOBJECT = 40, EMR_ANGLEARC = 41, EMR_ELLIPSE = 42, EMR_RECTANGLE = 43, EMR_ROUNDRECT = 44, EMR_ARC = 45, EMR_CHORD = 46, EMR_PIE = 47,
  EMR_LINETO = 54, EMR_ARCTO = 55, EMR_POLYDRAW = 56, EMR_SETARCDIRECTION = 57, EMR_BEGINPATH = 59, EMR_ENDPATH = 60, EMR_CLOSEFIGURE = 61,
  EMR_FILLPATH = 62, EMR_STROKEANDFILLPATH = 63, EMR_STROKEPATH = 64, EMR_SELECTCLIPPATH = 67, EMR_ABORTPATH = 68, EMR_COMMENT = 70,
  EMR_FILLRGN = 71, EMR_PAINTRGN = 74, EMR_EXTSELECTCLIPRGN = 75, EMR_BITBLT = 76, EMR_STRETCHBLT = 77, EMR_STRETCHDIBITS = 81,
  EMR_EXTCREATEFONTINDIRECTW = 82, EMR_EXTTEXTOUTA = 83, EMR_EXTTEXTOUTW = 84, EMR_POLYBEZIER16 = 85, EMR_POLYGON16 = 86, EMR_POLYLINE16 = 87,
  EMR_POLYBEZIERTO16 = 88, EMR_POLYLINETO16 = 89, EMR_POLYPOLYLINE16 = 90, EMR_POLYPOLYGON16 = 91, EMR_CREATEDIBPATTERNBRUSHPT = 94,
  EMR_EXTCREATEPEN = 95, EMR_POLYTEXTOUTA = 96, EMR_POLYTEXTOUTW = 97, EMR_SMALLTEXTOUT = 108, EMR_ALPHABLEND = 114;

const ARCDIRECTION_CLOCKWISE = 0x00000002;
const PT_CLOSEFIGURE = 0x01, PT_LINETO = 0x02, PT_BEZIERTO = 0x04, PT_MOVETO = 0x06;
const RDH_RECTANGLES = 1;
const LF_FACESIZE = 32;
const SAL_MAX_UINT16 = 0xffff;

/** ImplReadRegion: the rectangles of a region (RGNDATA), offset by the window origin. */
function ImplReadRegion(rStream: SvStream, nLen: number, aWinOrg: Point): PolyPolygon | null {
  if (nLen < 32) return null; // 32 bytes - Size of RegionDataHeader
  rStream.ReadUInt32(); // nHdSize
  const nType = rStream.ReadUInt32(), nCountRects = rStream.ReadUInt32();
  rStream.ReadUInt32(); // nRgnSize
  //bounds of the region
  rStream.SeekRel(16);
  if (nCountRects === 0 || nType !== RDH_RECTANGLES) return null;
  nLen -= 32;
  if (nLen < nCountRects * 16) return null;
  const aPolyPoly = new PolyPolygon();
  for (let i = 0; i < nCountRects; ++i) {
    const nLeft = rStream.ReadInt32() + aWinOrg.X(), nTop = rStream.ReadInt32() + aWinOrg.Y();
    const nRight = rStream.ReadInt32() + aWinOrg.X(), nBottom = rStream.ReadInt32() + aWinOrg.Y();
    aPolyPoly.Insert(new Polygon([new Point(nLeft, nTop), new Point(nRight, nTop), new Point(nRight, nBottom), new Point(nLeft, nBottom)]));
  }
  return aPolyPoly;
}

export class EmfReader extends MtfTools {
  private mnRecordCount = 0;
  private mbRecordPath = false;

  constructor(rStream: SvStream, rGDIMetaFile: GDIMetaFile) {
    super(rGDIMetaFile, rStream);
  }

  /** ReadPolygonWithSkip: the bounds, the point count, then the points (with a first point for the current position). */
  private ReadPolygonWithSkip(b16: boolean, skipFirst: boolean, nNextPos: number): Polygon {
    this.mpInputStream.SeekRel(16);
    let nPoints = this.mpInputStream.ReadUInt32(), nStartIndex = 0;
    if (skipFirst) { nPoints++; nStartIndex++; }
    return this.ReadPolygon(b16, nStartIndex, nPoints, nNextPos);
  }

  private ReadPolygon(b16: boolean, nStartIndex: number, nPoints: number, nNextPos: number): Polygon {
    const bRecordOk = nPoints <= SAL_MAX_UINT16;
    if (!bRecordOk || !nPoints) return new Polygon();
    // The header fields are read before this point, so a record that is shorter than those
    // fields leaves the stream past the end of its own data and holds no points at all.
    const nEndPos = Math.min(nNextPos, this.mnEndPos);
    const s = this.mpInputStream;
    if (s.Tell() >= nEndPos) return new Polygon();
    const nRemainingSize = Math.min(nEndPos - s.Tell(), s.remainingSize());
    const nMaxPossiblePoints = Math.floor(nRemainingSize / (b16 ? 4 : 8));
    if (nPoints - nStartIndex > nMaxPossiblePoints) nPoints = nMaxPossiblePoints + nStartIndex;
    const aPolygon = new Polygon(Array.from({ length: nPoints }, () => new Point()));
    for (let i = nStartIndex; i < nPoints; i++) {
      const nX = b16 ? s.ReadInt16() : s.ReadInt32(), nY = b16 ? s.ReadInt16() : s.ReadInt32();
      aPolygon.SetPoint(i, new Point(nX, nY));
    }
    return aPolygon;
  }

  /** ReadAndDrawPolyLine: several polylines. */
  private ReadAndDrawPolyLine(b16: boolean, nNextPos: number): void {
    const s = this.mpInputStream;
    s.SeekRel(0x10); // TODO Skipping Bounds. A 128-bit WMF RectL object (specifies the bounding rectangle in device units.)
    const nNumberOfPolylines = s.ReadUInt32();
    s.ReadUInt32(); // total number of points in all polylines
    const nEndPos = Math.min(nNextPos, this.mnEndPos);
    if (s.Tell() >= nEndPos) return;
    // taking the amount of points of each polygon, retrieving the total number of points
    if (nNumberOfPolylines * 4 > nEndPos - s.Tell()) return;
    const pnPolylinePointCount: number[] = [];
    for (let i = 0; i < nNumberOfPolylines; i++) pnPolylinePointCount[i] = s.ReadUInt32();
    // Get polyline points:
    for (let i = 0; i < nNumberOfPolylines; i++) {
      const aPolygon = this.ReadPolygon(b16, 0, pnPolylinePointCount[i]!, nNextPos);
      this.DrawPolyLine(aPolygon, false, this.mbRecordPath);
    }
  }

  /** ReadAndDrawPolyPolygon: a poly polygon. */
  private ReadAndDrawPolyPolygon(b16: boolean, nNextPos: number): void {
    const s = this.mpInputStream;
    s.SeekRel(0x10); // RectL bounds
    // Number of polygons
    const nPoly = s.ReadUInt32(), nGesPoints = s.ReadUInt32();
    const nEndPos = Math.min(nNextPos, this.mnEndPos);
    if (s.Tell() >= nEndPos) return;
    if (nPoly * 4 > nEndPos - s.Tell()) return;
    // Get number of points in each polygon
    const aPoints: number[] = [];
    for (let i = 0; i < nPoly; ++i) aPoints[i] = s.ReadUInt32();
    const nSize = b16 ? 4 : 8;
    if (nGesPoints * nSize > nEndPos - s.Tell()) return;
    // Get polygon points
    const aPolyPoly = new PolyPolygon();
    for (let i = 0; i < nPoly; ++i) {
      const nPointCount = aPoints[i]!;
      if (nPointCount > (nEndPos - s.Tell()) / nSize) return;
      const aPtAry: Point[] = [];
      for (let j = 0; j < nPointCount; ++j) {
        const nX = b16 ? s.ReadInt16() : s.ReadInt32(), nY = b16 ? s.ReadInt16() : s.ReadInt32();
        aPtAry.push(new Point(nX, nY));
      }
      aPolyPoly.Insert(new Polygon(aPtAry));
    }
    this.DrawPolyPolygon(aPolyPoly, this.mbRecordPath);
  }

  /** A DIB stored in a record as BITMAPINFO at offBmi and bits at offBits (from the record start). */
  private ReadRecordDIB(nStart: number, offBmi: number, cbBmi: number, offBits: number, cbBits: number) {
    const s = this.mpInputStream;
    if (cbBmi + cbBits + 14 > this.mnEndPos - this.mnStartPos) return null;
    s.Seek(nStart + offBmi);
    const aBmi = s.ReadBytes(cbBmi);
    s.Seek(nStart + offBits);
    const aBits = s.ReadBytes(cbBits);
    return ReadDIBParts(aBmi, aBits);
  }

  ReadEnhWMF(): boolean {
    let bStatus: boolean;
    try { bStatus = this.ReadHeader(); } catch { return false; }
    const s = this.mpInputStream;

    while (bStatus && this.mnRecordCount-- > 0 && s.Tell() + 8 <= this.mnEndPos) {
      const nRecType = s.ReadUInt32(), nRecSize = s.ReadUInt32();
      if (nRecSize < 8 || nRecSize & 3) { bStatus = false; break; } // Parameters are always divisible by 4
      const nCurPos = s.Tell();
      if (this.mnEndPos < nCurPos - 8) { bStatus = false; break; }
      const nMaxPossibleRecSize = this.mnEndPos - (nCurPos - 8);
      if (nRecSize > nMaxPossibleRecSize) { bStatus = false; break; }
      const nNextPos = nCurPos + (nRecSize - 8);

      if (this.maBmpSaveList.length && nRecType !== EMR_STRETCHBLT && nRecType !== EMR_STRETCHDIBITS) this.ResolveBitmapActions(this.maBmpSaveList);

      try {
        bStatus = this.ReadRecord(nRecType, nRecSize, nNextPos);
      } catch {
        bStatus = false;
      }
      s.Seek(nNextPos);
    }

    if (this.maBmpSaveList.length) this.ResolveBitmapActions(this.maBmpSaveList);
    if (bStatus) s.Seek(this.mnEndPos);
    return bStatus;
  }

  /** One record of ReadEnhWMF's switch; false when the record is broken. */
  private ReadRecord(nRecType: number, nRecSize: number, nNextPos: number): boolean {
    const s = this.mpInputStream;
    let bStatus = true;
    let bFlag = false;
    switch (nRecType) {
      case EMR_POLYBEZIERTO: this.DrawPolyBezier(this.ReadPolygonWithSkip(false, true, nNextPos), true, this.mbRecordPath); break;
      case EMR_POLYBEZIER: this.DrawPolyBezier(this.ReadPolygonWithSkip(false, false, nNextPos), false, this.mbRecordPath); break;
      case EMR_POLYGON: this.DrawPolygon(this.ReadPolygonWithSkip(false, false, nNextPos), this.mbRecordPath); break;
      case EMR_POLYLINETO: this.DrawPolyLine(this.ReadPolygonWithSkip(false, true, nNextPos), true, this.mbRecordPath); break;

      case EMR_POLYDRAW: {
        s.SeekRel(16);
        const nPointsCount0 = s.ReadUInt32();
        const aPoints: Point[] = [];
        const aPointTypes: number[] = [];
        let wrongFile = false, nBezierCount = 0;
        for (let i = 0; i < nPointsCount0 && s.Tell() + 8 <= nNextPos; i++) aPoints.push(new Point(s.ReadInt32(), s.ReadInt32()));
        for (let i = 0; i < nPointsCount0 && s.Tell() < nNextPos; i++) aPointTypes.push(s.ReadUChar());
        const nPointsCount = Math.min(aPoints.length, aPointTypes.length);
        for (let i = 0; i < nPointsCount; i++) {
          if (aPointTypes[i] !== PT_MOVETO && aPointTypes[i]! & PT_BEZIERTO) nBezierCount++;
          else if (nBezierCount % 3 === 0) nBezierCount = 0;
          else wrongFile = true; // EMF file error: Number of Bezier points is not set of three.
        }
        if (wrongFile) break;
        for (let i = 0; i < nPointsCount; i++) {
          if (aPointTypes[i] === PT_MOVETO) this.MoveTo(aPoints[i]!, true);
          else if (aPointTypes[i]! & PT_LINETO) {
            this.LineTo(aPoints[i]!, true);
            if (aPointTypes[i]! & PT_CLOSEFIGURE) this.ClosePath();
          } else if (aPointTypes[i]! & PT_BEZIERTO) {
            if (nPointsCount - i < 3) break;
            // the control points are mapped by DrawPolyBezier with the current position
            const aPolygon = new Polygon([new Point(), aPoints[i++]!, aPoints[i++]!, aPoints[i]!]);
            this.DrawPolyBezier(aPolygon, true, true);
            if (aPointTypes[i]! & PT_CLOSEFIGURE) this.ClosePath();
          }
        }
        this.StrokeAndFillPath(true, false);
        break;
      }

      case EMR_POLYLINE: this.DrawPolyLine(this.ReadPolygonWithSkip(false, false, nNextPos), false, this.mbRecordPath); break;
      case EMR_POLYPOLYLINE: this.ReadAndDrawPolyLine(false, nNextPos); break;
      case EMR_POLYPOLYGON: this.ReadAndDrawPolyPolygon(false, nNextPos); break;

      case EMR_SETWINDOWEXTEX: {
        const w = s.ReadInt32(), h = s.ReadInt32();
        this.SetWinExt(new Size(w, h), true);
        break;
      }
      case EMR_SETWINDOWORGEX: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32();
        this.SetWinOrg(new Point(nX32, nY32), true);
        break;
      }
      case EMR_SCALEWINDOWEXTEX: {
        const nNom1 = s.ReadInt32(), nDen1 = s.ReadInt32(), nNom2 = s.ReadInt32(), nDen2 = s.ReadInt32();
        if (nDen1 !== 0 && nDen2 !== 0) this.ScaleWinExt(nNom1 / nDen1, nNom2 / nDen2);
        break;
      }
      case EMR_SETVIEWPORTORGEX: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32();
        this.SetDevOrg(new Point(nX32, nY32));
        break;
      }
      case EMR_SCALEVIEWPORTEXTEX: {
        const nNom1 = s.ReadInt32(), nDen1 = s.ReadInt32(), nNom2 = s.ReadInt32(), nDen2 = s.ReadInt32();
        if (nDen1 !== 0 && nDen2 !== 0) this.ScaleDevExt(nNom1 / nDen1, nNom2 / nDen2);
        break;
      }
      case EMR_SETVIEWPORTEXTEX: {
        const w = s.ReadInt32(), h = s.ReadInt32();
        this.SetDevExt(new Size(w, h));
        break;
      }
      case EMR_EOF: this.mnRecordCount = 0; break;
      case EMR_SETPIXELV: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32();
        this.DrawPixel(new Point(nX32, nY32), this.ReadColor());
        break;
      }
      case EMR_SETMAPMODE: this.SetMapMode(s.ReadUInt32()); break;
      case EMR_SETBKMODE: this.SetBkMode(s.ReadUInt32()); break;
      case EMR_SETPOLYFILLMODE: break;
      case EMR_SETROP2: this.SetRasterOp(s.ReadUInt32()); break;
      case EMR_SETSTRETCHBLTMODE: s.ReadUInt32(); break;
      case EMR_SETTEXTALIGN: this.SetTextAlign(s.ReadUInt32()); break;
      case EMR_SETTEXTCOLOR: this.SetTextColor(this.ReadColor()); break;
      case EMR_SETARCDIRECTION: this.SetArcDirection(s.ReadUInt32() === ARCDIRECTION_CLOCKWISE); break;
      case EMR_SETBKCOLOR: this.SetBkColor(this.ReadColor()); break;
      case EMR_OFFSETCLIPRGN: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32();
        this.MoveClipRegion(new Size(nX32, nY32));
        break;
      }
      case EMR_MOVETOEX: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32();
        this.MoveTo(new Point(nX32, nY32), this.mbRecordPath);
        break;
      }
      case EMR_INTERSECTCLIPRECT: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32(), nx32 = s.ReadInt32(), ny32 = s.ReadInt32();
        this.IntersectClipRect(this.ReadRectangle4(nX32, nY32, nx32, ny32));
        break;
      }
      case EMR_EXCLUDECLIPRECT: break; // not implemented upstream
      case EMR_SAVEDC: this.Push(); break;
      case EMR_RESTOREDC: {
        const nSavedDC = s.ReadInt32();
        if (nSavedDC < 0) this.Pop(nSavedDC);
        else this.Pop(-1); // For RestoreDC values above -1, treat as get last element
        break;
      }
      case EMR_SETWORLDTRANSFORM: this.SetWorldTransform(ReadXForm(s)); break;
      case EMR_MODIFYWORLDTRANSFORM: {
        const aTempXForm = ReadXForm(s);
        const nMode = s.ReadUInt32();
        this.ModifyWorldTransform(aTempXForm, nMode);
        break;
      }
      case EMR_SELECTOBJECT: this.SelectObject(s.ReadUInt32()); break;

      case EMR_CREATEPEN: {
        const nIndex = s.ReadUInt32();
        if ((nIndex & ENHMETA_STOCK_OBJECT) === 0) {
          let nPenStyle = s.ReadUInt32();
          const nPenWidth = s.ReadInt32();
          s.ReadInt32(); // nIgnored
          if ((nPenStyle & PenStyle.PS_STYLE_MASK) > PenStyle.PS_INSIDEFRAME) nPenStyle = PenStyle.PS_COSMETIC;
          this.CreateObjectIndexed(nIndex, new WinMtfLineStyle(this.ReadColor(), nPenStyle, nPenWidth));
        }
        break;
      }
      case EMR_EXTCREATEPEN: {
        const nIndex = s.ReadUInt32();
        if ((nIndex & ENHMETA_STOCK_OBJECT) === 0) {
          s.SeekRel(16); // offBmi, cbBmi, offBits, cbBits
          let nPenStyle = s.ReadUInt32();
          const nWidth = s.ReadUInt32();
          s.ReadUInt32(); // nBrushStyle
          const aColorRef = this.ReadColor();
          if ((nPenStyle & PenStyle.PS_STYLE_MASK) > PenStyle.PS_INSIDEFRAME) nPenStyle = PenStyle.PS_COSMETIC;
          this.CreateObjectIndexed(nIndex, new WinMtfLineStyle(aColorRef, nPenStyle, nWidth));
        }
        break;
      }
      case EMR_CREATEBRUSHINDIRECT: {
        const nIndex = s.ReadUInt32();
        if ((nIndex & ENHMETA_STOCK_OBJECT) === 0) {
          const nStyle = s.ReadUInt32();
          this.CreateObjectIndexed(nIndex, new WinMtfFillStyle(this.ReadColor(), nStyle === BrushStyle.BS_HOLLOW));
        }
        break;
      }
      case EMR_DELETEOBJECT: {
        const nIndex = s.ReadUInt32();
        if ((nIndex & ENHMETA_STOCK_OBJECT) === 0) this.DeleteObject(nIndex);
        break;
      }
      case EMR_ELLIPSE: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32(), nx32 = s.ReadInt32(), ny32 = s.ReadInt32();
        const dw = Math.trunc((nx32 - nX32) / 2), dh = Math.trunc((ny32 - nY32) / 2);
        const aCenter = new Point(nX32 + dw, nY32 + dh);
        this.DrawPolygon(Polygon.FromEllipse(aCenter, dw, dh), this.mbRecordPath);
        break;
      }
      case EMR_RECTANGLE: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32(), nx32 = s.ReadInt32(), ny32 = s.ReadInt32();
        const aPoly = new Polygon([new Point(nX32, nY32), new Point(nx32, nY32), new Point(nx32, ny32), new Point(nX32, ny32)]);
        aPoly.OptimizeClose();
        this.DrawPolygon(aPoly, this.mbRecordPath);
        break;
      }
      case EMR_ROUNDRECT: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32(), nx32 = s.ReadInt32(), ny32 = s.ReadInt32(), nW = s.ReadUInt32(), nH = s.ReadUInt32();
        // Convert from ellipse width and height to ellipse vertical and horizontal radius
        this.DrawPolygon(Polygon.FromRoundRect(this.ReadRectangle4(nX32, nY32, nx32, ny32), nW >> 1, nH >> 1), this.mbRecordPath);
        break;
      }
      case EMR_ANGLEARC: {
        const nCenterX = s.ReadInt32(), nCenterY = s.ReadInt32(), nRadius = s.ReadUInt32();
        // Convert from degrees to radians and start angle to draw from x-axis
        const fStartAngle = (s.ReadFloat() * Math.PI) / 180, fSweepAngle = (s.ReadFloat() * Math.PI) / 180;
        const aPoly = Polygon.FromAngleArc(new Point(nCenterX, nCenterY), nRadius, fStartAngle, fSweepAngle, this.IsArcDirectionClockWise());
        if (aPoly.GetSize()) {
          // Before drawing the arc, AngleArc draws the line segment from the current position to the beginning of the arc
          this.LineTo(aPoly.GetPoint(0), this.mbRecordPath);
          this.DrawPolyLine(aPoly, true, this.mbRecordPath);
        }
        break;
      }
      case EMR_ARC:
      case EMR_ARCTO:
      case EMR_CHORD: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32(), nx32 = s.ReadInt32(), ny32 = s.ReadInt32();
        const nStartX = s.ReadInt32(), nStartY = s.ReadInt32(), nEndX = s.ReadInt32(), nEndY = s.ReadInt32();
        const aPoly = Polygon.FromArc(this.ReadRectangle4(nX32, nY32, nx32, ny32), new Point(nStartX, nStartY), new Point(nEndX, nEndY), 1, this.IsArcDirectionClockWise());
        if (nRecType === EMR_CHORD) this.DrawPolygon(aPoly, this.mbRecordPath);
        else this.DrawPolyLine(aPoly, nRecType === EMR_ARCTO, this.mbRecordPath);
        break;
      }
      case EMR_PIE: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32(), nx32 = s.ReadInt32(), ny32 = s.ReadInt32();
        const nStartX = s.ReadInt32(), nStartY = s.ReadInt32(), nEndX = s.ReadInt32(), nEndY = s.ReadInt32();
        const aPoly = Polygon.FromArc(this.ReadRectangle4(nX32, nY32, nx32, ny32), new Point(nStartX, nStartY), new Point(nEndX, nEndY), 2, this.IsArcDirectionClockWise());
        this.DrawPolygon(aPoly, this.mbRecordPath);
        break;
      }
      case EMR_LINETO: {
        const nX32 = s.ReadInt32(), nY32 = s.ReadInt32();
        this.LineTo(new Point(nX32, nY32), this.mbRecordPath);
        break;
      }
      case EMR_BEGINPATH: this.ClearPath(); this.mbRecordPath = true; break;
      case EMR_ABORTPATH: this.ClearPath(); this.mbRecordPath = false; break;
      case EMR_ENDPATH: this.mbRecordPath = false; break;
      case EMR_CLOSEFIGURE: this.ClosePath(); break;
      case EMR_FILLPATH: this.StrokeAndFillPath(false, true); break;
      case EMR_STROKEANDFILLPATH: this.StrokeAndFillPath(true, true); break;
      case EMR_STROKEPATH: this.StrokeAndFillPath(true, false); break;
      case EMR_SELECTCLIPPATH: {
        const nClippingMode = s.ReadUInt32();
        this.SetClipPath(this.GetPathObj(), nClippingMode, true);
        break;
      }
      case EMR_EXTSELECTCLIPRGN: {
        let nRemainingRecSize = nRecSize - 8;
        if (nRemainingRecSize < 8) { bStatus = false; break; }
        const cbRgnDataSize = s.ReadUInt32(), nClippingMode = s.ReadUInt32();
        nRemainingRecSize -= 8;
        // This record's region data should be ignored if mode
        // is RGN_COPY - see EMF spec section 2.3.2.2
        if (nClippingMode === RegionMode.RGN_COPY) this.SetDefaultClipPath();
        else {
          const aPolyPoly = cbRgnDataSize ? ImplReadRegion(s, nRemainingRecSize, this.GetWinOrg()) : null;
          this.SetClipPath(aPolyPoly ?? new PolyPolygon(), nClippingMode, false, false);
        }
        break;
      }

      case EMR_ALPHABLEND: {
        const nStart = s.Tell() - 8;
        s.SeekRel(0x10);
        const xDest = s.ReadInt32(), yDest = s.ReadInt32(), cxDest = s.ReadInt32(), cyDest = s.ReadInt32();
        s.ReadUInt32(); // BLENDFUNCTION
        const xSrc = s.ReadInt32(), ySrc = s.ReadInt32();
        ReadXForm(s);
        s.ReadUInt32(); // BkColorSrc
        s.ReadUInt32(); // iUsageSrc
        const offBmiSrc = s.ReadUInt32(), cbBmiSrc = s.ReadUInt32(), offBitsSrc = s.ReadUInt32(), cbBitsSrc = s.ReadUInt32();
        const cxSrc = s.ReadInt32(), cySrc = s.ReadInt32();
        const aRect = Rectangle.FromPointSize(new Point(xDest, yDest), new Size(cxDest + 1, cyDest + 1));
        let aBitmap = this.ReadRecordDIB(nStart, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc);
        if (aBitmap) {
          // test if it is sensible to crop
          if (cxSrc > 0 && cySrc > 0 && xSrc >= 0 && ySrc >= 0 && xSrc + cxSrc < aBitmap.width && ySrc + cySrc < aBitmap.height) {
            aBitmap = { ...aBitmap, crop: { x: xSrc, y: ySrc, width: cxSrc, height: cySrc } };
          }
          this.maBmpSaveList.push({ aBmp: aBitmap, aOutRect: aRect, nWinRop: (SRCAND | SRCINVERT) >>> 0 });
        }
        break;
      }

      case EMR_BITBLT: // PASSTHROUGH INTENDED
      case EMR_STRETCHBLT: {
        const nStart = s.Tell() - 8;
        s.SeekRel(0x10);
        const xDest = s.ReadInt32(), yDest = s.ReadInt32(), cxDest = s.ReadInt32(), cyDest = s.ReadInt32();
        const dwRop = s.ReadUInt32();
        const xSrc = s.ReadInt32(), ySrc = s.ReadInt32();
        ReadXForm(s);
        s.ReadUInt32(); // nColor
        s.ReadUInt32(); // iUsageSrc
        const offBmiSrc = s.ReadUInt32(), cbBmiSrc = s.ReadUInt32(), offBitsSrc = s.ReadUInt32(), cbBitsSrc = s.ReadUInt32();
        let cxSrc = 0, cySrc = 0;
        if (nRecType === EMR_STRETCHBLT) { cxSrc = s.ReadInt32(); cySrc = s.ReadInt32(); }
        const aRect = Rectangle.FromPointSize(new Point(xDest, yDest), new Size(cxDest, cyDest));
        // A BITBLT without a source bitmap paints with the brush (an empty bitmap here).
        let aBitmap = (cbBmiSrc ? this.ReadRecordDIB(nStart, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc) : null) ?? { width: 0, height: 0, href: '' };
        // test if it is sensible to crop
        if (cxSrc > 0 && cySrc > 0 && xSrc >= 0 && ySrc >= 0 && aBitmap.width >= cxSrc && xSrc <= aBitmap.width - cxSrc && aBitmap.height >= cySrc && ySrc <= aBitmap.height - cySrc) {
          aBitmap = { ...aBitmap, crop: { x: xSrc, y: ySrc, width: cxSrc, height: cySrc } };
        }
        this.maBmpSaveList.push({ aBmp: aBitmap, aOutRect: aRect, nWinRop: dwRop });
        break;
      }

      case EMR_STRETCHDIBITS: {
        const nStart = s.Tell() - 8;
        s.SeekRel(0x10);
        const xDest = s.ReadInt32(), yDest = s.ReadInt32(), xSrc = s.ReadInt32(), ySrc = s.ReadInt32(), cxSrc = s.ReadInt32(), cySrc = s.ReadInt32();
        const offBmiSrc = s.ReadUInt32(), cbBmiSrc = s.ReadUInt32(), offBitsSrc = s.ReadUInt32(), cbBitsSrc = s.ReadUInt32();
        s.ReadUInt32(); // iUsageSrc
        const dwRop = s.ReadUInt32();
        const cxDest = s.ReadInt32(), cyDest = s.ReadInt32();
        const aRect = new Rectangle(xDest, yDest);
        aRect.SaturatingSetSize(new Size(cxDest, cyDest));
        let aBitmap = this.ReadRecordDIB(nStart, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc);
        if (aBitmap) {
          const nWidthDiff = aBitmap.width - cxSrc, nHeightDiff = aBitmap.height - cySrc;
          // test if it is sensible to crop
          if (cxSrc > 0 && cySrc > 0 && xSrc >= 0 && ySrc >= 0 && xSrc <= nWidthDiff && ySrc <= nHeightDiff) {
            aBitmap = { ...aBitmap, crop: { x: xSrc, y: ySrc, width: cxSrc, height: cySrc } };
          }
          this.maBmpSaveList.push({ aBmp: aBitmap, aOutRect: aRect, nWinRop: dwRop });
        }
        break;
      }

      case EMR_EXTCREATEFONTINDIRECTW: {
        const nIndex = s.ReadUInt32();
        if ((nIndex & ENHMETA_STOCK_OBJECT) === 0) {
          const aLogFont: LOGFONTW = {
            lfHeight: s.ReadInt32(), lfWidth: s.ReadInt32(), lfEscapement: s.ReadInt32(), lfOrientation: s.ReadInt32(), lfWeight: s.ReadInt32(),
            lfItalic: s.ReadUChar(), lfUnderline: s.ReadUChar(), lfStrikeOut: s.ReadUChar(), lfCharSet: s.ReadUChar(), lfOutPrecision: s.ReadUChar(),
            lfClipPrecision: s.ReadUChar(), lfQuality: s.ReadUChar(), lfPitchAndFamily: s.ReadUChar(), alfFaceName: '',
          };
          let lfFaceName = '';
          for (let i = 0; i < LF_FACESIZE; ++i) {
            const nChar = s.ReadUInt16();
            if (!nChar) { s.SeekRel((LF_FACESIZE - i - 1) * 2); break; }
            lfFaceName += String.fromCharCode(nChar);
          }
          aLogFont.alfFaceName = lfFaceName;
          if (aLogFont.lfHeight !== -0x80000000 && aLogFont.lfWidth !== -0x80000000) this.CreateObjectIndexed(nIndex, new WinMtfFontStyle(aLogFont));
        }
        break;
      }

      case EMR_SMALLTEXTOUT: {
        const ptlReferenceX = s.ReadInt32(), ptlReferenceY = s.ReadInt32();
        const nLen = s.ReadUInt32(), nOptions = s.ReadUInt32(), nGfxMode = s.ReadUInt32();
        const fXScale = s.ReadFloat(), fYScale = s.ReadFloat();
        // Read optional bounding rectangle (present only if ETO_NO_RECT is NOT set)
        let aRect = new Rectangle();
        if (!(nOptions & ExtTextOutOptions.ETO_NO_RECT)) aRect = new Rectangle(s.ReadInt32(), s.ReadInt32(), s.ReadInt32(), s.ReadInt32());
        if (s.Tell() > nNextPos) { bStatus = false; break; }
        const mnBkModeBackup = this.mnBkMode;
        if (nOptions & ExtTextOutOptions.ETO_NO_RECT) this.mnBkMode = BackgroundMode.Transparent;
        else if (nOptions & ExtTextOutOptions.ETO_OPAQUE) this.DrawRectWithBGColor(aRect);
        const aPos = new Point(ptlReferenceX, ptlReferenceY);
        let aText = '';
        if (nOptions & ExtTextOutOptions.ETO_SMALL_CHARS) {
          if (nLen <= nNextPos - s.Tell()) aText = this.DecodeText(s.ReadBytes(nLen));
        } else if (nLen * 2 <= nNextPos - s.Tell()) aText = this.ReadUtf16(nLen);
        if (nOptions & ExtTextOutOptions.ETO_CLIPPED) { this.Push(); this.IntersectClipRect(aRect); }
        this.DrawText(aPos, aText, null, null, fXScale, fYScale, this.mbRecordPath, nGfxMode);
        if (nOptions & ExtTextOutOptions.ETO_CLIPPED) this.Pop();
        this.mnBkMode = mnBkModeBackup;
        break;
      }

      case EMR_POLYTEXTOUTA:
      case EMR_EXTTEXTOUTA:
      case EMR_POLYTEXTOUTW:
      case EMR_EXTTEXTOUTW: {
        bFlag = nRecType === EMR_POLYTEXTOUTA || nRecType === EMR_EXTTEXTOUTA;
        const nCurPos = s.Tell() - 8;
        s.SeekRel(16); // nLeft, nTop, nRight, nBottom
        const nGfxMode = s.ReadUInt32(), fXScale = s.ReadFloat(), fYScale = s.ReadFloat();
        if (nRecType === EMR_POLYTEXTOUTA || nRecType === EMR_POLYTEXTOUTW) {
          const ncStrings = s.ReadUInt32();
          if (ncStrings === 0) break;
        }
        const ptlReferenceX = s.ReadInt32(), ptlReferenceY = s.ReadInt32(), nLen = s.ReadUInt32(), nOffString = s.ReadUInt32(), nOptions = s.ReadUInt32();
        const aRect = new Rectangle(s.ReadInt32(), s.ReadInt32(), s.ReadInt32(), s.ReadInt32());
        const offDx = s.ReadUInt32();
        const mnBkModeBackup = this.mnBkMode;
        if (nOptions & ExtTextOutOptions.ETO_NO_RECT) this.mnBkMode = BackgroundMode.Transparent; // Don't draw the background rectangle and text background
        else if (nOptions & ExtTextOutOptions.ETO_OPAQUE) this.DrawRectWithBGColor(aRect);
        const aPos = new Point(ptlReferenceX, ptlReferenceY);
        const bOffStringSane = nOffString <= nNextPos - nCurPos;
        if (bOffStringSane) {
          s.Seek(nCurPos + nOffString);
          let aText = '';
          if (bFlag) {
            if (nLen <= nNextPos - s.Tell()) aText = this.DecodeText(s.ReadBytes(nLen));
          } else if (nLen * 2 <= nNextPos - s.Tell()) aText = this.ReadUtf16(nLen);

          let aDXAry: number[] | null = null;
          let pDYAry: number[] | null = null;
          // Reading OutputDx
          // ETO_PDY flag indicates that we should read twice values
          // compared to the number of characters in the output string.
          const nBytesEach = nOptions & ExtTextOutOptions.ETO_PDY ? 8 : 4;
          const nDxSize = nLen * nBytesEach;
          if (offDx && nCurPos + offDx + nDxSize <= nNextPos && nNextPos <= this.mnEndPos) {
            s.Seek(nCurPos + offDx);
            aDXAry = [];
            if (nOptions & ExtTextOutOptions.ETO_PDY) pDYAry = [];
            for (let i = 0; i < aText.length; ++i) {
              let nDxCount = 1;
              // a character of a multi-byte encoding has a DX value per byte
              if (aText.length !== nLen && aText.charCodeAt(i) > 0x7f) nDxCount = 2;
              aDXAry[i] = 0;
              if (pDYAry) pDYAry[i] = 0;
              while (nDxCount--) {
                aDXAry[i]! += s.ReadInt32();
                if (pDYAry) pDYAry[i]! += s.ReadInt32();
              }
            }
          }
          if (nOptions & ExtTextOutOptions.ETO_CLIPPED) {
            this.Push(); // Save the current clip. It will be restored after text drawing
            this.IntersectClipRect(aRect);
          }
          this.DrawText(aPos, aText, aDXAry && aDXAry.length ? aDXAry : null, pDYAry, fXScale, fYScale, this.mbRecordPath, nGfxMode);
          if (nOptions & ExtTextOutOptions.ETO_CLIPPED) this.Pop();
        }
        this.mnBkMode = mnBkModeBackup;
        break;
      }

      case EMR_POLYBEZIERTO16: this.DrawPolyBezier(this.ReadPolygonWithSkip(true, true, nNextPos), true, this.mbRecordPath); break;
      case EMR_POLYBEZIER16: this.DrawPolyBezier(this.ReadPolygonWithSkip(true, false, nNextPos), false, this.mbRecordPath); break;
      case EMR_POLYGON16: this.DrawPolygon(this.ReadPolygonWithSkip(true, false, nNextPos), this.mbRecordPath); break;
      case EMR_POLYLINETO16: this.DrawPolyLine(this.ReadPolygonWithSkip(true, true, nNextPos), true, this.mbRecordPath); break;
      case EMR_POLYLINE16: this.DrawPolyLine(this.ReadPolygonWithSkip(true, false, nNextPos), false, this.mbRecordPath); break;
      case EMR_POLYPOLYLINE16: this.ReadAndDrawPolyLine(true, nNextPos); break;
      case EMR_POLYPOLYGON16: this.ReadAndDrawPolyPolygon(true, nNextPos); break;

      case EMR_FILLRGN: {
        let nRemainingRecSize = nRecSize - 8;
        if (nRemainingRecSize < 24) { bStatus = false; break; }
        s.SeekRel(16); // RectL bounds
        s.ReadUInt32(); // nRgnDataSize
        const nIndex = s.ReadUInt32();
        nRemainingRecSize -= 24;
        const aPolyPoly = ImplReadRegion(s, nRemainingRecSize, this.GetWinOrg());
        if (aPolyPoly) {
          this.Push();
          this.SelectObject(nIndex);
          this.DrawPolyPolygon(aPolyPoly);
          this.Pop();
        }
        break;
      }
      case EMR_PAINTRGN: {
        let nRemainingRecSize = nRecSize - 8;
        if (nRemainingRecSize < 20) { bStatus = false; break; }
        s.SeekRel(16); // Skipping RectL bounds
        s.ReadUInt32(); // nRgnDataSize
        nRemainingRecSize -= 20;
        const aPolyPoly = ImplReadRegion(s, nRemainingRecSize, this.GetWinOrg());
        if (aPolyPoly) this.DrawPolyPolygon(aPolyPoly);
        break;
      }
      case EMR_CREATEDIBPATTERNBRUSHPT: {
        const nIndex = s.ReadUInt32();
        // The pattern bitmap is not read: the brush fills with black.
        if ((nIndex & ENHMETA_STOCK_OBJECT) === 0) this.CreateObjectIndexed(nIndex, new WinMtfFillStyle('#000000', false, { width: 0, height: 0, href: '' }));
        break;
      }

      case EMR_COMMENT: // EMF+ and GDI comments are not read
      case EMR_HEADER: // has already been read at ReadHeader()
      default: // EMR_MASKBLT, EMR_PLGBLT, EMR_SETDIBITSTODEVICE, EMR_GRADIENTFILL … are not implemented, as upstream
        break;
    }
    return bStatus;
  }

  /** read_uInt16s_ToOUString */
  private ReadUtf16(nLen: number): string {
    let s = '';
    for (let i = 0; i < nLen; i++) s += String.fromCharCode(this.mpInputStream.ReadUInt16());
    return s;
  }

  ReadHeader(): boolean {
    const s = this.mpInputStream;
    // Spare me the METAFILEHEADER here
    // Reading the METAHEADER - EMR_HEADER ([MS-EMF] section 2.3.4.2 EMR_HEADER Record Types)
    const nType = s.ReadUInt32(), nHeaderSize = s.ReadUInt32();
    // per [MS-EMF] 2.3.4.2 EMF Header Record Types, type MUST be 0x00000001
    if (nType !== 0x00000001) return false;
    // Start reading the EMR_HEADER Header object
    // bound size (RectL object, see [MS-WMF] section 2.2.2.19)
    const rclBounds = this.ReadRectangle(); // rectangle in logical units
    // picture frame size (RectL object)
    const rclFrame = this.ReadRectangle(); // rectangle in device units 1/100th mm
    const nSignature = s.ReadUInt32();
    // nSignature MUST be the ASCII characters "FME", see [WS-EMF] 2.2.9 Header Object
    // and 2.1.14 FormatSignature Enumeration
    if (nSignature !== 0x464d4520) return false;
    s.ReadUInt32(); // nVersion: according to [WS-EMF] 2.2.9, this SHOULD be 0x0001000
    this.mnEndPos = s.ReadUInt32(); // size of metafile
    this.mnEndPos += this.mnStartPos;
    const nActualFileSize = s.TellEnd();
    if (nActualFileSize < this.mnEndPos) this.mnEndPos = nActualFileSize; // Possible file corruption?
    this.mnRecordCount = s.ReadUInt32();
    // the number of "handles", or graphics objects used in the metafile
    s.ReadUInt16(); // nHandlesCount
    // the next 2 bytes are reserved, but according to [MS-EMF] section 2.2.9
    // it MUST be 0x000 and MUST be ignored
    s.ReadUInt16();
    // The next 4 bytes specifies the number of characters in the metafile description.
    // The 4 bytes after that specific the offset from this record that contains the
    // metafile description... zero means no description string.
    // For now, we ignore it.
    s.SeekRel(0x8);
    s.ReadUInt32(); // nPalEntries
    const nPixX = s.ReadInt32(), nPixY = s.ReadInt32(), nMillX = s.ReadInt32(), nMillY = s.ReadInt32();
    this.SetrclFrame(rclFrame);
    this.SetrclBounds(rclBounds);
    this.SetRefPix(new Size(nPixX, nPixY));
    this.SetRefMill(new Size(nMillX, nMillY));
    const nTarget = this.mnStartPos + nHeaderSize;
    if (nTarget > s.TellEnd()) return false;
    s.Seek(nTarget);
    return true;
  }

  private ReadRectangle(): Rectangle {
    const s = this.mpInputStream;
    const nLeft = s.ReadInt32(), nTop = s.ReadInt32(), nRight = s.ReadInt32(), nBottom = s.ReadInt32();
    if (nLeft > nRight || nTop > nBottom) return Rectangle.Normalize(new Point(nLeft, nTop), new Point(nRight, nBottom));
    return new Rectangle(nLeft, nTop, nRight, nBottom);
  }

  private ReadRectangle4(x1: number, y1: number, x2: number, y2: number): Rectangle {
    return new Rectangle(x1, y1, x2 - 1, y2 - 1);
  }
}

