// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/node.cxx partial
// @upstream starmath/inc/node.hxx partial
// The formula's node tree: Prepare gives each node its font from the format, Arrange lays the
// tree out (each node is its own SmRect). Not ported: the accessibility text, the selection and
// caret support of the visual editor, and finding nodes by position. Symbols (%name) know the
// Greek letters of the default symbol sets; other user symbols show their name.
import { T, TG, SmToken } from '../inc/token.ts';
import { MS_ERROR, MS_LINE, MS_DLINE, MS_VERTLINE, MS_DVERTLINE, MS_PLACE } from '../inc/types.ts';
import { RectCopyMBL, RectHorAlign, RectPos, RectVerAlign, SmFromTo, SmRect, type Point } from './rect.ts';
import {
  DIS_BRACKETSIZE, DIS_BRACKETSPACE, DIS_DENOMINATOR, DIS_FRACTION, DIS_HORIZONTAL, DIS_LOWERLIMIT, DIS_MATRIXCOL,
  DIS_MATRIXROW, DIS_NORMALBRACKETSIZE, DIS_NUMERATOR, DIS_OPERATORSIZE, DIS_OPERATORSPACE, DIS_ORNAMENTSIZE,
  DIS_ORNAMENTSPACE, DIS_ROOT, DIS_STROKEWIDTH, DIS_SUBSCRIPT, DIS_SUPERSCRIPT, DIS_UPPERLIMIT, DIS_VERTICAL,
  FNT_FIXED, FNT_FUNCTION, FNT_MATH, FNT_NUMBER, FNT_SANS, FNT_SERIF, FNT_TEXT, FNT_VARIABLE, IsBold, IsItalic,
  PtToTwip, SIZ_FUNCTION, SIZ_INDEX, SIZ_LIMITS, SIZ_OPERATOR, SIZ_TEXT, SmDevice, SmFace, SmHorAlign, type SmFormat,
} from './format.ts';

export const SmNodeType = {
  Table: 0, Brace: 1, Bracebody: 2, Oper: 3, Align: 4, Attribute: 5, Font: 6, UnHor: 7, BinHor: 8, BinVer: 9,
  BinDiagonal: 10, SubSup: 11, Matrix: 12, Place: 13, Text: 14, Special: 15, GlyphSpecial: 16, Math: 17, Blank: 18,
  Error: 19, Line: 20, Expression: 21, PolyLine: 22, Root: 23, RootSymbol: 24, Rectangle: 25, VerticalBrace: 26,
  MathIdent: 27,
} as const;
export type SmNodeType = (typeof SmNodeType)[keyof typeof SmNodeType];

export const FontSizeType = { ABSOLUT: 1, PLUS: 2, MINUS: 3, MULTIPLY: 4, DIVIDE: 5 } as const;
export type FontSizeType = (typeof FontSizeType)[keyof typeof FontSizeType];

// flags to interdict respective status changes
export const FontChangeMask = { None: 0x0000, Face: 0x0001, Size: 0x0002, Bold: 0x0004, Italic: 0x0008, Color: 0x0010, Phantom: 0x0020 } as const;
export const FontAttribute = { None: 0x0000, Bold: 0x0001, Italic: 0x0002 } as const;

export const SmScaleMode = { None: 0, Width: 1, Height: 2 } as const;
export type SmScaleMode = (typeof SmScaleMode)[keyof typeof SmScaleMode];

export const SmSubSup = { CSUB: 0, CSUP: 1, RSUB: 2, RSUP: 3, LSUB: 4, LSUP: 5 } as const;
export type SmSubSup = (typeof SmSubSup)[keyof typeof SmSubSup];
/** numbers of entries in the above enum (that is: the number of possible sub-/supscripts) */
export const SUBSUP_NUM_ENTRIES = 6;

/** The formula's colours: "#rrggbb" for a colour token's value (its alpha byte is transparency). */
const ColorOf = (hex: string): string => `#${(parseInt(hex || '0', 16) & 0xffffff).toString(16).padStart(6, '0')}`;

export abstract class SmNode extends SmRect {
  // Rendering info for SmRect
  maFace = new SmFace();
  // Anclar to the code
  maNodeToken: SmToken;
  meType: SmNodeType;
  meScaleMode: SmScaleMode = SmScaleMode.None;
  meRectHorAlign: RectHorAlign = RectHorAlign.Left;
  mnFlags = FontChangeMask.None as number;
  mnAttributes = FontAttribute.None as number;
  mbIsPhantom = false;
  mpParentNode: SmStructureNode | null = null;

  constructor(eNodeType: SmNodeType, aNodeToken: SmToken) {
    super();
    this.maNodeToken = aNodeToken;
    this.meType = eNodeType;
  }

  IsVisible(): boolean { return false; }
  GetNumSubNodes(): number { return 0; }
  GetSubNode(_nIndex: number): SmNode | null { return null; }
  /** ForEachNonNull */
  protected forEach(f: (n: SmNode) => void): void {
    const nSize = this.GetNumSubNodes();
    for (let i = 0; i < nSize; ++i) {
      const pSubNode = this.GetSubNode(i);
      if (pSubNode) f(pSubNode);
    }
  }

  Flags(): number { return this.mnFlags; }
  Attributes(): number { return this.mnAttributes; }
  IsPhantom(): boolean { return this.mbIsPhantom; }
  GetFont(): SmFace { return this.maFace; }
  SetFontObj(f: SmFace): void { this.maFace = f; }
  GetToken(): SmToken { return this.maNodeToken; }
  GetType(): SmNodeType { return this.meType; }
  GetScaleMode(): SmScaleMode { return this.meScaleMode; }
  SetScaleMode(eMode: SmScaleMode): void { this.meScaleMode = eMode; }
  GetRectHorAlign(): RectHorAlign { return this.meRectHorAlign; }
  GetParent(): SmStructureNode | null { return this.mpParentNode; }
  SetParent(p: SmStructureNode): void { this.mpParentNode = p; }

  //  returns leftmost node of current subtree.
  //! (this assumes the one with index 0 is always the leftmost subnode
  //! for the current node).
  GetLeftMost(): SmNode {
    const pNode = this.GetNumSubNodes() > 0 ? this.GetSubNode(0) : null;
    return pNode ? pNode.GetLeftMost() : this;
  }

  SetPhantom(bIsPhantomP: boolean): void {
    if (!(this.Flags() & FontChangeMask.Phantom)) this.mbIsPhantom = bIsPhantomP;
    const b = this.mbIsPhantom;
    this.forEach((n) => n.SetPhantom(b));
  }

  SetColor(rColor: string): void {
    if (!(this.Flags() & FontChangeMask.Color)) this.GetFont().color = rColor;
    this.forEach((n) => n.SetColor(rColor));
  }

  SetAttribute(nAttrib: number): void {
    if ((nAttrib === FontAttribute.Bold && !(this.Flags() & FontChangeMask.Bold)) || (nAttrib === FontAttribute.Italic && !(this.Flags() & FontChangeMask.Italic))) {
      this.mnAttributes |= nAttrib;
    }
    this.forEach((n) => n.SetAttribute(nAttrib));
  }

  ClearAttribute(nAttrib: number): void {
    if ((nAttrib === FontAttribute.Bold && !(this.Flags() & FontChangeMask.Bold)) || (nAttrib === FontAttribute.Italic && !(this.Flags() & FontChangeMask.Italic))) {
      this.mnAttributes &= ~nAttrib;
    }
    this.forEach((n) => n.ClearAttribute(nAttrib));
  }

  SetFont(rFace: SmFace): void {
    if (!(this.Flags() & FontChangeMask.Face)) this.maFace = rFace.clone();
    this.forEach((n) => n.SetFont(rFace));
  }

  //! 'rSize' is in units of pts
  SetFontSize(rSize: number, nType: FontSizeType): void {
    if (!(this.Flags() & FontChangeMask.Size)) {
      const nHeight = Math.trunc(rSize * 20);
      const aFntSize = { width: 0, height: this.GetFont().height };
      switch (nType) {
        case FontSizeType.ABSOLUT: aFntSize.height = nHeight; break;
        case FontSizeType.PLUS: aFntSize.height += nHeight; break;
        case FontSizeType.MINUS: aFntSize.height -= nHeight; break;
        case FontSizeType.MULTIPLY: aFntSize.height = Math.trunc(aFntSize.height * rSize); break;
        case FontSizeType.DIVIDE: if (rSize !== 0) aFntSize.height = Math.trunc(aFntSize.height / rSize); break;
        default: break;
      }
      // check the requested size against maximum value
      const nMaxVal = PtToTwip(128);
      if (aFntSize.height > nMaxVal) aFntSize.height = nMaxVal;
      this.GetFont().SetSize(aFntSize.width, aFntSize.height);
    }
    this.forEach((n) => n.SetFontSize(rSize, nType));
  }

  SetSize(rSize: number): void {
    this.GetFont().scale(rSize);
    this.forEach((n) => n.SetSize(rSize));
  }

  SetRectHorAlign(eHorAlign: RectHorAlign, bApplyToSubTree = true): void {
    this.meRectHorAlign = eHorAlign;
    if (bApplyToSubTree) this.forEach((n) => n.SetRectHorAlign(eHorAlign));
  }

  PrepareAttributes(): void {
    this.GetFont().bold = (this.Attributes() & FontAttribute.Bold) !== 0;
    this.GetFont().italic = (this.Attributes() & FontAttribute.Italic) !== 0;
  }

  Prepare(rFormat: SmFormat, nDepth: number): void {
    if (nDepth > 1024) throw new RangeError('parser depth limit');
    this.mbIsPhantom = false;
    this.mnFlags = FontChangeMask.None;
    this.mnAttributes = FontAttribute.None;
    switch (rFormat.GetHorAlign()) {
      case SmHorAlign.Left: this.meRectHorAlign = RectHorAlign.Left; break;
      case SmHorAlign.Center: this.meRectHorAlign = RectHorAlign.Center; break;
      case SmHorAlign.Right: this.meRectHorAlign = RectHorAlign.Right; break;
    }
    this.maFace = rFormat.GetFont(FNT_MATH).clone();
    this.GetFont().bold = false;
    this.GetFont().italic = false;
    this.forEach((n) => n.Prepare(rFormat, nDepth + 1));
  }

