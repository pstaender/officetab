// SPDX-License-Identifier: MPL-2.0
// @upstream emfio/source/reader/wmfreader.cxx reduced
// WmfReader: reads a Windows Metafile (with or without the placeable header) into a GDIMetaFile:
// the header and bounds (ReadHeader, GetPlaceableBound), then every record through MtfTools.
//
// Reduced: an external header (WmfExternal, from an OLE object) is not supported; the private
// Unicode text escape is skipped (its records' polygons are drawn instead, as upstream does
// when the font is missing); DIBCREATEPATTERNBRUSH fills with black instead of the bitmap's
// average colour; regions (CREATEREGION, SELECTCLIPREGION) are not read, as upstream; text of a
// multi-byte character set takes two DX values for any non-ASCII character.

import { Point, Rectangle, Size } from '../../../tools/source/generic/gen.ts';
import { Polygon, PolyPolygon } from '../../../tools/source/generic/poly.ts';
import { SvStream } from '../../../tools/source/stream/stream.ts';
import { GDIMetaFile } from '../../../vcl/source/gdi/gdimtf.ts';
import { CreateFromData, GetDIBBitCount, ReadDIB } from '../../../vcl/source/bitmap/dibtools.ts';
import {
  BrushStyle, CharacterSet, ExtTextOutOptions, MappingMode, MtfTools, RegionMode, WinMtfFillStyle, WinMtfFontStyle, WinMtfLineStyle,
  WinMtfPalette, RGB, type LOGFONTW,
} from './mtftools.ts';
import { EmfReader } from './emfreader.ts';

// MS Windows defines
const W_META_EOF = 0x0000, W_META_SETBKCOLOR = 0x0201, W_META_SETBKMODE = 0x0102, W_META_SETMAPMODE = 0x0103, W_META_SETROP2 = 0x0104,
  W_META_SETTEXTCOLOR = 0x0209, W_META_SETWINDOWORG = 0x020b, W_META_SETWINDOWEXT = 0x020c,
  W_META_SETVIEWPORTORG = 0x020d, W_META_SETVIEWPORTEXT = 0x020e, W_META_OFFSETWINDOWORG = 0x020f, W_META_SCALEWINDOWEXT = 0x0410,
  W_META_OFFSETVIEWPORTORG = 0x0211, W_META_SCALEVIEWPORTEXT = 0x0412, W_META_LINETO = 0x0213, W_META_MOVETO = 0x0214,
  W_META_EXCLUDECLIPRECT = 0x0415, W_META_INTERSECTCLIPRECT = 0x0416, W_META_ARC = 0x0817, W_META_ELLIPSE = 0x0418, W_META_PIE = 0x081a,
  W_META_RECTANGLE = 0x041b, W_META_ROUNDRECT = 0x061c, W_META_PATBLT = 0x061d, W_META_SAVEDC = 0x001e, W_META_SETPIXEL = 0x041f,
  W_META_OFFSETCLIPRGN = 0x0220, W_META_TEXTOUT = 0x0521, W_META_BITBLT = 0x0922, W_META_STRETCHBLT = 0x0b23, W_META_POLYGON = 0x0324,
  W_META_POLYLINE = 0x0325, W_META_ESCAPE = 0x0626, W_META_RESTOREDC = 0x0127, W_META_SELECTCLIPREGION = 0x012c,
  W_META_SELECTOBJECT = 0x012d, W_META_SETTEXTALIGN = 0x012e, W_META_CHORD = 0x0830, W_META_EXTTEXTOUT = 0x0a32,
  W_META_SELECTPALETTE = 0x0234, W_META_POLYPOLYGON = 0x0538, W_META_DIBBITBLT = 0x0940, W_META_DIBSTRETCHBLT = 0x0b41,
  W_META_DIBCREATEPATTERNBRUSH = 0x0142, W_META_STRETCHDIB = 0x0f43, W_META_DELETEOBJECT = 0x01f0, W_META_CREATEPALETTE = 0x00f7,
  W_META_CREATEBRUSH = 0x00f8, W_META_CREATEPATTERNBRUSH = 0x01f9, W_META_CREATEPENINDIRECT = 0x02fa, W_META_CREATEFONTINDIRECT = 0x02fb,
  W_META_CREATEBRUSHINDIRECT = 0x02fc, W_META_CREATEBITMAPINDIRECT = 0x02fd, W_META_CREATEBITMAP = 0x06fe, W_META_CREATEREGION = 0x06ff;
const W_MFCOMMENT = 15;
const LF_FACESIZE = 32;

const RECT_MAX = 0x7fffffff, RECT_MIN = -0x7fffffff;

function GetWinExtMax(rSource: Point | Rectangle, rPlaceableBound: Rectangle, eMapMode: number): void {
  if (rSource instanceof Rectangle) {
    GetWinExtMax(rSource.TopLeft(), rPlaceableBound, eMapMode);
    GetWinExtMax(rSource.BottomRight(), rPlaceableBound, eMapMode);
    return;
  }
  const aSource = rSource.clone();
  if (eMapMode === MappingMode.MM_HIMETRIC) aSource.setY(-rSource.Y());
  if (aSource.X() < rPlaceableBound.mnLeft) rPlaceableBound.mnLeft = aSource.X();
  if (aSource.X() > rPlaceableBound.mnRight) rPlaceableBound.mnRight = aSource.X();
  if (aSource.Y() < rPlaceableBound.mnTop) rPlaceableBound.mnTop = aSource.Y();
  if (aSource.Y() > rPlaceableBound.mnBottom) rPlaceableBound.mnBottom = aSource.Y();
}

const aMaxWidth = 1024;

export class WmfReader extends MtfTools {
  private mnUnitsPerInch = 96;
  private mnRecSize = 0;
  private mbPlaceable = false;
  // embedded EMF data
  private mpEMFStream: number[][] | null = null;
  // total number of comment records containing EMF data
  private mnEMFRecCount = 0;
  // number of EMF records read
  private mnEMFRec = 0;
  // total size of embedded EMF data
  private mnEMFSize = 0;
  private mnSkipActions = 0;
  private mbError = false;