  override Move(rVector: Point): void {
    if (rVector.x === 0 && rVector.y === 0) return;
    super.Move(rVector);
    this.forEach((n) => n.Move(rVector));
  }

  AdaptToX(_rDev: SmDevice, _nWidth: number): void {}
  AdaptToY(_rDev: SmDevice, _nHeight: number): void {}

  abstract Arrange(rDev: SmDevice, rFormat: SmFormat): void;
}

/** Abstract baseclass for all composite node */
export class SmStructureNode extends SmNode {
  maSubNodes: (SmNode | null)[] = [];

  override GetNumSubNodes(): number { return this.maSubNodes.length; }
  override GetSubNode(nIndex: number): SmNode | null { return this.maSubNodes[nIndex] ?? null; }

  /** SetSubNodes(pFirst, pSecond, pThird), or SetSubNodes(SmNodeArray&&) with an array. */
  SetSubNodes(pFirst: SmNode | null | (SmNode | null)[], pSecond: SmNode | null = null, pThird: SmNode | null = null): void {
    if (Array.isArray(pFirst)) {
      this.maSubNodes = pFirst;
    } else {
      const nSize = pThird ? 3 : pSecond ? 2 : pFirst ? 1 : 0;
      this.maSubNodes.length = nSize;
      for (let i = 0; i < nSize; i++) this.maSubNodes[i] ??= null;
      if (pFirst) this.maSubNodes[0] = pFirst;
      if (pSecond) this.maSubNodes[1] = pSecond;
      if (pThird) this.maSubNodes[2] = pThird;
    }
    this.ClaimPaternity();
  }

  SetSubNodesBinMo(pFirst: SmNode | null, pSecond: SmNode | null, pThird: SmNode | null): void {
    if (this.GetType() === SmNodeType.BinDiagonal) {
      const nSize = pSecond ? 3 : pThird ? 2 : pFirst ? 1 : 0;
      this.maSubNodes = new Array(nSize).fill(null);
      if (pFirst) this.maSubNodes[0] = pFirst;
      if (pSecond) this.maSubNodes[2] = pSecond;
      if (pThird) this.maSubNodes[1] = pThird;
      this.ClaimPaternity();
    } else this.SetSubNodes(pFirst, pSecond, pThird);
  }

  GetSubNodeBinMo(nIndex: number): SmNode | null {
    if (this.GetType() === SmNodeType.BinDiagonal) {
      if (nIndex === 1) nIndex = 2;
      else if (nIndex === 2) nIndex = 1;
    }
    return this.maSubNodes[nIndex] ?? null;
  }

  ClaimPaternity(): void { this.forEach((n) => n.SetParent(this)); }

  IndexOfSubNode(pSubNode: SmNode): number { return this.maSubNodes.indexOf(pSubNode); }

  SetSubNode(nIndex: number, pNode: SmNode | null): void {
    while (this.maSubNodes.length <= nIndex) this.maSubNodes.push(null);
    this.maSubNodes[nIndex] = pNode;
    if (pNode) pNode.SetParent(this);
  }

  Arrange(_rDev: SmDevice, _rFormat: SmFormat): void {}
}

/** Abstract base class for all visible node */
export abstract class SmVisibleNode extends SmNode {
  override IsVisible(): boolean { return true; }
}

export abstract class SmGraphicNode extends SmVisibleNode {}

/** Draws a rectangle, used for the fraction line and the underline/overline/overstrike attributes. */
export class SmRectangleNode extends SmGraphicNode {
  maToSize = { width: 0, height: 0 };
  constructor(rNodeToken: SmToken) { super(SmNodeType.Rectangle, rNodeToken); }

  override AdaptToX(_rDev: SmDevice, nWidth: number): void { this.maToSize.width = nWidth; }
  override AdaptToY(_rDev: SmDevice, nHeight: number): void {
    this.GetFont().FreezeBorderWidth();
    this.maToSize.height = nHeight;
  }

  Arrange(_rDev: SmDevice, _rFormat: SmFormat): void {
    const nFontHeight = this.GetFont().height;
    let nWidth = this.maToSize.width, nHeight = this.maToSize.height;
    if (nHeight === 0) nHeight = Math.trunc(nFontHeight / 30);
    if (nWidth === 0) nWidth = Math.trunc(nFontHeight / 3);
    // add some borderspace
    const nTmpBorderWidth = this.GetFont().GetBorderWidth();
    nHeight += 2 * nTmpBorderWidth;
    //! use this method in order to have 'SmRect::HasAlignInfo() == true'
    //! and thus having the attribute-fences updated in 'SmRect::ExtendBy'
    this.assign(SmRect.Sized(nWidth, nHeight));
  }
}

/** Polygon line node: the diagonal line of wideslash and widebslash. */
export class SmPolyLineNode extends SmGraphicNode {
  maPoly: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  maToSize = { width: 0, height: 0 };
  mnWidth = 0;
  constructor(rNodeToken: SmToken) { super(SmNodeType.PolyLine, rNodeToken); }

  /** SmPolyLineNode::GetWidth, the line width (it hides SmRect::GetWidth upstream). */
  GetLineWidth(): number { return this.mnWidth; }
  GetPolygon(): Point[] { return this.maPoly; }
  override AdaptToX(_rDev: SmDevice, nNewWidth: number): void { this.maToSize.width = nNewWidth; }
  override AdaptToY(_rDev: SmDevice, nNewHeight: number): void {
    this.GetFont().FreezeBorderWidth();
    this.maToSize.height = nNewHeight;
  }

  Arrange(_rDev: SmDevice, rFormat: SmFormat): void {
    const nBorderwidth = this.GetFont().GetBorderWidth();
    // create polygon using both endpoints
    if (this.GetToken().eType === T.TWIDESLASH) {
      this.maPoly[0] = { x: nBorderwidth, y: this.maToSize.height - nBorderwidth };
      this.maPoly[1] = { x: this.maToSize.width - nBorderwidth, y: nBorderwidth };
    } else {
      this.maPoly[0] = { x: nBorderwidth, y: nBorderwidth };
      this.maPoly[1] = { x: this.maToSize.width - nBorderwidth, y: this.maToSize.height - nBorderwidth };
    }
    const nThick = Math.trunc((this.GetFont().height * rFormat.GetDistance(DIS_STROKEWIDTH)) / 100);
    this.mnWidth = nThick + 2 * nBorderwidth;
    this.assign(SmRect.Sized(this.maToSize.width, this.maToSize.height));
  }
}

/** Text node: identifiers, numbers, function names and quoted text. */
export class SmTextNode extends SmVisibleNode {
  maText = '';
  mnFontDesc: number;

  constructor(rNodeToken: SmToken, nFontDescP: number, eNodeType: SmNodeType = SmNodeType.Text) {
    super(eNodeType, rNodeToken);
    this.mnFontDesc = nFontDescP;
  }

  GetFontDesc(): number { return this.mnFontDesc; }
  SetText(rText: string): void { this.maText = rText; }
  GetText(): string { return this.maText; }

  ChangeText(rText: string): void {
    this.maText = rText;
    this.GetToken().aText = rText;
    this.AdjustFontDesc();
  }

  override Prepare(rFormat: SmFormat, nDepth: number): void {
    super.Prepare(rFormat, nDepth);
    // default setting for horizontal alignment of nodes with TTEXT
    // content is as alignl (cannot be done in Arrange since it would
    // override the settings made by an SmAlignNode before)
    if (this.GetToken().eType === T.TTEXT) this.SetRectHorAlign(RectHorAlign.Left);
    this.maText = this.GetToken().aText;
    this.maFace = rFormat.GetFont(this.GetFontDesc()).clone();
    if (IsItalic(this.GetFont())) this.mnAttributes |= FontAttribute.Italic;
    if (IsBold(this.GetFont())) this.mnAttributes |= FontAttribute.Bold;
    // special handling for ':' where it is a token on its own and is likely
    // to be used for mathematical notations. (E.g. a:b = 2:3)
    // In that case it should not be displayed in italic.
    if (this.maText.length === 1 && this.GetToken().aText[0] === ':') this.mnAttributes &= ~FontAttribute.Italic;
    // Arabic text should not be italic, so we check for any character in Arabic script and
    // remove italic attribute.
    if (/\p{Script=Arabic}/u.test(this.maText)) this.mnAttributes &= ~FontAttribute.Italic;
  }

  Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    this.PrepareAttributes();
    const nSizeDesc = this.GetFontDesc() === FNT_FUNCTION ? SIZ_FUNCTION : SIZ_TEXT;
    this.GetFont().scale(rFormat.GetRelSize(nSizeDesc) / 100);
    rDev.SetFont(this.GetFont());
    this.assign(SmRect.Text(rDev, rFormat, this.maText, this.GetFont().GetBorderWidth()));
  }

  AdjustFontDesc(): void {
    if (this.GetToken().nGroup === TG.Function) this.mnFontDesc = FNT_FUNCTION;
    else if (this.GetToken().eType === T.TTEXT) this.mnFontDesc = FNT_TEXT;
    else {
      const firstChar = this.maText[0] ?? '';
      if (('0' <= firstChar && firstChar <= '9') || firstChar === '.' || firstChar === ',') this.mnFontDesc = FNT_NUMBER;
      else this.mnFontDesc = FNT_VARIABLE;
    }
  }

  /**
   * Converts the character from StarMath's private area symbols to a matching Unicode
   * character, if necessary. To be used when converting GetText() to a normal text.
   */
  static ConvertSymbolToUnicode(nIn: number): number {
    //Find the best match in accepted unicode for our private area symbols
    const aStarMathPrivateToUnicode = [
      0x2030, 0xF613, 0xF612, 0x002B, 0x003C, 0x003E, 0xE425, 0xE421, 0xE088, 0x2208,
      0x0192, 0x2026, 0x2192, 0x221A, 0x221A, 0x221A, 0xE090, 0x005E, 0x02C7, 0x02D8,
      0x00B4, 0x0060, 0x02DC, 0x00AF, 0x0362, 0xE099, 0xE09A, 0x20DB, 0xE09C, 0xE09D,
      0x0028, 0x0029, 0x2220, 0x22AF, 0xE0A2, 0xE0A3, 0xE0A4, 0xE0A5, 0xE0A6, 0xE0A7,
      0x002F, 0x005C, 0x274F, 0xE0AB, 0x0393, 0x0394, 0x0398, 0x039b, 0x039e, 0x03A0,
      0x03a3, 0x03a5, 0x03a6, 0x03a8, 0x03A9, 0x03B1, 0x03B2, 0x03b3, 0x03b4, 0x03b5,
      0x03b6, 0x03b7, 0x03b8, 0x03b9, 0x03ba, 0x03bb, 0x03bc, 0x03bd, 0x03be, 0x03bf,
      0x03c0, 0x03c1, 0x03c3, 0x03c4, 0x03c5, 0x03c6, 0x03c7, 0x03c8, 0x03c9, 0x03b5,
      0x03d1, 0x03d6, 0xE0D2, 0x03db, 0x2118, 0x2202, 0x2129, 0xE0D7, 0xE0D8, 0x22A4,
      0xE0DA, 0x2190, 0x2191, 0x2193,
    ];
    if (nIn >= 0xE080 && nIn <= 0xE0DD) nIn = aStarMathPrivateToUnicode[nIn - 0xE080];

    //For whatever unicode glyph that equation editor doesn't ship with that
    //we have a possible match we can munge it to.
    switch (nIn) {
      case 0x2223:
        nIn = 0x7c; // '|'
        break;
      default:
        break;
    }

    return nIn;
  }
}

/** The symbols of the default symbol sets known here (SmSymbolManager, reduced to Greek). */
const GREEK = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'.split(' ');
function GetSymbol(rName: string): { cChar: string; set: 'Greek' | 'iGreek' | 'Special' } | null {
  let name = rName, set: 'Greek' | 'iGreek' = 'Greek';
  if (name.startsWith('i') && GREEK.includes(name.slice(1).toLowerCase())) { name = name.slice(1); set = 'iGreek'; }
  const k = GREEK.indexOf(name.toLowerCase());
  if (k >= 0) {
    // α..ω skip U+03C2 (final sigma); the capitals likewise skip U+03A2.
    const off = k >= 17 ? k + 1 : k;
    const upper = name[0] === name[0]!.toUpperCase();
    return { cChar: String.fromCharCode((upper ? 0x391 : 0x3b1) + off), set };
  }
  const SPECIAL: Record<string, number> = { varepsilon: 0x3b5, vartheta: 0x3d1, varpi: 0x3d6, varrho: 0x3f1, varsigma: 0x3c2, varphi: 0x3c6, infinite: 0x221e, angle: 0x2222, perthousand: 0x2030, tendto: 0x2192, element: 0x2208, noelement: 0x2209, strictlylessthan: 0x226a, strictlygreaterthan: 0x226b, notequal: 0x2260, identical: 0x2261, and: 0x2227, or: 0x2228, dlarrow: 0x21d0, drarrow: 0x21d2, dlrarrow: 0x21d4 };
  const c = SPECIAL[rName];
  return c ? { cChar: String.fromCodePoint(c), set: 'Special' } : null;
}

/** Special node for user defined characters (%name) */
export class SmSpecialNode extends SmTextNode {
  constructor(rNodeToken: SmToken, eNodeType: SmNodeType = SmNodeType.Special, nFontDesc = FNT_VARIABLE) {
    super(rNodeToken, nFontDesc, eNodeType); // default Font isn't always correct!
  }

  override Prepare(rFormat: SmFormat, nDepth: number): void {
    SmNode.prototype.Prepare.call(this, rFormat, nDepth);
    const pSym = this.GetToken().aText ? GetSymbol(this.GetToken().aText.slice(1)) : null;
    let bIsGreekSymbol = false, bIsSpecialSymbol = false, bIsArabic = false;
    if (pSym) {
      this.SetText(pSym.cChar);
      this.maFace = rFormat.GetFont(FNT_MATH).clone();
      this.maFace.italic = pSym.set === 'iGreek';
      if (pSym.set === 'Greek') bIsGreekSymbol = true;
      else if (pSym.set === 'Special') bIsSpecialSymbol = true;
    } else {
      this.SetText(this.GetToken().aText);
      this.maFace = rFormat.GetFont(FNT_VARIABLE).clone();
    }
    // use same font size as is used for variables
    this.GetFont().SetSize(this.GetFont().width, rFormat.GetFont(FNT_VARIABLE).height);
    if (IsItalic(this.GetFont())) this.SetAttribute(FontAttribute.Italic);
    if (IsBold(this.GetFont())) this.SetAttribute(FontAttribute.Bold);
    this.mnFlags |= FontChangeMask.Face;

    const cChar = this.GetText().codePointAt(0) ?? 0;
    if (!bIsArabic) bIsArabic = /\p{Script=Arabic}/u.test(String.fromCodePoint(cChar));
    if (!bIsGreekSymbol && !bIsSpecialSymbol && !bIsArabic) return;
    // Arabic and special symbols should not be italic,
    // Greek is italic only in some cases.
    let bItalic = false;
    if (bIsGreekSymbol) {
      const nStyle = rFormat.GetGreekCharStyle();
      if (nStyle === 1) bItalic = true;
      else if (nStyle === 2) {
        const cUppercaseAlpha = 0x0391, cUppercaseOmega = 0x03a9;
        // uppercase letters should be straight and lowercase letters italic
        bItalic = cUppercaseAlpha > cChar || cChar > cUppercaseOmega;
      }
    }
    if (bItalic) this.mnAttributes |= FontAttribute.Italic;
    else this.mnAttributes &= ~FontAttribute.Italic;
  }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    this.PrepareAttributes();
    rDev.SetFont(this.GetFont());
    this.assign(SmRect.Text(rDev, rFormat, this.GetText(), this.GetFont().GetBorderWidth()));
  }
}

/** Glyph node for custom operators (oper, uoper, boper) */
export class SmGlyphSpecialNode extends SmSpecialNode {
  constructor(rNodeToken: SmToken) { super(rNodeToken, SmNodeType.GlyphSpecial, FNT_MATH); }
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    this.PrepareAttributes();
    rDev.SetFont(this.GetFont());
    this.assign(SmRect.Text(rDev, rFormat, this.GetText(), this.GetFont().GetBorderWidth()).AsGlyphRect());
  }
}

/** Math symbol node: operators, brackets, arrows ... in the OpenSymbol font. */
export class SmMathSymbolNode extends SmSpecialNode {
  constructor(rNodeToken: SmToken, eNodeType: SmNodeType = SmNodeType.Math) {
    super(rNodeToken, eNodeType, FNT_MATH);
    this.SetText(this.GetToken().cMathChar);
  }

  override AdaptToX(rDev: SmDevice, nWidth: number): void {
    // Since there is no function to do this, we try to approximate it:
    const aFntSize = this.GetFont().GetFontSize();
    //! however the result is a bit better with 'nWidth' as initial font width
    aFntSize.width = nWidth;
    this.GetFont().SetSize(aFntSize.width, aFntSize.height);
    rDev.SetFont(this.GetFont());
    // get denominator of error factor for width
    const nTmpBorderWidth = this.GetFont().GetBorderWidth();
    const nDenom = SmRect.Text(rDev, null, this.GetText(), nTmpBorderWidth).GetItalicWidth();
    // scale fontwidth with this error factor
    aFntSize.width = Math.trunc((aFntSize.width * nWidth) / (nDenom ? nDenom : 1));
    this.GetFont().SetSize(aFntSize.width, aFntSize.height);
  }

  override AdaptToY(rDev: SmDevice, nHeight: number): void {
    this.GetFont().FreezeBorderWidth();
    const aFntSize = this.GetFont().GetFontSize();
    // Since we only want to scale the height, we might have
    // to determine the font width in order to keep it
    if (aFntSize.width === 0) aFntSize.width = aFntSize.height;
    //! however the result is a bit better with 'nHeight' as initial
    //! font height
    aFntSize.height = nHeight;
    this.GetFont().SetSize(aFntSize.width, aFntSize.height);
    rDev.SetFont(this.GetFont());
    // get denominator of error factor for height
    const nTmpBorderWidth = this.GetFont().GetBorderWidth();
    let nDenom = 0;
    if (this.GetText()) nDenom = SmRect.Text(rDev, null, this.GetText(), nTmpBorderWidth).GetHeight();
    // scale fontwidth with this error factor
    aFntSize.height = Math.trunc((aFntSize.height * nHeight) / (nDenom ? nDenom : 1));
    this.GetFont().SetSize(aFntSize.width, aFntSize.height);
  }

  override Prepare(rFormat: SmFormat, nDepth: number): void {
    SmNode.prototype.Prepare.call(this, rFormat, nDepth);
    this.maFace = rFormat.GetFont(this.GetFontDesc()).clone();
    // use same font size as is used for variables
    this.GetFont().SetSize(rFormat.GetFont(FNT_VARIABLE).width, rFormat.GetFont(FNT_VARIABLE).height);
    this.mnFlags |= FontChangeMask.Face | FontChangeMask.Italic;
  }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const rText = this.GetText();
    if (!rText || rText[0] === '\0') {
      this.assign(new SmRect());
      return;
    }
    this.PrepareAttributes();
    this.GetFont().scale(rFormat.GetRelSize(SIZ_TEXT) / 100);
    rDev.SetFont(this.GetFont());
    this.assign(SmRect.Text(rDev, rFormat, rText, this.GetFont().GetBorderWidth()));
  }
}

/** Math Identifier: setN, infinity, aleph ... */
export class SmMathIdentifierNode extends SmMathSymbolNode {
  constructor(rNodeToken: SmToken) { super(rNodeToken, SmNodeType.MathIdent); }
}