  constructor(rStreamWMF: SvStream, rGDIMetaFile: GDIMetaFile) {
    super(rGDIMetaFile, rStreamWMF);
  }

  private ReadPoint(): Point {
    const nX = this.mpInputStream.ReadInt16(), nY = this.mpInputStream.ReadInt16();
    return new Point(nX, nY);
  }

  private ReadYX(): Point {
    const nY = this.mpInputStream.ReadInt16(), nX = this.mpInputStream.ReadInt16();
    return new Point(nX, nY);
  }

  private ReadRectangle(): Rectangle {
    const aBR = this.ReadYX();
    const aTL = this.ReadYX();
    aBR.AdjustX(-1);
    aBR.AdjustY(-1);
    if (aTL.X() > aBR.X() || aTL.Y() > aBR.Y()) return Rectangle.Normalize(aTL, aBR); // broken rectangle
    return new Rectangle(aTL.X(), aTL.Y(), aBR.X(), aBR.Y());
  }

  private ReadYXExt(): Size {
    const nH = this.mpInputStream.ReadInt16(), nW = this.mpInputStream.ReadInt16();
    return new Size(nW, nH);
  }

  private ReadRecordParams(nRecordSize: number, nFunc: number): void {
    let bRecordOk = true;
    const s = this.mpInputStream;
    switch (nFunc) {
      case W_META_SETBKCOLOR:
        if (nRecordSize !== 5) bRecordOk = false;
        this.SetBkColor(this.ReadColor());
        break;

      case W_META_SETBKMODE:
        // It could have Reserved values. Both 4 and 5 sizes are allowed
        if (nRecordSize !== 4 && nRecordSize !== 5) bRecordOk = false;
        this.SetBkMode(s.ReadUInt16());
        break;

      case W_META_SETMAPMODE:
        if (nRecordSize !== 4) bRecordOk = false;
        this.SetMapMode(s.ReadUInt16());
        break;

      case W_META_SETROP2:
        // It could have Reserved values. Both 4 and 5 sizes are allowed
        if (nRecordSize !== 4 && nRecordSize !== 5) bRecordOk = false;
        this.SetRasterOp(s.ReadUInt16());
        break;

      case W_META_SETTEXTCOLOR:
        if (nRecordSize !== 5) bRecordOk = false;
        this.SetTextColor(this.ReadColor());
        break;

      case W_META_SETWINDOWORG:
        if (nRecordSize !== 5) bRecordOk = false;
        this.SetWinOrg(this.ReadYX());
        break;

      case W_META_SETWINDOWEXT: {
        if (nRecordSize !== 5) bRecordOk = false;
        const nHeight = s.ReadInt16(), nWidth = s.ReadInt16();
        this.SetWinExt(new Size(nWidth, nHeight));
        break;
      }

      case W_META_OFFSETWINDOWORG: {
        if (nRecordSize !== 5) bRecordOk = false;
        const nYAdd = s.ReadInt16(), nXAdd = s.ReadInt16();
        this.SetWinOrgOffset(nXAdd, nYAdd);
        break;
      }

      case W_META_SCALEWINDOWEXT: {
        if (nRecordSize !== 7) bRecordOk = false;
        const nYDenom = s.ReadInt16(), nYNum = s.ReadInt16(), nXDenom = s.ReadInt16(), nXNum = s.ReadInt16();
        if (!nYDenom || !nXDenom) { this.mbError = true; break; }
        this.ScaleWinExt(nXNum / nXDenom, nYNum / nYDenom);
        break;
      }

      case W_META_SETVIEWPORTORG:
      case W_META_SETVIEWPORTEXT:
        if (nRecordSize !== 5) bRecordOk = false;
        break;

      case W_META_OFFSETVIEWPORTORG: {
        if (nRecordSize !== 5) bRecordOk = false;
        const nYAdd = s.ReadInt16(), nXAdd = s.ReadInt16();
        this.SetDevOrgOffset(nXAdd, nYAdd);
        break;
      }

      case W_META_SCALEVIEWPORTEXT: {
        if (nRecordSize !== 7) bRecordOk = false;
        const nYDenom = s.ReadInt16(), nYNum = s.ReadInt16(), nXDenom = s.ReadInt16(), nXNum = s.ReadInt16();
        if (!nYDenom || !nXDenom) { this.mbError = true; break; }
        this.ScaleDevExt(nXNum / nXDenom, nYNum / nYDenom);
        break;
      }

      case W_META_LINETO:
        if (nRecordSize !== 5) bRecordOk = false;
        this.LineTo(this.ReadYX());
        break;

      case W_META_MOVETO:
        if (nRecordSize !== 5) bRecordOk = false;
        this.MoveTo(this.ReadYX());
        break;

      case W_META_INTERSECTCLIPRECT:
        if (nRecordSize !== 7) bRecordOk = false;
        this.IntersectClipRect(this.ReadRectangle());
        break;

      case W_META_RECTANGLE:
        if (nRecordSize !== 7) bRecordOk = false;
        this.DrawRect(this.ReadRectangle());
        break;

      case W_META_ROUNDRECT: {
        if (nRecordSize !== 9) bRecordOk = false;
        const aSize = this.ReadYXExt();
        this.DrawRoundRect(this.ReadRectangle(), new Size(Math.trunc(aSize.Width() / 2), Math.trunc(aSize.Height() / 2)));
        break;
      }

      case W_META_ELLIPSE:
        if (nRecordSize !== 7) bRecordOk = false;
        this.DrawEllipse(this.ReadRectangle());
        break;

      case W_META_ARC: {
        if (nRecordSize !== 11) bRecordOk = false;
        const aEnd = this.ReadYX();
        const aStart = this.ReadYX();
        const aRect = this.ReadRectangle();
        aRect.Normalize();
        this.DrawArc(aRect, aStart, aEnd);
        break;
      }

      case W_META_PIE: {
        if (nRecordSize !== 11) bRecordOk = false;
        const aEnd = this.ReadYX();
        const aStart = this.ReadYX();
        const aRect = this.ReadRectangle();
        aRect.Normalize();
        // #i73608# OutputDevice deviates from WMF
        // semantics. start==end means full ellipse here.
        if (aStart.equals(aEnd)) this.DrawEllipse(aRect);
        else this.DrawPie(aRect, aStart, aEnd);
        break;
      }

      case W_META_CHORD: {
        if (nRecordSize !== 11) bRecordOk = false;
        const aEnd = this.ReadYX();
        const aStart = this.ReadYX();
        const aRect = this.ReadRectangle();
        aRect.Normalize();
        this.DrawChord(aRect, aStart, aEnd);
        break;
      }

      case W_META_POLYGON: {
        const nPoints = s.ReadUInt16();
        if (nPoints > s.remainingSize() / 4) bRecordOk = false;
        else {
          const aPoly = new Polygon();
          for (let i = 0; i < nPoints; ++i) aPoly.mxPointAry.push(this.ReadPoint());
          this.DrawPolygon(aPoly, false/*bRecordPath*/);
        }
        break;
      }

      case W_META_POLYPOLYGON: {
        // Number of polygons:
        const nPolyCount = s.ReadUInt16();
        if (nPolyCount) {
          if (nPolyCount > s.remainingSize() / 2) break;
          // Number of points of each polygon. Determine total number of points
          const pnPoints: number[] = [];
          let nPoints = 0;
          for (let a = 0; a < nPolyCount; ++a) {
            pnPoints[a] = s.ReadUInt16();
            if (pnPoints[a]! > 0xffff - nPoints) { bRecordOk = false; break; }
            nPoints += pnPoints[a]!;
          }
          if (!bRecordOk) break;
          const aPolyPoly = new PolyPolygon();
          // Polygon points are:
          for (let a = 0; a < nPolyCount; ++a) {
            const nPointCount = pnPoints[a]!;
            if (nPointCount > s.remainingSize() / 4) { bRecordOk = false; break; }
            const aPoly = new Polygon();
            for (let b = 0; b < nPointCount; ++b) aPoly.mxPointAry.push(this.ReadPoint());
            aPolyPoly.Insert(aPoly);
          }
          if (!bRecordOk) break;
          this.DrawPolyPolygon(aPolyPoly);
        }
        break;
      }

      case W_META_POLYLINE: {
        const nPoints = s.ReadUInt16();
        if (nPoints > s.remainingSize() / 4) bRecordOk = false;
        else {
          const aPoly = new Polygon();
          for (let i = 0; i < nPoints; ++i) aPoly.mxPointAry.push(this.ReadPoint());
          this.DrawPolyLine(aPoly);
        }
        break;
      }

      case W_META_SAVEDC:
        if (nRecordSize !== 3) bRecordOk = false;
        this.Push();
        break;

      case W_META_RESTOREDC: {
        if (nRecordSize !== 4) bRecordOk = false;
        const nSavedDC = s.ReadInt16();
        this.Pop(nSavedDC);
        break;
      }

      case W_META_SETPIXEL: {
        if (nRecordSize !== 7) bRecordOk = false;
        const aColor = this.ReadColor();
        this.DrawPixel(this.ReadYX(), aColor);
        break;
      }

      case W_META_OFFSETCLIPRGN:
        if (nRecordSize !== 5) bRecordOk = false;
        this.MoveClipRegion(this.ReadYXExt());
        break;

      case W_META_TEXTOUT: {
        //record is Recordsize, RecordFunction, StringLength, <String>, YStart, XStart
        const nNonStringLen = 4 + 4 * 2;
        const nRecSize = nRecordSize * 2;
        if (nRecSize < nNonStringLen) { bRecordOk = false; break; }
        let nLength = s.ReadUInt16();
        let nStoredLength = (nLength + 1) & ~1;
        if (nRecSize - nNonStringLen < nStoredLength) {
          // W_META_TEXTOUT too short, truncating string
          nLength = nStoredLength = nRecSize - nNonStringLen;
        }
        if (nLength) {
          const aChars = s.ReadBytes(nStoredLength);
          nLength = Math.min(nLength, aChars.length);
          const aText = this.DecodeText(aChars.subarray(0, nLength));
          const aPosition = this.ReadYX();
          this.DrawText(aPosition, aText);
        }
        break;
      }

      case W_META_EXTTEXTOUT: {
        //record is Recordsize, RecordFunction, Y, X, StringLength, options, maybe rectangle, <String>
        let nNonStringLen = 4 + 5 * 2;
        const nRecSize = nRecordSize * 2;
        if (nRecSize < nNonStringLen) { bRecordOk = false; break; }
        const nRecordPos = s.Tell() - 6;
        const aPosition = this.ReadYX();
        const nLen = s.ReadUInt16(), nOptions = s.ReadUInt16();
        let aRect = new Rectangle();
        if (nOptions & ExtTextOutOptions.ETO_CLIPPED || nOptions & ExtTextOutOptions.ETO_OPAQUE) {
          nNonStringLen += 2 * 2;
          if (nRecSize < nNonStringLen) { bRecordOk = false; break; }
          const aTopLeft = this.ReadPoint();
          const aBottomRight = this.ReadPoint();
          aRect = new Rectangle(aTopLeft.X(), aTopLeft.Y(), aBottomRight.X(), aBottomRight.Y());
          if (nOptions & ExtTextOutOptions.ETO_OPAQUE) this.DrawRectWithBGColor(aRect);
        }
        // output only makes sense if the text contains characters
        if (nLen) {
          let nOriginalTextLen = nLen;
          let nOriginalBlockLen = (nOriginalTextLen + 1) & ~1;
          const nMaxStreamPos = nRecordPos + nRecSize;
          const nRemainingSize = Math.min(s.remainingSize(), nMaxStreamPos - s.Tell());
          if (nRemainingSize < nOriginalBlockLen) {
            // exttextout record claimed more data than the stream can provide
            nOriginalTextLen = nOriginalBlockLen = nRemainingSize;
          }
          const pChar = s.ReadBytes(nOriginalBlockLen);
          const aText = this.DecodeText(pChar.subarray(0, nOriginalTextLen)); // after this conversion the text may contain
          const nNewTextLen = aText.length; // less character (japanese version), so the dxAry will not fit
          if (nNewTextLen) {
            if (nOptions & ExtTextOutOptions.ETO_CLIPPED) {
              this.Push(); // Save the current clip. It will be restored after text drawing
              this.IntersectClipRect(aRect);
            }
            const aDXAry: number[] = [];
            let pDYAry: number[] | null = null;
            const nDxArySize = nMaxStreamPos - s.Tell();
            const nDxAryEntries = nDxArySize >> 1;
            let bUseDXAry = false;
            if (nDxAryEntries % nOriginalTextLen === 0 && nNewTextLen <= nOriginalTextLen) {
              if (nOptions & ExtTextOutOptions.ETO_PDY) pDYAry = [];
              let i: number; // needed just outside the for
              for (i = 0; i < nNewTextLen; i++) {
                if (s.Tell() >= nMaxStreamPos) break;
                let nDxCount = 1;
                if (nNewTextLen !== nOriginalTextLen) {
                  // a character of a multi-byte encoding has a DX value per byte
                  const c = aText.charCodeAt(i);
                  if (c > 0x7f) nDxCount = 2;
                }
                let nDx = 0, nDy = 0;
                while (nDxCount--) {
                  if (s.Tell() + 2 > nMaxStreamPos) break;
                  nDx += s.ReadInt16();
                  if (nOptions & ExtTextOutOptions.ETO_PDY) {
                    if (s.Tell() + 2 > nMaxStreamPos) break;
                    nDy += s.ReadInt16();
                  }
                }
                aDXAry[i] = nDx;
                if (pDYAry) pDYAry[i] = nDy;
              }
              if (i === nNewTextLen) bUseDXAry = true;
            }
            if (bUseDXAry) this.DrawText(aPosition, aText, aDXAry, pDYAry);
            else this.DrawText(aPosition, aText);
            if (nOptions & ExtTextOutOptions.ETO_CLIPPED) this.Pop();
          }
        }
        break;
      }

      case W_META_SELECTOBJECT:
      case W_META_SELECTPALETTE:
        if (nRecordSize !== 4) bRecordOk = false;
        this.SelectObject(s.ReadUInt16());
        break;

      case W_META_SETTEXTALIGN:
        // It could have Reserved values. Both 4 and 5 sizes are allowed
        if (nRecordSize !== 4 && nRecordSize !== 5) bRecordOk = false;
        this.SetTextAlign(s.ReadUInt16());
        break;

      case W_META_BITBLT:
      case W_META_STRETCHBLT: {
        const bNoSourceBitmap = nRecordSize === (nFunc >> 8) + 3;
        const nRasterOperation = s.ReadUInt32();
        if (nFunc === W_META_STRETCHBLT) {
          if (nRecordSize < 18) bRecordOk = false;
          s.ReadInt16(); s.ReadInt16(); // nSrcHeight, nSrcWidth
        } else if (nRecordSize < 16) bRecordOk = false;
        const nYSrc = s.ReadInt16(), nXSrc = s.ReadInt16();
        if (bNoSourceBitmap) s.SeekRel(2); // Skip Reserved 2 bytes (it must be ignored)
        const nSye = s.ReadInt16(), nSxe = s.ReadInt16();
        const aPoint = this.ReadYX(); // The upper-left corner of the destination rectangle.
        s.ReadInt16(); // nBitmapType
        const nWidth = s.ReadInt16(), nHeight = s.ReadInt16(), nBytesPerScan = s.ReadInt16(), nPlanes = s.ReadUChar(), nBitCount = s.ReadUChar();
        if (bNoSourceBitmap || nBitCount === 4 || nBitCount === 8 || nPlanes !== 1) break; // TODO The unsupported Bitmap record. Please fill a bug.
        let bOk = nWidth > 0 && nHeight > 0 && nBytesPerScan > 0 && (nBitCount === 1 || nBitCount === 24 || nBitCount === 32);
        // must be enough data to fulfil the request
        if (bOk) bOk = nBytesPerScan <= s.remainingSize() / nHeight;
        // scanline must be large enough to provide all pixels
        if (bOk) bOk = nBytesPerScan >= (nWidth * nBitCount) / 8;
        if (bOk) {
          const pData = s.ReadBytes(nHeight * nBytesPerScan);
          let aBitmap = CreateFromData(pData, nWidth, nHeight, nBytesPerScan, nBitCount);
          if (!aBitmap) break;
          if (nSye && nSxe && nXSrc + nSxe <= nWidth && nYSrc + nSye <= nHeight) aBitmap = { ...aBitmap, crop: { x: nXSrc, y: nYSrc, width: nSxe, height: nSye } };
          const aDestRect = Rectangle.FromPointSize(aPoint, new Size(nSxe, nSye));
          this.maBmpSaveList.push({ aBmp: aBitmap, aOutRect: aDestRect, nWinRop: nRasterOperation });
        }
        break;
      }

      case W_META_DIBBITBLT:
      case W_META_DIBSTRETCHBLT:
      case W_META_STRETCHDIB: {
        let nSrcHeight = 0, nSrcWidth = 0;
        const bNoSourceBitmap = nFunc !== W_META_STRETCHDIB && nRecordSize === (nFunc >> 8) + 3;
        if (nRecordSize < 12) bRecordOk = false;
        const nRasterOperation = s.ReadUInt32();
        if (nFunc === W_META_STRETCHDIB) {
          if (nRecordSize < 15) bRecordOk = false;
          s.ReadUInt16(); // nColorUsage
        }
        // nSrcHeight and nSrcWidth is the number of pixels that has to been used
        // If they are set to zero, it is as indicator not to scale the bitmap later
        if (nFunc === W_META_DIBSTRETCHBLT || nFunc === W_META_STRETCHDIB) { nSrcHeight = s.ReadInt16(); nSrcWidth = s.ReadInt16(); }
        // nYSrc and nXSrc is the offset of the first pixel
        const nYSrc = s.ReadInt16(), nXSrc = s.ReadInt16();
        if (bNoSourceBitmap) s.SeekRel(2); // Skip Reserved 2 bytes (it must be ignored)
        const aDestSize = this.ReadYXExt();
        if (aDestSize.Width() && aDestSize.Height()) { // #92623# do not try to read buggy bitmaps
          const aDestRect = Rectangle.FromPointSize(this.ReadYX(), aDestSize);
          let aBmp = null;
          if (!bNoSourceBitmap) {
            // tdf#142625 Read the DIBHeader and check if bitmap is supported
            const aDIB = s.ReadBytes(this.mnRecPos + nRecordSize * 2 - s.Tell());
            if (GetDIBBitCount(aDIB) === 0) break; // TODO Undefined BitCount (JPEG/PNG), which are not supported
            aBmp = ReadDIB(aDIB);
          }
          // An empty bitmap when there is no source bitmap (or it could not be read).
          if (!aBmp) aBmp = { width: 0, height: 0, href: '' };
          // test if it is sensible to crop
          if (nSrcHeight && nSrcWidth && nXSrc + nSrcWidth <= aBmp.width && nYSrc + nSrcHeight <= aBmp.height) {
            aBmp = { ...aBmp, crop: { x: nXSrc, y: nYSrc, width: nSrcWidth, height: nSrcHeight } };
          }
          this.maBmpSaveList.push({ aBmp, aOutRect: aDestRect, nWinRop: nRasterOperation });
        }
        break;
      }

      case W_META_DIBCREATEPATTERNBRUSH: {
        if (nRecordSize < 5) bRecordOk = false;
        const nStyle = s.ReadUInt16();
        s.ReadUInt16(); // nColorUsage
        if (nStyle === BrushStyle.BS_PATTERN) { // TODO tdf#142625 Add support for pattern
          this.CreateObject();
          break;
        }
        // The bitmap's average colour is not computed (the pixels are not decoded): black.
        this.CreateObject(new WinMtfFillStyle('#000000', false));
        break;
      }

      case W_META_DELETEOBJECT:
        if (nRecordSize !== 4) bRecordOk = false;
        this.DeleteObject(s.ReadUInt16());
        break;

      case W_META_CREATEPALETTE: {
        s.ReadUInt16(); // nStart
        const nNumberOfEntries = s.ReadUInt16();
        if (nRecordSize !== 2 * nNumberOfEntries + 5) bRecordOk = false;
        const aPaletteColors: string[] = [];
        for (let i = 0; i < nNumberOfEntries; ++i) {
          //PALETTEENTRY: Values, Blue, Green, Red
          const nPalleteEntry = s.ReadUInt32();
          aPaletteColors.push(RGB(nPalleteEntry & 0xff, (nPalleteEntry >> 8) & 0xff, (nPalleteEntry >> 16) & 0xff));
        }
        this.CreateObject(new WinMtfPalette(aPaletteColors));
        break;
      }

      case W_META_CREATEBRUSH:
      case W_META_CREATEPATTERNBRUSH:
        // TODO: Not implemented. Please fill the bug report
        this.CreateObject(new WinMtfFillStyle('#ffffff', false));
        break;

      case W_META_CREATEPENINDIRECT: {
        // FIXME For some WMF correct size is 8 and for some 9
        if (nRecordSize !== 8 && nRecordSize !== 9) bRecordOk = false;
        const nStyle = s.ReadUInt16();
        const nWidth = s.ReadUInt16();
        s.ReadUInt16(); // nHeight
        this.CreateObject(new WinMtfLineStyle(this.ReadColor(), nStyle, nWidth));
        break;
      }

      case W_META_CREATEBRUSHINDIRECT: {
        if (nRecordSize !== 7) bRecordOk = false;
        const nBrushStyle = s.ReadUInt16();
        this.CreateObject(new WinMtfFillStyle(this.ReadColor(), nBrushStyle === BrushStyle.BS_NULL));
        break;
      }

      case W_META_CREATEFONTINDIRECT: {
        const aFontSize = this.ReadYXExt();
        const lfEscapement = s.ReadInt16(), lfOrientation = s.ReadInt16(), lfWeight = s.ReadInt16();
        const aLogFont: LOGFONTW = {
          lfHeight: aFontSize.Height(), lfWidth: aFontSize.Width(), lfEscapement, lfOrientation, lfWeight,
          lfItalic: s.ReadUChar(), lfUnderline: s.ReadUChar(), lfStrikeOut: s.ReadUChar(), lfCharSet: s.ReadUChar(), lfOutPrecision: s.ReadUChar(),
          lfClipPrecision: s.ReadUChar(), lfQuality: s.ReadUChar(), lfPitchAndFamily: s.ReadUChar(), alfFaceName: '',
        };
        const lfFaceName = s.ReadBytes(LF_FACESIZE);
        const nLength = lfFaceName.indexOf(0) < 0 ? lfFaceName.length : lfFaceName.indexOf(0);
        const eCharSet = aLogFont.lfCharSet === CharacterSet.OEM_CHARSET || aLogFont.lfCharSet === CharacterSet.DEFAULT_CHARSET || aLogFont.lfCharSet === CharacterSet.SYMBOL_CHARSET ? 0 : aLogFont.lfCharSet;
        const saved = this.mnFontCharSet;
        this.mnFontCharSet = eCharSet;
        aLogFont.alfFaceName = this.DecodeText(lfFaceName.subarray(0, nLength));
        this.mnFontCharSet = saved;
        if (nRecordSize < 12 || nRecordSize > 28) bRecordOk = false;
        else this.CreateObject(new WinMtfFontStyle(aLogFont));
        break;
      }

      case W_META_CREATEBITMAPINDIRECT:
      case W_META_CREATEBITMAP:
      case W_META_CREATEREGION:
        // TODO: not implemented. Please fill the bug report
        this.CreateObject();
        break;

      case W_META_EXCLUDECLIPRECT:
        if (nRecordSize !== 7) bRecordOk = false;
        this.ExcludeClipRect(this.ReadRectangle());
        break;

      case W_META_PATBLT: {
        if (nRecordSize !== 9) bRecordOk = false;
        const nROP = s.ReadUInt32();
        const aSize = this.ReadYXExt();
        const nOldROP = this.SetRasterOp(nROP);
        this.DrawRect(Rectangle.FromPointSize(this.ReadYX(), aSize), false);
        this.SetRasterOp(nOldROP);
        break;
      }

      case W_META_SELECTCLIPREGION: {
        if (nRecordSize !== 4) bRecordOk = false;
        const nObjIndex = s.ReadUInt16();
        // TODO: W_META_SELECTCLIPREGION is not implemented. Please fill the bug report
        if (!nObjIndex) this.SetClipPath(new PolyPolygon(), RegionMode.RGN_COPY, true);
        break;
      }

      case W_META_ESCAPE: {
        const nMetaRecSize = (nRecordSize - 2) * 2;
        const nMetaRecEndPos = s.Tell() + nMetaRecSize;
        // taking care that nRecordSize does not exceed the maximal stream position
        if (nMetaRecEndPos > this.mnEndPos) { this.mbError = true; break; }
        const nMode = s.ReadUInt16(), nLen = s.ReadUInt16();
        if (nRecordSize !== ((nLen + 1) >> 1) + 5) { bRecordOk = false; break; }
        if (nMode === W_MFCOMMENT && nLen >= 4) {
          const nNewMagic = s.ReadUInt32(); // we have to read int32 for META_ESCAPE_ENHANCED_METAFILE CommentIdentifier
          // The private Unicode text escape (0x2c2a4f4f) is not ported: the polygons that follow it are drawn.
          if (nNewMagic === 0x43464d57 && nLen >= 34 && nLen + 10 <= nRecordSize * 2) {
            const nComType = s.ReadUInt32(), nVersion = s.ReadUInt32();
            s.ReadUInt16(); // nCheck
            s.ReadUInt32(); // nFlags
            const nComRecCount = s.ReadUInt32(), nCurRecSize = s.ReadUInt32();
            s.ReadUInt32(); // nRemainingSize
            const nEMFTotalSize = s.ReadUInt32(); // the nRemainingSize is not mentioned in MSDN documentation
            // but it seems to be required to read in data produced by OLE
            if (nComType === 0x01 && nVersion === 0x10000 && nComRecCount) {
              if (!this.mnEMFRec) { // first EMF comment
                this.mnEMFRecCount = nComRecCount;
                this.mnEMFSize = nEMFTotalSize;
                if (this.mnEMFSize > s.remainingSize()) this.mpEMFStream = null; // emf size claims to be larger than remaining data
                else this.mpEMFStream = [];
              } else if (this.mnEMFRecCount !== nComRecCount || this.mnEMFSize !== nEMFTotalSize) { // add additional checks here
                // total records should be the same as in previous comments
                this.mnEMFRecCount = 0xffffffff;
                this.mpEMFStream = null;
              }
              this.mnEMFRec++;
              if (this.mpEMFStream && nCurRecSize + 34 > nLen) { this.mnEMFRecCount = 0xffffffff; this.mpEMFStream = null; }
              if (this.mpEMFStream && nCurRecSize > s.remainingSize()) { this.mnEMFRecCount = 0xffffffff; this.mpEMFStream = null; }
              if (this.mpEMFStream) {
                const aBuf = s.ReadBytes(nCurRecSize);
                if (aBuf.length === nCurRecSize) this.mpEMFStream.push([...aBuf]);
              }
            }
          }
        }
        break;
      }

      default:
        // W_META_SETRELABS, W_META_SETPOLYFILLMODE, W_META_SETSTRETCHBLTMODE … are not implemented,
        // as upstream; unknown records are skipped.
        break;
    }
    if (!bRecordOk) this.mbError = true; // WMF validation failed
  }