/** Root symbol node: the root sign, its bar drawn over the body. */
export class SmRootSymbolNode extends SmMathSymbolNode {
  mnBodyWidth = 0; // width of body (argument) of root sign
  constructor(rNodeToken: SmToken) { super(rNodeToken, SmNodeType.RootSymbol); }
  GetBodyWidth(): number { return this.mnBodyWidth; }
  override AdaptToX(_rDev: SmDevice, nWidth: number): void { this.mnBodyWidth = nWidth; }
  override AdaptToY(rDev: SmDevice, nHeight: number): void {
    // some additional length so that the horizontal
    // bar will be positioned above the argument
    super.AdaptToY(rDev, nHeight + Math.trunc(nHeight / 10));
  }
}

/** Place node: the placeholder <?> */
export class SmPlaceNode extends SmMathSymbolNode {
  constructor(rNodeToken: SmToken = new SmToken(T.TPLACE, MS_PLACE, '<?>')) { super(rNodeToken, SmNodeType.Place); }
  override Prepare(rFormat: SmFormat, nDepth: number): void {
    SmNode.prototype.Prepare.call(this, rFormat, nDepth);
    this.GetFont().color = '#808080';
    this.mnFlags |= FontChangeMask.Color | FontChangeMask.Face | FontChangeMask.Italic;
  }
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    this.PrepareAttributes();
    rDev.SetFont(this.GetFont());
    this.assign(SmRect.Text(rDev, rFormat, this.GetText(), this.GetFont().GetBorderWidth()));
  }
}

/** Error node: an inverted question mark where the formula has a parse error. */
export class SmErrorNode extends SmMathSymbolNode {
  constructor(rNodeToken: SmToken) {
    super(rNodeToken, SmNodeType.Error);
    this.SetText(String.fromCharCode(MS_ERROR));
  }
  override Prepare(rFormat: SmFormat, nDepth: number): void {
    SmNode.prototype.Prepare.call(this, rFormat, nDepth);
    this.GetFont().color = '#ff0000';
    this.mnFlags |= FontChangeMask.Phantom | FontChangeMask.Bold | FontChangeMask.Italic | FontChangeMask.Color | FontChangeMask.Face | FontChangeMask.Size;
  }
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    this.PrepareAttributes();
    rDev.SetFont(this.GetFont());
    this.assign(SmRect.Text(rDev, rFormat, this.GetText(), this.GetFont().GetBorderWidth()));
  }
}

/** Table node: the lines of the formula, a stack or a binom. */
export class SmTableNode extends SmStructureNode {
  mnFormulaBaseline = 0;
  constructor(rNodeToken: SmToken) { super(SmNodeType.Table, rNodeToken); }
  override GetLeftMost(): SmNode { return this; }
  GetFormulaBaseline(): number { return this.mnFormulaBaseline; }

  // arranges all subnodes in one column
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const nSize = this.GetNumSubNodes();
    // make distance depend on font size
    const nDist = Math.trunc((rFormat.GetDistance(DIS_VERTICAL) * this.GetFont().height) / 100);
    if (nSize < 1) return;
    // arrange subnodes and get maximum width of them
    let nMaxWidth = 0;
    for (let i = 0; i < nSize; ++i) {
      const pNode = this.GetSubNode(i);
      if (pNode) {
        pNode.Arrange(rDev, rFormat);
        nMaxWidth = Math.max(nMaxWidth, pNode.GetItalicWidth());
      }
    }
    this.assign(SmRect.Sized(nMaxWidth, 1));
    for (let i = 0; i < nSize; ++i) {
      const pNode = this.GetSubNode(i);
      if (pNode) {
        const pCoNode = pNode.GetLeftMost();
        const eHorAlign = pCoNode.GetRectHorAlign();
        const aPos = pNode.AlignTo(this, RectPos.Bottom, eHorAlign, RectVerAlign.Baseline);
        if (i) aPos.y += nDist;
        pNode.MoveTo(aPos);
        this.ExtendBy(pNode, nSize > 1 ? RectCopyMBL.None : RectCopyMBL.Arg);
      }
    }
    // #i972#
    if (this.HasBaseline()) this.mnFormulaBaseline = this.GetBaseline();
    else {
      rDev.SetFont(this.GetFont());
      const aRect = SmRect.Text(rDev, rFormat, 'a', this.GetFont().GetBorderWidth());
      this.mnFormulaBaseline = this.GetAlignM();
      // move from middle position by constant - distance
      // between middle and baseline for single letter
      this.mnFormulaBaseline += aRect.GetBaseline() - aRect.GetAlignM();
    }
  }
}

/** A line: expressions with some space between them. */
export class SmLineNode extends SmStructureNode {
  mbUseExtraSpaces = true;
  constructor(rNodeToken: SmToken, eNodeType: SmNodeType = SmNodeType.Line) { super(eNodeType, rNodeToken); }
  SetUseExtraSpaces(bVal: boolean): void { this.mbUseExtraSpaces = bVal; }
  IsUseExtraSpaces(): boolean { return this.mbUseExtraSpaces; }

  override Prepare(rFormat: SmFormat, nDepth: number): void {
    super.Prepare(rFormat, nDepth);
    // Here we use the 'FNT_VARIABLE' font since it's ascent and descent in general fit better
    // to the rest of the formula compared to the 'FNT_MATH' font.
    this.maFace = rFormat.GetFont(FNT_VARIABLE).clone();
    this.mnFlags |= FontChangeMask.Face;
  }

  // arranges all subnodes in one row with some extra space between
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const nSize = this.GetNumSubNodes();
    for (let i = 0; i < nSize; ++i) this.GetSubNode(i)?.Arrange(rDev, rFormat);
    rDev.SetFont(this.GetFont());
    if (nSize < 1) {
      // provide an empty rectangle with alignment parameters for the "current"
      // font (in order to make "a^1 {}_2^3 a_4" work correct, that is, have the
      // same sub-/supscript positions.)
      this.assign(SmRect.Text(rDev, rFormat, 'a', this.GetFont().GetBorderWidth()));
      // make sure that the rectangle occupies (almost) no space
      this.SetWidth(1);
      this.SetItalicSpaces(0, 0);
      return;
    }
    // make distance depend on font size
    let nDist = Math.trunc((rFormat.GetDistance(DIS_HORIZONTAL) * this.GetFont().height) / 100);
    if (!this.IsUseExtraSpaces()) nDist = 0;
    // copy the first node into LineNode and extend by the others
    const pFirst = this.GetSubNode(0);
    if (pFirst) this.assign(pFirst.GetRect());
    for (let i = 1; i < nSize; ++i) {
      const pNode = this.GetSubNode(i);
      if (pNode) {
        const aPos = pNode.AlignTo(this, RectPos.Right, RectHorAlign.Center, RectVerAlign.Baseline);
        // add horizontal space to the left for each but the first sub node
        aPos.x += nDist;
        pNode.MoveTo(aPos);
        this.ExtendBy(pNode, RectCopyMBL.Xor);
      }
    }
  }
}

/** Expression node: as a line, keeping the alignment of its leftmost subnode. */
export class SmExpressionNode extends SmLineNode {
  constructor(rNodeToken: SmToken) { super(rNodeToken, SmNodeType.Expression); }
  // as 'SmLineNode::Arrange' but keeps alignment of leftmost subnode
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    super.Arrange(rDev, rFormat);
    //  copy alignment of leftmost subnode if any
    const pNode = this.GetLeftMost();
    if (pNode) this.SetRectHorAlign(pNode.GetRectHorAlign(), false);
  }
}

/** Unary horizontal node: a prefix operator, or the factorial as postfix. */
export class SmUnHorNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.UnHor, rNodeToken); }
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const bIsPostfix = this.GetToken().eType === T.TFACT;
    const pNode0 = this.GetSubNode(0)!, pNode1 = this.GetSubNode(1)!;
    const pOper = bIsPostfix ? pNode1 : pNode0, pBody = bIsPostfix ? pNode0 : pNode1;
    pOper.SetSize(rFormat.GetRelSize(SIZ_OPERATOR) / 100);
    pOper.Arrange(rDev, rFormat);
    pBody.Arrange(rDev, rFormat);
    const nDist = Math.trunc((pOper.GetWidth() * rFormat.GetDistance(DIS_HORIZONTAL)) / 100);
    this.assign(pNode0.GetRect());
    const aPos = pNode1.AlignTo(this, RectPos.Right, RectHorAlign.Center, RectVerAlign.Baseline);
    aPos.x += nDist;
    pNode1.MoveTo(aPos);
    this.ExtendBy(pNode1, RectCopyMBL.Xor);
  }
}

// calculate height and vertical offset of root sign suitable for 'rRect'
function lcl_GetHeightVerOffset(rRect: SmRect): { rHeight: number; rVerOffset: number } {
  const rVerOffset = Math.trunc((rRect.GetBottom() - rRect.GetAlignB()) / 2);
  return { rHeight: rRect.GetHeight() - rVerOffset, rVerOffset };
}

// calculate position of root extra
function lcl_GetExtraPos(rRootSymbol: SmRect, rExtra: SmRect): Point {
  const rSymSize = rRootSymbol.GetSize();
  const aPos = { x: rRootSymbol.GetLeft() + Math.trunc((rSymSize.width * 70) / 100), y: rRootSymbol.GetTop() + Math.trunc((rSymSize.height * 52) / 100) };
  // from this calculate topleft edge of 'rExtra'
  aPos.x -= rExtra.GetWidth() + rExtra.GetItalicRightSpace();
  aPos.y -= rExtra.GetHeight();
  // if there's enough space move a bit less to the right
  // examples: "nroot i a", "nroot j a"
  // (it looks better if we don't use italic-spaces here)
  const nX = rRootSymbol.GetLeft() + Math.trunc((rSymSize.width * 30) / 100);
  if (aPos.x > nX) aPos.x = nX;
  return aPos;
}