  private mnRecPos = 0;

  ReadHeader(): boolean {
    const s = this.mpInputStream;
    const nStrmPos = s.Tell();
    // if available read the METAFILEHEADER
    const nPlaceableMetaKey = s.ReadUInt32();
    let aPlaceableBound = new Rectangle();
    this.mbPlaceable = nPlaceableMetaKey === 0x9ac6cdd7;
    if (this.mbPlaceable) {
      // Skip reserved bytes
      s.SeekRel(2);
      // BoundRect
      const l = s.ReadInt16(), t = s.ReadInt16(), r = s.ReadInt16(), b = s.ReadInt16();
      aPlaceableBound = new Rectangle(l, t, r, b);
      // inch
      this.mnUnitsPerInch = s.ReadUInt16();
      // reserved
      s.SeekRel(4);
      // Skip and don't check the checksum
      s.SeekRel(2);
      // Skip wmf header
      s.Seek(nStrmPos + 40); // set the streampos to the start of the metaactions
      aPlaceableBound = this.GetPlaceableBound(aPlaceableBound, s);
      // Go back to the place after placeable header
      s.Seek(nStrmPos + 22);
    } else {
      // Default is 1440, but it is set to 96 to show the wmf larger
      this.mnUnitsPerInch = 96;
      s.Seek(nStrmPos + 18); // set the streampos to the start of the metaactions
      aPlaceableBound = this.GetPlaceableBound(aPlaceableBound, s);
      // The image size is not known so normalize the calculated bounds so that the
      // resulting image is not too big
      if (aPlaceableBound.GetWidth() > aMaxWidth) {
        const fRatio = aPlaceableBound.GetWidth() / aMaxWidth;
        // changing mnUnitsPerInch as a tool to scale wmf
        this.mnUnitsPerInch = Math.trunc(this.mnUnitsPerInch * fRatio);
      }
      s.Seek(nStrmPos);
    }
    this.SetWinOrg(aPlaceableBound.TopLeft());
    const aWMFSize = new Size(Math.abs(aPlaceableBound.GetWidth()), Math.abs(aPlaceableBound.GetHeight()));
    this.SetWinExt(aWMFSize);

    let aDevExt = new Size(10000, 10000);
    if (Math.abs(aWMFSize.Width()) > 1 && Math.abs(aWMFSize.Height()) > 1 && this.mnUnitsPerInch) {
      // the size in 1/100 mm, at mnUnitsPerInch units per inch
      aDevExt = new Size(Math.abs(Math.round((aWMFSize.Width() * 2540) / this.mnUnitsPerInch)), Math.abs(Math.round((aWMFSize.Height() * 2540) / this.mnUnitsPerInch)));
    }
    this.SetDevExt(aDevExt);

    // read the METAHEADER
    const nMetaKey = s.ReadUInt32(); // type and headersize
    if (nMetaKey !== 0x00090001) {
      const aNextWord = s.ReadUInt16();
      if (nMetaKey !== 0x10000 || aNextWord !== 0x09) return false;
    }
    s.SeekRel(2); // Version (of Windows)
    s.SeekRel(4); // Size (of file in words)
    s.SeekRel(2); // NoObjects (maximum number of simultaneous objects)
    s.SeekRel(4); // MaxRecord (size of largest record in words)
    s.SeekRel(2); // NoParameters (Unused
    return s.Tell() <= s.TellEnd();
  }