/** Root node: subnodes are the index (or null), the root symbol and the body. */
export class SmRootNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.Root, rNodeToken); }
  Argument(): SmNode | null { return this.GetSubNode(0); }
  Symbol(): SmRootSymbolNode { return this.GetSubNode(1) as SmRootSymbolNode; }
  Body(): SmNode { return this.GetSubNode(2)!; }
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    //! pExtra needs to have the smaller index than pRootSym in order to
    //! not to get the root symbol but the pExtra when clicking on it in the
    //! GraphicWindow. (That is because of the simplicity of the algorithm
    //! that finds the node corresponding to a mouseclick in the window.)
    const pExtra = this.GetSubNode(0), pRootSym = this.GetSubNode(1)!, pBody = this.GetSubNode(2)!;
    pBody.Arrange(rDev, rFormat);
    let { rHeight: nHeight, rVerOffset: nVerOffset } = lcl_GetHeightVerOffset(pBody);
    nHeight += Math.trunc((rFormat.GetDistance(DIS_ROOT) * this.GetFont().height) / 100);
    if (nHeight < 0) nHeight = 0;
    // font specialist advised to change the width first
    pRootSym.AdaptToY(rDev, nHeight);
    pRootSym.AdaptToX(rDev, pBody.GetItalicWidth());
    pRootSym.Arrange(rDev, rFormat);
    // Set the top and bottom of the root symbol to the top and bottom of its glyph bounding rect,
    // to get accurate position of the root symbol.
    const rRootSymRect = pRootSym.AsGlyphRect();
    pRootSym.SetTop(rRootSymRect.GetTop());
    pRootSym.SetBottom(rRootSymRect.GetBottom());
    const aPos = pRootSym.AlignTo(pBody, RectPos.Left, RectHorAlign.Center, RectVerAlign.Baseline);
    //! override calculated vertical position
    aPos.y = pRootSym.GetTop() + pBody.GetBottom() - pRootSym.GetBottom();
    aPos.y -= nVerOffset;
    pRootSym.MoveTo(aPos);
    if (pExtra) {
      pExtra.SetSize(rFormat.GetRelSize(SIZ_INDEX) / 100);
      pExtra.Arrange(rDev, rFormat);
      pExtra.MoveTo(lcl_GetExtraPos(pRootSym, pExtra));
    }
    this.assign(pBody.GetRect());
    this.ExtendBy(pRootSym, RectCopyMBL.This);
    if (pExtra) this.ExtendBy(pExtra, RectCopyMBL.This, true);
  }
}

/** Binary horizontal node: left operand, operator, right operand. */
export class SmBinHorNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.BinHor, rNodeToken); }
  Symbol(): SmNode { return this.GetSubNode(1)!; }
  LeftOperand(): SmNode { return this.GetSubNode(0)!; }
  RightOperand(): SmNode { return this.GetSubNode(2)!; }
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pLeft = this.LeftOperand(), pOper = this.Symbol(), pRight = this.RightOperand();
    pOper.SetSize(rFormat.GetRelSize(SIZ_OPERATOR) / 100);
    pLeft.Arrange(rDev, rFormat);
    pOper.Arrange(rDev, rFormat);
    pRight.Arrange(rDev, rFormat);
    const nDist = Math.trunc((pOper.GetWidth() * rFormat.GetDistance(DIS_HORIZONTAL)) / 100);
    this.assign(pLeft.GetRect());
    let aPos = pOper.AlignTo(this, RectPos.Right, RectHorAlign.Center, RectVerAlign.Baseline);
    aPos.x += nDist;
    pOper.MoveTo(aPos);
    this.ExtendBy(pOper, RectCopyMBL.Xor);
    aPos = pRight.AlignTo(this, RectPos.Right, RectHorAlign.Center, RectVerAlign.Baseline);
    aPos.x += nDist;
    pRight.MoveTo(aPos);
    this.ExtendBy(pRight, RectCopyMBL.Xor);
  }
}

/** Binary vertical node: a fraction (numerator, line, denominator). */
export class SmBinVerNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.BinVer, rNodeToken); }
  override GetLeftMost(): SmNode { return this; }
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pNum = this.GetSubNode(0)!, pLine = this.GetSubNode(1)!, pDenom = this.GetSubNode(2)!;
    const bIsTextmode = rFormat.IsTextmode();
    if (bIsTextmode) {
      const aFraction = rFormat.GetRelSize(SIZ_INDEX) / 100;
      pNum.SetSize(aFraction);
      pLine.SetSize(aFraction);
      pDenom.SetSize(aFraction);
    }
    pNum.Arrange(rDev, rFormat);
    pDenom.Arrange(rDev, rFormat);
    const nFontHeight = this.GetFont().height,
      nExtLen = Math.trunc((nFontHeight * rFormat.GetDistance(DIS_FRACTION)) / 100),
      nThick = Math.trunc((nFontHeight * rFormat.GetDistance(DIS_STROKEWIDTH)) / 100),
      nWidth = Math.max(pNum.GetItalicWidth(), pDenom.GetItalicWidth()),
      nNumDist = bIsTextmode ? 0 : Math.trunc((nFontHeight * rFormat.GetDistance(DIS_NUMERATOR)) / 100),
      nDenomDist = bIsTextmode ? 0 : Math.trunc((nFontHeight * rFormat.GetDistance(DIS_DENOMINATOR)) / 100);
    // font specialist advised to change the width first
    pLine.AdaptToY(rDev, nThick);
    pLine.AdaptToX(rDev, nWidth + 2 * nExtLen);
    pLine.Arrange(rDev, rFormat);
    // get horizontal alignment for numerator
    let eHorAlign = pNum.GetLeftMost().GetRectHorAlign();
    // move numerator to its position
    let aPos = pNum.AlignTo(pLine, RectPos.Top, eHorAlign, RectVerAlign.Baseline);
    aPos.y -= nNumDist;
    pNum.MoveTo(aPos);
    // get horizontal alignment for denominator
    eHorAlign = pDenom.GetLeftMost().GetRectHorAlign();
    // move denominator to its position
    aPos = pDenom.AlignTo(pLine, RectPos.Bottom, eHorAlign, RectVerAlign.Baseline);
    aPos.y += nDenomDist;
    pDenom.MoveTo(aPos);
    this.assign(pNum.GetRect());
    this.ExtendBy(pDenom, RectCopyMBL.None).ExtendBy(pLine, RectCopyMBL.None, pLine.GetCenterY());
  }
}

const Det = (r1: Point, r2: Point): number => r1.x * r2.y - r1.y * r2.x;

/// Is true iff the point 'rPoint1' belongs to the straight line through 'rPoint2'
/// and has the direction vector 'rHeading2'
function IsPointInLine(rPoint1: Point, rPoint2: Point, rHeading2: Point): boolean {
  const eps = 5.0 * Number.EPSILON;
  if (Math.abs(rHeading2.x) > Math.abs(rHeading2.y)) {
    const fLambda = (rPoint1.x - rPoint2.x) / rHeading2.x;
    return Math.abs(rPoint1.y - (rPoint2.y + fLambda * rHeading2.y)) < eps;
  }
  const fLambda = (rPoint1.y - rPoint2.y) / rHeading2.y;
  return Math.abs(rPoint1.x - (rPoint2.x + fLambda * rHeading2.x)) < eps;
}

function GetLineIntersectionPoint(rPoint1: Point, rHeading1: Point, rPoint2: Point, rHeading2: Point): Point {
  const eps = 5.0 * Number.EPSILON;
  // are the direction vectors linearly dependent?
  const fDet = Det(rHeading1, rHeading2);
  if (Math.abs(fDet) < eps) return IsPointInLine(rPoint1, rPoint2, rHeading2) ? rPoint1 : { x: 0, y: 0 };
  // here we do not pay attention to the computational accuracy
  // (that would be more complicated and is not really worth it in this case)
  const fLambda = ((rPoint1.y - rPoint2.y) * rHeading2.x - (rPoint1.x - rPoint2.x) * rHeading2.y) / fDet;
  return { x: rPoint1.x + Math.trunc(fLambda * rHeading1.x), y: rPoint1.y + Math.trunc(fLambda * rHeading1.y) };
}

/** Binary diagonal node: wideslash and widebslash; subnodes left, right, line. */
export class SmBinDiagonalNode extends SmStructureNode {
  mbAscending = false;
  constructor(rNodeToken: SmToken) { super(SmNodeType.BinDiagonal, rNodeToken); }
  IsAscending(): boolean { return this.mbAscending; }
  SetAscending(bVal: boolean): void { this.mbAscending = bVal; }

  /// @return position and size of the diagonal line
  /// premise: SmRect of the node defines the limitation(!) consequently it has to be known upfront
  GetOperPosSize(rDiagPoint: Point, fAngleDeg: number): { rPos: Point; rSize: { width: number; height: number } } {
    const fAngleRad = (fAngleDeg * Math.PI) / 180;
    const nRectLeft = this.GetItalicLeft(), nRectRight = this.GetItalicRight(), nRectTop = this.GetTop(), nRectBottom = this.GetBottom();
    const aRightHdg = { x: 100, y: 0 }, aDownHdg = { x: 0, y: 100 };
    const aDiagHdg = { x: Math.trunc(100.0 * Math.cos(fAngleRad)), y: Math.trunc(-100.0 * Math.sin(fAngleRad)) };
    let nLeft: number, nRight: number, nTop: number, nBottom: number; // margins of the rectangle for the diagonal
    let aPoint: Point;
    if (this.IsAscending()) {
      // determine top right corner
      aPoint = GetLineIntersectionPoint({ x: nRectLeft, y: nRectTop }, aRightHdg, rDiagPoint, aDiagHdg);
      // is there a point of intersection with the top border?
      if (aPoint.x <= nRectRight) { nRight = aPoint.x; nTop = nRectTop; }
      else {
        // there has to be a point of intersection with the right border!
        aPoint = GetLineIntersectionPoint({ x: nRectRight, y: nRectTop }, aDownHdg, rDiagPoint, aDiagHdg);
        nRight = nRectRight; nTop = aPoint.y;
      }
      // determine bottom left corner
      aPoint = GetLineIntersectionPoint({ x: nRectLeft, y: nRectBottom }, aRightHdg, rDiagPoint, aDiagHdg);
      // is there a point of intersection with the bottom border?
      if (aPoint.x >= nRectLeft) { nLeft = aPoint.x; nBottom = nRectBottom; }
      else {
        // there has to be a point of intersection with the left border!
        aPoint = GetLineIntersectionPoint({ x: nRectLeft, y: nRectTop }, aDownHdg, rDiagPoint, aDiagHdg);
        nLeft = nRectLeft; nBottom = aPoint.y;
      }
    } else {
      // determine top left corner
      aPoint = GetLineIntersectionPoint({ x: nRectLeft, y: nRectTop }, aRightHdg, rDiagPoint, aDiagHdg);
      // is there a point of intersection with the top border?
      if (aPoint.x >= nRectLeft) { nLeft = aPoint.x; nTop = nRectTop; }
      else {
        // there has to be a point of intersection with the left border!
        aPoint = GetLineIntersectionPoint({ x: nRectLeft, y: nRectTop }, aDownHdg, rDiagPoint, aDiagHdg);
        nLeft = nRectLeft; nTop = aPoint.y;
      }
      // determine bottom right corner
      aPoint = GetLineIntersectionPoint({ x: nRectLeft, y: nRectBottom }, aRightHdg, rDiagPoint, aDiagHdg);
      // is there a point of intersection with the bottom border?
      if (aPoint.x <= nRectRight) { nRight = aPoint.x; nBottom = nRectBottom; }
      else {
        // there has to be a point of intersection with the right border!
        aPoint = GetLineIntersectionPoint({ x: nRectRight, y: nRectTop }, aDownHdg, rDiagPoint, aDiagHdg);
        nRight = nRectRight; nBottom = aPoint.y;
      }
    }
    return { rSize: { width: nRight - nLeft + 1, height: nBottom - nTop + 1 }, rPos: { x: nLeft, y: nTop } };
  }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    // Both arguments have to get into the SubNodes before the Operator so that clicking
    // within the GraphicWindow sets the FormulaCursor correctly (cf. SmRootNode)
    const pLeft = this.GetSubNode(0)!, pRight = this.GetSubNode(1)!, pOper = this.GetSubNode(2) as SmPolyLineNode;
    rDev.SetFont(this.GetFont());
    pLeft.Arrange(rDev, rFormat);
    pRight.Arrange(rDev, rFormat);
    // determine implicitly the values (incl. the margin) of the diagonal line
    pOper.Arrange(rDev, rFormat);
    const nDelta = Math.trunc((pOper.GetLineWidth() * 8) / 10);
    // determine TopLeft position from the right argument
    const aPos = { x: pLeft.GetItalicRight() + nDelta + pRight.GetItalicLeftSpace(), y: 0 };
    if (this.IsAscending()) aPos.y = pLeft.GetBottom() + nDelta;
    else aPos.y = pLeft.GetTop() - nDelta - pRight.GetHeight();
    pRight.MoveTo(aPos);
    // determine new baseline
    const nTmpBaseline = this.IsAscending() ? Math.trunc((pLeft.GetBottom() + pRight.GetTop()) / 2) : Math.trunc((pLeft.GetTop() + pRight.GetBottom()) / 2);
    const aLogCenter = { x: Math.trunc((pLeft.GetItalicRight() + pRight.GetItalicLeft()) / 2), y: nTmpBaseline };
    this.assign(pLeft.GetRect());
    this.ExtendBy(pRight, RectCopyMBL.None);
    // determine position and size of diagonal line
    const { rPos, rSize } = this.GetOperPosSize(aLogCenter, this.IsAscending() ? 60.0 : -60.0);
    // font specialist advised to change the width first
    pOper.AdaptToY(rDev, rSize.height);
    pOper.AdaptToX(rDev, rSize.width);
    // and make it active
    pOper.Arrange(rDev, rFormat);
    pOper.MoveTo(rPos);
    this.ExtendBy(pOper, RectCopyMBL.None, nTmpBaseline);
  }
}

/** Super- and subscript node: the body, then the six positions of SmSubSup. */
export class SmSubSupNode extends SmStructureNode {
  mbUseLimits = false;
  constructor(rNodeToken: SmToken) { super(SmNodeType.SubSup, rNodeToken); }
  SetUseLimits(bVal: boolean): void { this.mbUseLimits = bVal; }
  IsUseLimits(): boolean { return this.mbUseLimits; }
  GetBody(): SmNode | null { return this.GetSubNode(0); }
  GetSubSup(eSubSup: SmSubSup): SmNode | null { return this.GetSubNode(1 + eSubSup); }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pBody = this.GetBody()!;
    const nOrigHeight = pBody.GetFont().height;
    pBody.Arrange(rDev, rFormat);
    const rBodyRect = pBody.GetRect();
    this.assign(rBodyRect);
    // line that separates sub- and supscript rectangles
    const nDelimLine = SmFromTo(this.GetAlignB(), this.GetAlignT(), 0.4);
    let aPos: Point;
    let nDelta: number, nDist: number;
    // iterate over all possible sub-/supscripts
    let aTmpRect = rBodyRect.GetRect();
    for (let i = 0; i < SUBSUP_NUM_ENTRIES; i++) {
      let eSubSup = i as SmSubSup;
      const pSubSup = this.GetSubSup(eSubSup);
      if (!pSubSup) continue;
      // switch position of limits if we are in textmode
      if (rFormat.IsTextmode() && this.GetToken().nGroup & TG.Limit) {
        if (eSubSup === SmSubSup.CSUB) eSubSup = SmSubSup.RSUB;
        else if (eSubSup === SmSubSup.CSUP) eSubSup = SmSubSup.RSUP;
      }
      // prevent sub-/supscripts from diminishing in size
      // (as would be in "a_{1_{2_{3_4}}}")
      if (this.GetFont().height > rFormat.GetBaseSize().height / 3) {
        const nIndex = eSubSup === SmSubSup.CSUB || eSubSup === SmSubSup.CSUP ? SIZ_LIMITS : SIZ_INDEX;
        pSubSup.SetSize(rFormat.GetRelSize(nIndex) / 100);
      }
      pSubSup.Arrange(rDev, rFormat);
      const bIsTextmode = rFormat.IsTextmode();
      nDist = 0;
      //! be sure that CSUB, CSUP are handled before the other cases!
      switch (eSubSup) {
        case SmSubSup.RSUB:
        case SmSubSup.LSUB:
          if (!bIsTextmode) nDist = Math.trunc((nOrigHeight * rFormat.GetDistance(DIS_SUBSCRIPT)) / 100);
          aPos = pSubSup.GetRect().AlignTo(aTmpRect, eSubSup === SmSubSup.LSUB ? RectPos.Left : RectPos.Right, RectHorAlign.Center, RectVerAlign.Bottom);
          aPos.y += nDist;
          nDelta = nDelimLine - aPos.y;
          if (nDelta > 0) aPos.y += nDelta;
          break;
        case SmSubSup.RSUP:
        case SmSubSup.LSUP:
          if (!bIsTextmode) nDist = Math.trunc((nOrigHeight * rFormat.GetDistance(DIS_SUPERSCRIPT)) / 100);
          aPos = pSubSup.GetRect().AlignTo(aTmpRect, eSubSup === SmSubSup.LSUP ? RectPos.Left : RectPos.Right, RectHorAlign.Center, RectVerAlign.Top);
          aPos.y -= nDist;
          nDelta = aPos.y + pSubSup.GetHeight() - nDelimLine;
          if (nDelta > 0) aPos.y -= nDelta;
          break;
        case SmSubSup.CSUB:
          if (!bIsTextmode) nDist = Math.trunc((nOrigHeight * rFormat.GetDistance(DIS_LOWERLIMIT)) / 100);
          aPos = pSubSup.GetRect().AlignTo(rBodyRect, RectPos.Bottom, RectHorAlign.Center, RectVerAlign.Baseline);
          aPos.y += nDist;
          break;
        default: // CSUP
          if (!bIsTextmode) nDist = Math.trunc((nOrigHeight * rFormat.GetDistance(DIS_UPPERLIMIT)) / 100);
          aPos = pSubSup.GetRect().AlignTo(rBodyRect, RectPos.Top, RectHorAlign.Center, RectVerAlign.Baseline);
          aPos.y -= nDist;
          break;
      }
      pSubSup.MoveTo(aPos);
      this.ExtendBy(pSubSup, RectCopyMBL.This, true);
      // update rectangle to which  RSUB, RSUP, LSUB, LSUP
      // will be aligned to
      if (eSubSup === SmSubSup.CSUB || eSubSup === SmSubSup.CSUP) aTmpRect = this.GetRect();
    }
  }
}

/** Node for brace construction: opening brace, body, closing brace. */
export class SmBraceNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.Brace, rNodeToken); }
  OpeningBrace(): SmMathSymbolNode { return this.GetSubNode(0) as SmMathSymbolNode; }
  Body(): SmNode { return this.GetSubNode(1)!; }
  ClosingBrace(): SmMathSymbolNode { return this.GetSubNode(2) as SmMathSymbolNode; }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pLeft = this.OpeningBrace(), pBody = this.Body(), pRight = this.ClosingBrace();
    pBody.Arrange(rDev, rFormat);
    const bIsScaleNormal = rFormat.IsScaleNormalBrackets(),
      bScale = pBody.GetHeight() > 0 && (this.GetScaleMode() === SmScaleMode.Height || bIsScaleNormal),
      bIsABS = this.GetToken().eType === T.TABS;
    const nFaceHeight = this.GetFont().height;
    // determine oversize in %
    let nPerc = 0;
    if (!bIsABS && bScale) {
      // in case of oversize braces...
      const nIndex = this.GetScaleMode() === SmScaleMode.Height ? DIS_BRACKETSIZE : DIS_NORMALBRACKETSIZE;
      nPerc = rFormat.GetDistance(nIndex);
    }
    // determine the height for the braces
    let nBraceHeight: number;
    if (bScale) {
      nBraceHeight = pBody.GetType() === SmNodeType.Bracebody ? (pBody as SmBracebodyNode).GetBodyHeight() : pBody.GetHeight();
      nBraceHeight += 2 * Math.trunc((nBraceHeight * nPerc) / 100);
    } else nBraceHeight = nFaceHeight;
    // distance to the argument
    nPerc = bIsABS ? 0 : rFormat.GetDistance(DIS_BRACKETSPACE);
    const nDist = Math.trunc((nFaceHeight * nPerc) / 100);
    // if wanted, scale the braces to the wanted size
    if (bScale) {
      const aTmpSize = pLeft.GetFont().GetFontSize();
      aTmpSize.width = Math.min(Math.trunc((nBraceHeight * 60) / 100), Math.trunc((rFormat.GetBaseSize().height * 3) / 2));
      // correction factor since change from StarMath to OpenSymbol font
      // because of the different font width in the FontMetric
      aTmpSize.width = Math.trunc((aTmpSize.width * 182) / 267);
      const isLine = (c: number | undefined) => c === MS_LINE || c === MS_DLINE || c === MS_VERTLINE || c === MS_DVERTLINE;
      if (!isLine(pLeft.GetToken().cMathChar.charCodeAt(0))) pLeft.GetFont().SetSize(aTmpSize.width, aTmpSize.height);
      if (!isLine(pRight.GetToken().cMathChar.charCodeAt(0))) pRight.GetFont().SetSize(aTmpSize.width, aTmpSize.height);
      pLeft.AdaptToY(rDev, nBraceHeight);
      pRight.AdaptToY(rDev, nBraceHeight);
    }
    pLeft.Arrange(rDev, rFormat);
    pRight.Arrange(rDev, rFormat);
    // required in order to make "\(a\) - (a) - left ( a right )" look alright
    const eVerAlign = bScale ? RectVerAlign.CenterY : RectVerAlign.Baseline;
    let aPos = pLeft.AlignTo(pBody, RectPos.Left, RectHorAlign.Center, eVerAlign);
    aPos.x -= nDist;
    pLeft.MoveTo(aPos);
    aPos = pRight.AlignTo(pBody, RectPos.Right, RectHorAlign.Center, eVerAlign);
    aPos.x += nDist;
    pRight.MoveTo(aPos);
    this.assign(pBody.GetRect());
    this.ExtendBy(pLeft, RectCopyMBL.This).ExtendBy(pRight, RectCopyMBL.This);
  }
}