  ReadWMF(): boolean {
    this.mnSkipActions = 0;
    this.mpEMFStream = null;
    this.mnEMFRecCount = 0;
    this.mnEMFRec = 0;
    this.mnEMFSize = 0;

    this.SetMapMode(MappingMode.MM_ANISOTROPIC);
    this.SetWinOrg(new Point());
    this.SetWinExt(new Size(1, 1));
    this.SetDevExt(new Size(10000, 10000));

    this.mnEndPos = this.mpInputStream.TellEnd();
    this.mpInputStream.Seek(this.mnStartPos);
    const s = this.mpInputStream;
    let bOk = false;
    try {
      if (this.ReadHeader()) {
        bOk = true;
        let nPos = s.Tell();
        let bEMFAvailable = false;
        while (s.Tell() + 6 <= this.mnEndPos) {
          this.mnRecSize = s.ReadUInt32();
          const nFunction = s.ReadUInt16();
          if (this.mnRecSize < 3 || nFunction === W_META_EOF) break;
          const nAvailableBytes = this.mnEndPos - nPos;
          const nMaxPossibleRecordSize = nAvailableBytes / 2;
          if (this.mnRecSize > nMaxPossibleRecordSize) { bOk = false; break; }
          this.mnRecPos = nPos;
          if (!bEMFAvailable) {
            if (this.maBmpSaveList.length && nFunction !== W_META_STRETCHDIB && nFunction !== W_META_DIBBITBLT && nFunction !== W_META_DIBSTRETCHBLT) {
              this.ResolveBitmapActions(this.maBmpSaveList);
            }
            if (!this.mnSkipActions) {
              try { this.ReadRecordParams(this.mnRecSize, nFunction); } catch { this.mbError = true; }
            } else this.mnSkipActions--;
            if (this.mbError) { bOk = false; break; }

            // (ReadRecordParams sets the stream; the cast undoes the narrowing of the reset above)
            const pEMFStream = this.mpEMFStream as number[][] | null;
            if (pEMFStream && this.mnEMFRecCount === this.mnEMFRec) {
              const aEMF = Uint8Array.from(pEMFStream.flat());
              const aMeta = new GDIMetaFile();
              const pEMFReader = new EmfReader(new SvStream(aEMF), aMeta);
              bEMFAvailable = pEMFReader.ReadEnhWMF();
              pEMFReader.Finish();
              if (bEMFAvailable) {
                // AddFromGDIMetaFile: the EMF's actions replace the rest of the WMF.
                for (const a of aMeta.m_aList) this.mpGDIMetaFile.AddAction(a);
                this.SetrclFrame(new Rectangle(0, 0, aMeta.GetPrefSize().width - 1, aMeta.GetPrefSize().height - 1));
              } else {
                // something went wrong
                // continue with WMF, don't try this again
                this.mpEMFStream = null;
              }
            }
          }
          nPos += this.mnRecSize * 2;
          s.Seek(nPos);
        }
        if (bOk && this.maBmpSaveList.length) this.ResolveBitmapActions(this.maBmpSaveList);
      }
    } catch {
      bOk = false;
    }
    return bOk;
  }

  /** GetPlaceableBound: the bounds from the window or viewport records, else from what is drawn. */
  GetPlaceableBound(rPlaceableBound: Rectangle, pStm: SvStream): Rectangle {
    const aBound = new Rectangle(RECT_MAX, RECT_MAX, RECT_MIN, RECT_MIN);
    let bBoundsDetermined = false;
    let nPos = pStm.Tell();
    const nEnd = pStm.TellEnd();
    let aWinOrg = new Point(0, 0);
    let aWinExt: Size | null = null;
    let aViewportOrg = new Point(0, 0);
    let aViewportExt: Size | null = null;
    let eMapMode: number = MappingMode.MM_ANISOTROPIC;
    let bRet = nEnd - nPos > 0;
    const saved = this.mpInputStream;
    this.mpInputStream = pStm;
    try {
      while (bRet) {
        if (pStm.Tell() + 6 > nEnd) { bRet = false; break; }
        const nRSize = pStm.ReadUInt32();
        const nFunction = pStm.ReadUInt16();
        if (nRSize < 3) { bRet = false; break; }
        if (nFunction === W_META_EOF) break;
        switch (nFunction) {
          case W_META_SETWINDOWORG: aWinOrg = this.ReadYX(); break;
          case W_META_SETWINDOWEXT: { const h = pStm.ReadInt16(), w = pStm.ReadInt16(); aWinExt = new Size(w, h); break; }
          case W_META_SETVIEWPORTORG: aViewportOrg = this.ReadYX(); break;
          case W_META_SETVIEWPORTEXT: { const h = pStm.ReadInt16(), w = pStm.ReadInt16(); aViewportExt = new Size(w, h); break; }
          case W_META_SETMAPMODE: eMapMode = pStm.ReadUInt16(); break;
          case W_META_MOVETO:
          case W_META_LINETO: GetWinExtMax(this.ReadYX(), aBound, eMapMode); bBoundsDetermined = true; break;
          case W_META_RECTANGLE:
          case W_META_INTERSECTCLIPRECT:
          case W_META_EXCLUDECLIPRECT:
          case W_META_ELLIPSE: GetWinExtMax(this.ReadRectangle(), aBound, eMapMode); bBoundsDetermined = true; break;
          case W_META_ROUNDRECT: this.ReadYXExt(); GetWinExtMax(this.ReadRectangle(), aBound, eMapMode); bBoundsDetermined = true; break;
          case W_META_ARC:
          case W_META_PIE:
          case W_META_CHORD: this.ReadYX(); this.ReadYX(); GetWinExtMax(this.ReadRectangle(), aBound, eMapMode); bBoundsDetermined = true; break;
          case W_META_POLYGON:
          case W_META_POLYLINE: {
            const nPoints = pStm.ReadUInt16();
            if (nPoints > pStm.remainingSize() / 4) { bRet = false; break; }
            for (let i = 0; i < nPoints; i++) { GetWinExtMax(this.ReadPoint(), aBound, eMapMode); bBoundsDetermined = true; }
            break;
          }
          case W_META_POLYPOLYGON: {
            const nPoly = pStm.ReadUInt16();
            let nPoints = 0;
            if (nPoly > pStm.remainingSize() / 2) { bRet = false; break; }
            for (let i = 0; i < nPoly; i++) nPoints += pStm.ReadUInt16();
            if (nPoints > pStm.remainingSize() / 4) { bRet = false; break; }
            for (let i = 0; i < nPoints; i++) { GetWinExtMax(this.ReadPoint(), aBound, eMapMode); bBoundsDetermined = true; }
            break;
          }
          case W_META_SETPIXEL: pStm.ReadUInt32(); GetWinExtMax(this.ReadYX(), aBound, eMapMode); bBoundsDetermined = true; break;
          case W_META_TEXTOUT: {
            const nLength = pStm.ReadUInt16();
            // todo: we also have to take care of the text width
            if (nLength) { pStm.SeekRel((nLength + 1) & ~1); GetWinExtMax(this.ReadYX(), aBound, eMapMode); bBoundsDetermined = true; }
            break;
          }
          case W_META_EXTTEXTOUT: {
            const aPosition = this.ReadYX();
            const nLen = pStm.ReadUInt16();
            pStm.ReadUInt16(); // nOptions
            // todo: we also have to take care of the text width
            if (nLen) { GetWinExtMax(aPosition, aBound, eMapMode); bBoundsDetermined = true; }
            break;
          }
          case W_META_BITBLT:
          case W_META_DIBBITBLT:
          case W_META_DIBSTRETCHBLT:
          case W_META_STRETCHBLT:
          case W_META_STRETCHDIB: {
            pStm.ReadUInt32(); // nRasterOperation
            if (nFunction === W_META_STRETCHDIB) pStm.ReadUInt16(); // nColorUsage
            if (nFunction === W_META_DIBSTRETCHBLT || nFunction === W_META_STRETCHBLT || nFunction === W_META_STRETCHDIB) { pStm.ReadInt16(); pStm.ReadInt16(); }
            // nYSrc and nXSrc is the offset of the first pixel
            pStm.ReadInt16(); pStm.ReadInt16();
            const bNoSourceBitmap = nFunction !== W_META_STRETCHDIB && nRSize === (nFunction >> 8) + 3;
            if (bNoSourceBitmap) pStm.SeekRel(2); // Skip Reserved 2 bytes (it must be ignored)
            const aDestSize = this.ReadYXExt();
            if (aDestSize.Width() && aDestSize.Height()) { // #92623# do not try to read buggy bitmaps
              const aDestRect = Rectangle.FromPointSize(this.ReadYX(), aDestSize);
              GetWinExtMax(aDestRect, aBound, eMapMode);
              bBoundsDetermined = true;
            }
            break;
          }
          case W_META_PATBLT: {
            pStm.ReadUInt32(); // nROP
            const aSize = this.ReadYXExt();
            GetWinExtMax(Rectangle.FromPointSize(this.ReadYX(), aSize), aBound, eMapMode);
            bBoundsDetermined = true;
            break;
          }
        }
        if (!bRet) break;
        const nAvailableBytes = nEnd - nPos;
        const nMaxPossibleRecordSize = nAvailableBytes / 2;
        if (nRSize <= nMaxPossibleRecordSize) {
          nPos += nRSize * 2;
          pStm.Seek(nPos);
        } else bRet = false;
      }
    } catch {
      bRet = false;
    } finally {
      this.mpInputStream = saved;
    }
    if (!bRet) return rPlaceableBound; // Unable to calculate Placeable Bounds

    if (aWinExt) {
      const r = Rectangle.FromPointSize(aWinOrg, aWinExt);
      if (this.mbPlaceable && eMapMode === MappingMode.MM_ANISOTROPIC) {
        // It seems that (in MM_ANISOTROPIC WMFs) the "inch" field (PPI) in META_PLACEABLE is
        // ignored and instead competitor office suites decide what it should be arbitrarily
        const nWidth = r.GetWidth(), nHeight = r.GetHeight();
        if (this.mnUnitsPerInch > nWidth && this.mnUnitsPerInch > nHeight) this.mnUnitsPerInch = Math.max(nWidth, nHeight);
      }
      return r;
    }
    if (aViewportExt) return Rectangle.FromPointSize(aViewportOrg, aViewportExt);
    if (bBoundsDetermined) return aBound;
    return new Rectangle(0, 0, aMaxWidth, aMaxWidth);
  }
}