/** Body of an SmBraceNode: expressions and separators (mline). */
export class SmBracebodyNode extends SmStructureNode {
  mnBodyHeight = 0;
  constructor(rNodeToken: SmToken) { super(SmNodeType.Bracebody, rNodeToken); }
  GetBodyHeight(): number { return this.mnBodyHeight; }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const nNumSubNodes = this.GetNumSubNodes();
    if (nNumSubNodes === 0) return;
    // arrange arguments
    for (let i = 0; i < nNumSubNodes; i += 2) this.GetSubNode(i)!.Arrange(rDev, rFormat);
    // build reference rectangle with necessary info for vertical alignment
    const aRefRect = this.GetSubNode(0)!.GetRect();
    for (let i = 0; i < nNumSubNodes; i += 2) {
      const aTmpRect = this.GetSubNode(i)!.GetRect();
      const aPos = aTmpRect.AlignTo(aRefRect, RectPos.Right, RectHorAlign.Center, RectVerAlign.Baseline);
      aTmpRect.MoveTo(aPos);
      aRefRect.ExtendBy(aTmpRect, RectCopyMBL.Xor);
    }
    this.mnBodyHeight = aRefRect.GetHeight();
    // scale separators to required height and arrange them
    const bScale = this.GetScaleMode() === SmScaleMode.Height || rFormat.IsScaleNormalBrackets();
    let nHeight = bScale ? aRefRect.GetHeight() : this.GetFont().height;
    const nIndex = this.GetScaleMode() === SmScaleMode.Height ? DIS_BRACKETSIZE : DIS_NORMALBRACKETSIZE;
    const nPerc = rFormat.GetDistance(nIndex);
    if (bScale) nHeight += 2 * Math.trunc((nHeight * nPerc) / 100);
    for (let i = 1; i < nNumSubNodes; i += 2) {
      const pNode = this.GetSubNode(i)!;
      pNode.AdaptToY(rDev, nHeight);
      pNode.Arrange(rDev, rFormat);
    }
    // horizontal distance between argument and brackets or separators
    const nDist = Math.trunc((this.GetFont().height * rFormat.GetDistance(DIS_BRACKETSPACE)) / 100);
    let pLeft = this.GetSubNode(0)!;
    this.assign(pLeft.GetRect());
    for (let i = 1; i < nNumSubNodes; ++i) {
      const bIsSeparator = i % 2 !== 0;
      const eVerAlign = bIsSeparator ? RectVerAlign.CenterY : RectVerAlign.Baseline;
      const pRight = this.GetSubNode(i)!;
      const aPosX = pRight.AlignTo(pLeft, RectPos.Right, RectHorAlign.Center, eVerAlign),
        aPosY = pRight.AlignTo(aRefRect, RectPos.Right, RectHorAlign.Center, eVerAlign);
      aPosX.x += nDist;
      pRight.MoveTo({ x: aPosX.x, y: aPosY.y });
      this.ExtendBy(pRight, bIsSeparator ? RectCopyMBL.This : RectCopyMBL.Xor);
      pLeft = pRight;
    }
  }
}

/** Node for vertical brace construction: overbrace and underbrace. */
export class SmVerticalBraceNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.VerticalBrace, rNodeToken); }
  Body(): SmNode { return this.GetSubNode(0)!; }
  Brace(): SmMathSymbolNode { return this.GetSubNode(1) as SmMathSymbolNode; }
  Script(): SmNode { return this.GetSubNode(2)!; }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pBody = this.Body(), pBrace = this.Brace(), pScript = this.Script();
    rDev.SetFont(this.GetFont());
    pBody.Arrange(rDev, rFormat);
    // size is the same as for limits for this part
    pScript.SetSize(rFormat.GetRelSize(SIZ_LIMITS) / 100);
    // braces are a bit taller than usually
    pBrace.SetSize(3 / 2);
    const nItalicWidth = pBody.GetItalicWidth();
    if (nItalicWidth > 0) pBrace.AdaptToX(rDev, nItalicWidth);
    pBrace.Arrange(rDev, rFormat);
    pScript.Arrange(rDev, rFormat);
    // determine the relative position and the distances between each other
    let eRectPos: RectPos;
    const nFontHeight = pBody.GetFont().height;
    let nDistBody = nFontHeight * rFormat.GetDistance(DIS_ORNAMENTSIZE), nDistScript = nFontHeight;
    if (this.GetToken().eType === T.TOVERBRACE) {
      eRectPos = RectPos.Top;
      nDistBody = -nDistBody;
      nDistScript *= -rFormat.GetDistance(DIS_UPPERLIMIT);
    } else { // TUNDERBRACE
      eRectPos = RectPos.Bottom;
      nDistScript *= +rFormat.GetDistance(DIS_LOWERLIMIT);
    }
    nDistBody = Math.trunc(nDistBody / 100);
    nDistScript = Math.trunc(nDistScript / 100);
    let aPos = pBrace.AlignTo(pBody, eRectPos, RectHorAlign.Center, RectVerAlign.Baseline);
    aPos.y += nDistBody;
    pBrace.MoveTo(aPos);
    aPos = pScript.AlignTo(pBrace, eRectPos, RectHorAlign.Center, RectVerAlign.Baseline);
    aPos.y += nDistScript;
    pScript.MoveTo(aPos);
    this.assign(pBody.GetRect());
    this.ExtendBy(pBrace, RectCopyMBL.This).ExtendBy(pScript, RectCopyMBL.This);
  }
}

/** Operation Node: sum, integral, lim ... with their limits, and the body. */
export class SmOperNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.Oper, rNodeToken); }

  GetSymbol(): SmNode {
    let pNode = this.GetSubNode(0)!;
    if (pNode.GetType() === SmNodeType.SubSup) pNode = (pNode as SmSubSupNode).GetBody()!;
    return pNode;
  }

  // returns the font height to be used for operator-symbol
  CalcSymbolHeight(rSymbol: SmNode, rFormat: SmFormat): number {
    let nHeight = this.GetFont().height;
    const eTmpType = this.GetToken().eType;
    if (eTmpType === T.TLIM || eTmpType === T.TLIMINF || eTmpType === T.TLIMSUP) return nHeight;
    if (!rFormat.IsTextmode()) {
      // set minimum size ()
      nHeight += Math.trunc((nHeight * 20) / 100);
      nHeight += Math.trunc((nHeight * rFormat.GetDistance(DIS_OPERATORSIZE)) / 100);
      nHeight = Math.trunc((nHeight * 686) / 845);
    }
    // correct user-defined symbols to match height of sum from used font
    if (rSymbol.GetToken().eType === T.TSPECIAL) nHeight = Math.trunc((nHeight * 845) / 686);
    return nHeight;
  }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pOper = this.GetSubNode(0)!, pBody = this.GetSubNode(1)!;
    const pSymbol = this.GetSymbol();
    pSymbol.SetSize(this.CalcSymbolHeight(pSymbol, rFormat) / pSymbol.GetFont().height);
    pBody.Arrange(rDev, rFormat);
    let bDynamicallySized = false;
    if (pSymbol.GetToken().eType === T.TINTD) {
      const nBodyHeight = pBody.GetHeight(), nFontHeight = pSymbol.GetFont().height;
      if (nFontHeight < nBodyHeight) {
        pSymbol.SetSize(nBodyHeight / nFontHeight);
        bDynamicallySized = true;
      }
    }
    pOper.Arrange(rDev, rFormat);
    const nOrigHeight = this.GetFont().height, nDist = Math.trunc((nOrigHeight * rFormat.GetDistance(DIS_OPERATORSPACE)) / 100);
    const aPos = pOper.AlignTo(pBody, RectPos.Left, RectHorAlign.Center, bDynamicallySized ? RectVerAlign.CenterY : RectVerAlign.Mid);
    aPos.x -= nDist;
    pOper.MoveTo(aPos);
    this.assign(pBody.GetRect());
    this.ExtendBy(pOper, RectCopyMBL.This);
  }
}

/** Node used for alignment: alignl, alignc, alignr. */
export class SmAlignNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.Align, rNodeToken); }
  // set alignment within the entire subtree (including current node)
  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pNode = this.GetSubNode(0)!;
    let eHorAlign: RectHorAlign = RectHorAlign.Center;
    switch (this.GetToken().eType) {
      case T.TALIGNL: eHorAlign = RectHorAlign.Left; break;
      case T.TALIGNC: eHorAlign = RectHorAlign.Center; break;
      case T.TALIGNR: eHorAlign = RectHorAlign.Right; break;
      default: break;
    }
    this.SetRectHorAlign(eHorAlign);
    pNode.Arrange(rDev, rFormat);
    this.assign(pNode.GetRect());
  }
}

/** Attribute node: accents, lines and wide attributes over or under the body. */
export class SmAttributeNode extends SmStructureNode {
  constructor(rNodeToken: SmToken) { super(SmNodeType.Attribute, rNodeToken); }
  Attribute(): SmNode { return this.GetSubNode(0)!; }
  Body(): SmNode { return this.GetSubNode(1)!; }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pAttr = this.Attribute(), pBody = this.Body();
    pBody.Arrange(rDev, rFormat);
    if (this.GetScaleMode() === SmScaleMode.Width) pAttr.AdaptToX(rDev, pBody.GetItalicWidth());
    pAttr.Arrange(rDev, rFormat);
    // get relative position of attribute
    let eVerAlign: RectVerAlign;
    let nDist = 0;
    switch (this.GetToken().eType) {
      case T.TUNDERLINE: eVerAlign = RectVerAlign.AttributeLo; break;
      case T.TOVERSTRIKE: eVerAlign = RectVerAlign.AttributeMid; break;
      default:
        eVerAlign = RectVerAlign.AttributeHi;
        if (pBody.GetType() === SmNodeType.Attribute) nDist = Math.trunc((this.GetFont().height * rFormat.GetDistance(DIS_ORNAMENTSPACE)) / 100);
    }
    const aPos = pAttr.AlignTo(pBody, RectPos.Attribute, RectHorAlign.Center, eVerAlign);
    aPos.y -= nDist;
    pAttr.MoveTo(aPos);
    this.assign(pBody.GetRect());
    this.ExtendBy(pAttr, RectCopyMBL.This, true);
  }
}

/** Font node: bold, italic, size, color, font ... applied to the body (subnode 1). */
export class SmFontNode extends SmStructureNode {
  meSizeType: FontSizeType = FontSizeType.MULTIPLY;
  maFontSize = 1;
  constructor(rNodeToken: SmToken) { super(SmNodeType.Font, rNodeToken); }
  SetSizeParameter(rValue: number, eType: FontSizeType): void { this.meSizeType = eType; this.maFontSize = rValue; }
  GetSizeParameter(): number { return this.maFontSize; }
  GetSizeType(): FontSizeType { return this.meSizeType; }

  override Prepare(rFormat: SmFormat, nDepth: number): void {
    //! prepare subnodes first
    super.Prepare(rFormat, nDepth);
    let nFnt = -1;
    switch (this.GetToken().eType) {
      case T.TFIXED: nFnt = FNT_FIXED; break;
      case T.TSANS: nFnt = FNT_SANS; break;
      case T.TSERIF: nFnt = FNT_SERIF; break;
      default: break;
    }
    if (nFnt !== -1) {
      this.maFace = rFormat.GetFont(nFnt).clone();
      this.SetFont(this.GetFont());
    }
    //! prevent overwrites of this font by 'Arrange' or 'SetFont' calls of
    //! other font nodes (those with lower depth in the tree)
    this.mnFlags |= FontChangeMask.Face;
  }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    const pNode = this.GetSubNode(1)!;
    switch (this.GetToken().eType) {
      case T.TSIZE: pNode.SetFontSize(this.maFontSize, this.meSizeType); break;
      case T.TSANS: case T.TSERIF: case T.TFIXED: pNode.SetFont(this.GetFont()); break;
      case T.TUNKNOWN: break; // no assertion on "font <?> <?>"
      case T.TPHANTOM: this.SetPhantom(true); break;
      case T.TBOLD: this.SetAttribute(FontAttribute.Bold); break;
      case T.TITALIC: this.SetAttribute(FontAttribute.Italic); break;
      case T.TNBOLD: this.ClearAttribute(FontAttribute.Bold); break;
      case T.TNITALIC: this.ClearAttribute(FontAttribute.Italic); break;
      // Using HTML CSS Level 1 standard
      case T.TRGB: case T.TRGBA: case T.THTMLCOL: case T.TMATHMLCOL: case T.TDVIPSNAMESCOL: case T.TICONICCOL: case T.THEX:
        this.SetColor(ColorOf(this.GetToken().cMathChar));
        break;
      default: break;
    }
    pNode.Arrange(rDev, rFormat);
    this.assign(pNode.GetRect());
  }
}

/** Matrix node: rows × columns of expressions. */
export class SmMatrixNode extends SmStructureNode {
  mnNumRows = 0;
  mnNumCols = 0;
  constructor(rNodeToken: SmToken) { super(SmNodeType.Matrix, rNodeToken); }
  GetNumRows(): number { return this.mnNumRows; }
  GetNumCols(): number { return this.mnNumCols; }
  SetRowCol(nMatrixRows: number, nMatrixCols: number): void { this.mnNumRows = nMatrixRows; this.mnNumCols = nMatrixCols; }
  override GetLeftMost(): SmNode { return this; }

  override Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    // initialize array that is to hold the maximum widths of all
    // elements (subnodes) in that column.
    const aColWidth: number[] = new Array(this.mnNumCols).fill(0);
    // arrange subnodes and calculate the above arrays contents
    const nNodes = this.GetNumSubNodes();
    for (let i = 0; i < nNodes; ++i) {
      const nIdx = nNodes - 1 - i;
      const pNode = this.GetSubNode(nIdx);
      if (pNode) {
        pNode.Arrange(rDev, rFormat);
        const nCol = nIdx % this.mnNumCols;
        aColWidth[nCol] = Math.max(aColWidth[nCol]!, pNode.GetItalicWidth());
      }
    }
    // norm distance from which the following two are calculated
    const nNormDist = 3 * this.GetFont().height;
    // define horizontal and vertical minimal distances that separate
    // the elements
    const nHorDist = Math.trunc((nNormDist * rFormat.GetDistance(DIS_MATRIXCOL)) / 100),
      nVerDist = Math.trunc((nNormDist * rFormat.GetDistance(DIS_MATRIXROW)) / 100);
    // build array that holds the leftmost position for each column
    const aColLeft: number[] = [];
    let nX = 0;
    for (let j = 0; j < this.mnNumCols; ++j) {
      aColLeft[j] = nX;
      nX += aColWidth[j]! + nHorDist;
    }
    this.assign(new SmRect());
    for (let i = 0; i < this.mnNumRows; ++i) {
      let aPos: Point;
      const aLineRect = new SmRect();
      for (let j = 0; j < this.mnNumCols; ++j) {
        const pTmpNode = this.GetSubNode(i * this.mnNumCols + j);
        if (!pTmpNode) continue;
        // align all baselines in that row if possible
        aPos = pTmpNode.AlignTo(aLineRect, RectPos.Right, RectHorAlign.Center, RectVerAlign.Baseline);
        // get horizontal alignment
        const eHorAlign = pTmpNode.GetLeftMost().GetRectHorAlign();
        // calculate horizontal position of element depending on column
        // and horizontal alignment
        switch (eHorAlign) {
          case RectHorAlign.Left: aPos.x = aColLeft[j]!; break;
          case RectHorAlign.Center: aPos.x = pTmpNode.GetLeft() + aColLeft[j]! + Math.trunc(aColWidth[j]! / 2) - pTmpNode.GetItalicCenterX(); break;
          case RectHorAlign.Right: aPos.x = aColLeft[j]! + aColWidth[j]! - pTmpNode.GetItalicWidth(); break;
        }
        pTmpNode.MoveTo(aPos);
        aLineRect.ExtendBy(pTmpNode, RectCopyMBL.Xor);
      }
      aPos = aLineRect.AlignTo(this, RectPos.Bottom, RectHorAlign.Center, RectVerAlign.Baseline);
      if (i > 0) aPos.y += nVerDist;
      // move 'aLineRect' and rectangles in that line to final position
      const aDelta = { x: 0, // since horizontal alignment is already done
        y: aPos.y - aLineRect.GetTop() };
      aLineRect.Move(aDelta);
      for (let j = 0; j < this.mnNumCols; ++j) this.GetSubNode(i * this.mnNumCols + j)?.Move(aDelta);
      this.ExtendBy(aLineRect, RectCopyMBL.None);
    }
  }
}

/** Blank node: ~ and ` spaces. */
export class SmBlankNode extends SmGraphicNode {
  mnNum = 0;
  constructor(rNodeToken: SmToken) { super(SmNodeType.Blank, rNodeToken); }
  IncreaseBy(rToken: SmToken, nMultiplyBy = 1): void {
    switch (rToken.eType) {
      case T.TBLANK: this.mnNum += 4 * nMultiplyBy; break;
      case T.TSBLANK: this.mnNum += 1 * nMultiplyBy; break;
      default: break;
    }
  }
  Clear(): void { this.mnNum = 0; }
  GetBlankNum(): number { return this.mnNum; }
  SetBlankNum(nNumber: number): void { this.mnNum = nNumber; }

  override Prepare(rFormat: SmFormat, nDepth: number): void {
    super.Prepare(rFormat, nDepth);
    // Here it need/should not be the StarMath font, so that for the character
    // used in Arrange a normal (non-clipped) rectangle is generated
    this.maFace = rFormat.GetFont(FNT_VARIABLE).clone();
    this.mnFlags |= FontChangeMask.Face | FontChangeMask.Bold | FontChangeMask.Italic;
  }

  Arrange(rDev: SmDevice, rFormat: SmFormat): void {
    rDev.SetFont(this.GetFont());
    // make distance depend on the font height
    // (so that it increases when scaling (e.g. size *2 {a ~ b})
    const nDist = Math.trunc(this.GetFont().height / 10), nSpace = this.mnNum * nDist;
    // get a SmRect with Baseline and all the bells and whistles
    this.assign(SmRect.Text(rDev, rFormat, ' ', this.GetFont().GetBorderWidth()));
    // and resize it to the requested size
    this.SetItalicSpaces(0, 0);
    this.SetWidth(nSpace);
  }
}
