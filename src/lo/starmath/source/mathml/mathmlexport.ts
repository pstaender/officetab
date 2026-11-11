// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/mathml/mathmlexport.cxx partial
// @upstream starmath/source/mathml/starmathdatabase.cxx partial
// SmXMLExport's content export: the content.xml of a formula object, presentation MathML in a
// <semantics> element with the StarMath text as its annotation, exactly as LibreOffice writes it.
//
// The node exports (ExportContent_ to ExportNodes) are statement by statement. The SAX writer
// (sax/source/expatwrap/saxwriter.cxx) is reduced to what the export uses: no pretty printing (the
// UsePrettyPrinting default), empty elements as `<x/>`, its escaping of characters and attribute
// values. SvXMLElementExport's constructor and destructor become StartElement and EndElement calls.
//
// Left out: SmXMLExportWrapper (the storage and the meta.xml and settings.xml streams), the view and
// configuration settings, the encrypted-storage chaff and the custom HTML entity names. The tree is
// arranged as SmDocShell's is (font sizes and attributes are set in Arrange) but on a measurer of
// fixed advance widths, since the export reads fonts, not positions. The symbol name conversion of
// the annotation (rParser->SetExportSymbolNames) keeps the names: this parser knows only the
// English names, which are the export names. The StarMath syntax version is always 5.
// Of starmathdatabase only aColorTokenTableMATHML and Identify_Color_MATHML are ported.

import { T, type SmTokenType } from '../../inc/token.ts';
import { MS_BACKSLASH } from '../../inc/types.ts';
import { IsItalic, SmDevice, SmFormat } from '../format.ts';
import {
  FontSizeType, SmNodeType, SmScaleMode, SmSubSup, type SmBinHorNode, type SmBlankNode, type SmFontNode,
  type SmMatrixNode, type SmNode, type SmTextNode, type SmVerticalBraceNode,
} from '../node.ts';
import { SmParser5 } from '../parse5.ts';
import type { TextMeasurer } from '../../../vcl/source/outdev/text.ts';

const { CSUB, CSUP, RSUB, RSUP, LSUB, LSUP } = SmSubSup;

// xmloff/source/core/xmltoken.cxx: XML_N_MATH
const XML_N_MATH = 'http://www.w3.org/1998/Math/MathML';

// starmath/source/mathml/starmathdatabase.cxx

interface SmColorTokenTableEntry { aIdent: string; eType: SmTokenType; cColor: number }

const aColorTokenTableMATHML: SmColorTokenTableEntry[] = ([
  ['aqua', 0x00FFFF], ['black', 0x000000], ['blue', 0x0000FF], ['fuchsia', 0xFF00FF], ['gray', 0x808080],
  ['green', 0x008000], ['lime', 0x00FF00], ['maroon', 0x800000], ['navy', 0x000080], ['olive', 0x808000],
  ['purple', 0x800080], ['red', 0xFF0000], ['silver', 0xC0C0C0], ['teal', 0x008080], ['white', 0xFFFFFF],
  ['yellow', 0xFFFF00],
] as const).map(([aIdent, cColor]) => ({ aIdent, eType: T.TMATHMLCOL, cColor }));

function Identify_Color_MATHML(cColor: number): SmColorTokenTableEntry {
  for (const i of aColorTokenTableMATHML) if (i.cColor === cColor) return i;
  if (((cColor & 0x00FFFFFF) >>> 0) === cColor) return { aIdent: '', eType: T.TRGB, cColor };
  else return { aIdent: '', eType: T.TRGBA, cColor };
}

// helpers

function IsInPrivateUseArea(cChar: number): boolean { return 0xE000 <= cChar && cChar <= 0xF8FF; }

function ConvertMathToMathML(rText: string, nIndex = 0): number {
  let cRes = rText.codePointAt(nIndex) ?? 0;
  if (IsInPrivateUseArea(cRes)) {
    // "Error: private use area characters should no longer be in use!"
    cRes = 0x40; // just some character that should easily be notice as odd in the context
  }
  return cRes;
}

/**
 * sax::Converter::convertDouble: rtl::math::doubleToUString with rtl_math_StringFormat_Automatic
 * and rtl_math_DecimalPlaces_Max, that is 15 significant digits, trailing zeros removed.
 */
function convertDouble(fNumber: number): string {
  return String(Number(fNumber.toPrecision(15)));
}

/** Color::AsRGBHEXString */
const AsRGBHEXString = (nColor: number): string => (nColor & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');

/** SaxWriterHelper::convertToXML: character data (bNormalizeWhitespace false) and attribute values. */
function convertToXML(s: string, bNormalizeWhitespace: boolean): string {
  let r = '';
  for (const c of s) {
    switch (c) {
      case '&': r += '&amp;'; break;
      case '<': r += '&lt;'; break;
      case '>': r += '&gt;'; break;
      case '\'': r += '&apos;'; break;
      case '"': r += '&quot;'; break;
      case '\r': r += '&#x0d;'; break;
      case '\n': r += bNormalizeWhitespace ? '&#x0a;' : '\n'; break;
      case '\t': r += bNormalizeWhitespace ? '&#x09;' : '\t'; break;
      default: r += c;
    }
  }
  return r;
}

/**
 * The reference device the formula is arranged on: fixed advance widths. Positions are not
 * exported, only the fonts that Arrange sets.
 */
const aFixedMeasurer: TextMeasurer = {
  GetTextWidth: (font, text) => Math.round(font.size * 0.5 * [...text].length),
  GetFontMetric: (font) => ({ ascent: Math.round(font.size * 0.8), descent: Math.round(font.size * 0.2) }),
};

const lcl_HasEffectOnMathvariant = (eType: SmTokenType): boolean =>
  eType === T.TBOLD || eType === T.TNBOLD || eType === T.TITALIC || eType === T.TNITALIC ||
  eType === T.TSANS || eType === T.TSERIF || eType === T.TFIXED;

export class SmXMLExport {
  pTree: SmNode | null = null;
  aText = '';
  bSuccess = false;
  private maFormat: SmFormat;

  // the SAX writer (XDocumentHandler) and the pending attribute list (GetAttrList())
  private maOut: string[] = [];
  private maAttrList: [string, string][] = [];
  private mbStartTagOpen = false;

  constructor(rFormat: SmFormat = new SmFormat()) {
    this.maFormat = rFormat;
  }

  /** The output: the XML declaration, a line feed and the document. */
  GetOutput(): string { return this.maOut.join(''); }
  GetSuccess(): boolean { return this.bSuccess; }

  // SAXWriter

  private startDocument(): void { this.maOut.push('<?xml version="1.0" encoding="UTF-8"?>\n'); }
  private endDocument(): void {}

  private closeStartTag(): void {
    if (this.mbStartTagOpen) {
      this.maOut.push('>');
      this.mbStartTagOpen = false;
    }
  }

  private characters(aChars: string): void {
    if (aChars.length) {
      this.closeStartTag();
      this.maOut.push(convertToXML(aChars, false));
    }
  }

  // SvXMLExport

  AddAttribute(sName: string, rValue: string): void { this.maAttrList.push([sName, rValue]); }

  /** SvXMLElementExport's constructor: starts the element with the attributes added so far. */
  private StartElement(sName: string): void {
    this.closeStartTag();
    let s = '<' + sName;
    for (const [n, v] of this.maAttrList) s += ' ' + n + '="' + convertToXML(v, true) + '"';
    this.maAttrList = [];
    this.maOut.push(s);
    this.mbStartTagOpen = true;
  }

  /** SvXMLElementExport's destructor. */
  private EndElement(sName: string): void {
    if (this.mbStartTagOpen) {
      this.maOut.push('/>');
      this.mbStartTagOpen = false;
    } else this.maOut.push('</' + sName + '>');
  }

  /** exportDoc for the content (SvXMLExportFlags::CONTENT). */
  exportDoc(pTree: SmNode | null, aText: string): number {
    this.pTree = pTree;
    this.aText = aText;

    this.startDocument();

    /*Add xmlns line*/
    // make use of a default namespace
    this.AddAttribute('xmlns', XML_N_MATH);

    //I think we need something like ImplExportEntities();
    this.ExportContent_();
    this.endDocument();

    this.bSuccess = true;
    return 0;
  }

  ExportContent_(): void {
    if (!this.maFormat.IsTextmode()) {
      // If the Math equation is not in text mode, we attach a display="block"
      // attribute on the <math> root. We don't do anything if it is in
      // text mode, the default display="inline" value will be used.
      this.AddAttribute('display', 'block');
    }
    if (this.maFormat.IsRightToLeft()) {
      // If the Math equation is set right-to-left, we attach a dir="rtl"
      // attribute on the <math> root. We don't do anything if it is set
      // left-to-right, the default dir="ltr" value will be used.
      this.AddAttribute('dir', 'rtl');
    }

    this.StartElement('math'); // aEquation
    let pSemantics = false;

    if (this.aText.length) {
      this.StartElement('semantics');
      pSemantics = true;
    }

    this.ExportNodes(this.pTree, 0);

    if (!this.aText.length) {
      this.EndElement('math');
      return;
    }

    const nSmSyntaxVersion: number = 5;

    // Convert symbol names
    {
      const rParser = new SmParser5();
      rParser.Parse(this.aText);
      this.aText = rParser.m_aBufferString;
    }

    let sStrBuf = 'StarMath ';
    if (nSmSyntaxVersion === 5) sStrBuf += '5.0';
    else sStrBuf += String(nSmSyntaxVersion);

    this.AddAttribute('encoding', sStrBuf);
    this.StartElement('annotation'); // aAnnotation
    this.characters(this.aText);
    this.EndElement('annotation');
    if (pSemantics) this.EndElement('semantics');
    this.EndElement('math');
  }

  ExportLine(pNode: SmNode, nLevel: number): void { this.ExportExpression(pNode, nLevel); }

  ExportBinaryHorizontal(pNode: SmNode, nLevel: number): void {
    const nGroup = pNode.GetToken().nGroup;

    this.StartElement('mrow'); // aRow

    // Unfold the binary tree structure as long as the nodes are SmBinHorNode
    // with the same nGroup. This will reduce the number of nested <mrow>
    // elements e.g. we only need three <mrow> levels to export

    // "a*b*c*d+e*f*g*h+i*j*k*l = a*b*c*d+e*f*g*h+i*j*k*l =
    //  a*b*c*d+e*f*g*h+i*j*k*l = a*b*c*d+e*f*g*h+i*j*k*l"

    // See https://www.libreoffice.org/bugzilla/show_bug.cgi?id=66081
    const s: (SmNode | null)[] = [];
    s.push(pNode);
    while (s.length) {
      const node = s.pop()!;
      if (node === null || node.GetType() !== SmNodeType.BinHor || node.GetToken().nGroup !== nGroup) {
        this.ExportNodes(node, nLevel + 1);
        continue;
      }
      const binNode = node as SmBinHorNode;
      s.push(binNode.GetSubNode(2)); // RightOperand()
      s.push(binNode.GetSubNode(1)); // Symbol()
      s.push(binNode.GetSubNode(0)); // LeftOperand()
    }
    this.EndElement('mrow');
  }

  ExportUnaryHorizontal(pNode: SmNode, nLevel: number): void {
    this.ExportExpression(pNode, nLevel);
  }

  ExportExpression(pNode: SmNode, nLevel: number, bNoMrowContainer = false): void {
    let pRow = false;
    const nSize = pNode.GetNumSubNodes();

    // #i115443: nodes of type expression always need to be grouped with mrow statement
    if (!bNoMrowContainer && (nSize > 1 || pNode.GetType() === SmNodeType.Expression)) {
      this.StartElement('mrow');
      pRow = true;
    }

    for (let i = 0; i < nSize; ++i) {
      const pTemp = pNode.GetSubNode(i);
      if (pTemp) this.ExportNodes(pTemp, nLevel + 1);
    }
    if (pRow) this.EndElement('mrow');
  }

  ExportBinaryVertical(pNode: SmNode, nLevel: number): void {
    // assert(pNode->GetNumSubNodes() == 3);
    const pNum = pNode.GetSubNode(0)!;
    const pDenom = pNode.GetSubNode(2)!;
    if (pNum.GetType() === SmNodeType.Align && pNum.GetToken().eType !== T.TALIGNC) {
      // A left or right alignment is specified on the numerator:
      // attach the corresponding numalign attribute.
      this.AddAttribute('numalign', pNum.GetToken().eType === T.TALIGNL ? 'left' : 'right');
    }
    if (pDenom.GetType() === SmNodeType.Align && pDenom.GetToken().eType !== T.TALIGNC) {
      // A left or right alignment is specified on the denominator:
      // attach the corresponding denomalign attribute.
      this.AddAttribute('denomalign', pDenom.GetToken().eType === T.TALIGNL ? 'left' : 'right');
    }
    this.StartElement('mfrac'); // aFraction
    this.ExportNodes(pNum, nLevel);
    this.ExportNodes(pDenom, nLevel);
    this.EndElement('mfrac');
  }

  ExportBinaryDiagonal(pNode: SmNode, nLevel: number): void {
    // assert(pNode->GetNumSubNodes() == 3);

    if (pNode.GetToken().eType === T.TWIDESLASH) {
      // wideslash
      // export the node as <mfrac bevelled="true">
      this.AddAttribute('bevelled', 'true');
      this.StartElement('mfrac'); // aFraction
      this.ExportNodes(pNode.GetSubNode(0), nLevel);
      this.ExportNodes(pNode.GetSubNode(1), nLevel);
      this.EndElement('mfrac');
    } else {
      // widebslash
      // We can not use <mfrac> to a backslash, so just use <mo>\</mo>
      this.StartElement('mrow'); // aRow

      this.ExportNodes(pNode.GetSubNode(0), nLevel);

      { // Scoping for <mo> creation
        this.StartElement('mo'); // aMo
        this.characters(String.fromCodePoint(MS_BACKSLASH));
        this.EndElement('mo');
      }

      this.ExportNodes(pNode.GetSubNode(1), nLevel);
      this.EndElement('mrow');
    }
  }

  ExportTable(pNode: SmNode, nLevel: number): void {
    let pTable = false;

    let nSize = pNode.GetNumSubNodes();

    //If the list ends in newline then the last entry has
    //no subnodes, the newline is superfluous so we just drop
    //the last node, inclusion would create a bad MathML
    //table
    if (nSize >= 1) {
      const pLine = pNode.GetSubNode(nSize - 1);
      if (pLine && pLine.GetType() === SmNodeType.Line && pLine.GetNumSubNodes() === 1 &&
        pLine.GetSubNode(0) !== null && pLine.GetSubNode(0)!.GetToken().eType === T.TNEWLINE) --nSize;
    }

    // try to avoid creating a mtable element when the formula consists only
    // of a single output line
    if (nLevel || nSize > 1) {
      this.StartElement('mtable');
      pTable = true;
    }

    for (let i = 0; i < nSize; ++i) {
      const pTemp = pNode.GetSubNode(i);
      if (pTemp) {
        let pRow = false;
        let pCell = false;
        if (pTable) {
          this.StartElement('mtr');
          pRow = true;
          let eAlign: SmTokenType = T.TALIGNC;
          if (pTemp.GetType() === SmNodeType.Align) {
            // For Binom() and Stack() constructions, the SmNodeType::Align nodes
            // are direct children.
            // binom{alignl ...}{alignr ...} and
            // stack{alignl ... ## alignr ... ## ...}
            eAlign = pTemp.GetToken().eType;
          } else if (pTemp.GetType() === SmNodeType.Line && pTemp.GetNumSubNodes() === 1 &&
            pTemp.GetSubNode(0) && pTemp.GetSubNode(0)!.GetType() === SmNodeType.Align) {
            // For the Table() construction, the SmNodeType::Align node is a child
            // of an SmNodeType::Line node.
            // alignl ... newline alignr ... newline ...
            eAlign = pTemp.GetSubNode(0)!.GetToken().eType;
          }
          if (eAlign !== T.TALIGNC) {
            // If a left or right alignment is specified on this line,
            // attach the corresponding columnalign attribute.
            this.AddAttribute('columnalign', eAlign === T.TALIGNL ? 'left' : 'right');
          }
          this.StartElement('mtd');
          pCell = true;
        }
        this.ExportNodes(pTemp, nLevel + 1);
        if (pCell) this.EndElement('mtd');
        if (pRow) this.EndElement('mtr');
      }
    }
    if (pTable) this.EndElement('mtable');
  }

  ExportMath(pNode: SmNode): void {
    const pTemp = pNode as SmTextNode;
    let pMath: string;

    if (pNode.GetType() === SmNodeType.Math || pNode.GetType() === SmNodeType.GlyphSpecial) {
      // Export SmNodeType::Math and SmNodeType::GlyphSpecial symbols as <mo> elements
      pMath = 'mo';
    } else if (pNode.GetType() === SmNodeType.Special) {
      const bIsItalic = IsItalic(pNode.GetFont());
      if (!bIsItalic) this.AddAttribute('mathvariant', 'normal');
      pMath = 'mi';
    } else {
      // Export SmNodeType::MathIdent and SmNodeType::Place symbols as <mi> elements:
      // - These math symbols should not be drawn slanted. Hence we should
      // attach a mathvariant="normal" attribute to single-char <mi> elements
      // that are not mathematical alphanumeric symbol. For simplicity and to
      // work around browser limitations, we always attach such an attribute.
      // - The MathML specification suggests to use empty <mi> elements as
      // placeholders but they won't be visible in most MathML rendering
      // engines so let's use an empty square for SmNodeType::Place instead.
      this.AddAttribute('mathvariant', 'normal');
      pMath = 'mi';
    }
    this.StartElement(pMath);
    const nArse = ConvertMathToMathML(pTemp.GetText());
    // OSL_ENSURE(nArse != 0xffff, "Non existent symbol");
    this.characters(nArse ? String.fromCodePoint(nArse) : '');
    this.EndElement(pMath);
  }

  ExportText(pNode: SmNode): void {
    let pText: string;
    const pTemp = pNode as SmTextNode;
    switch (pNode.GetToken().eType) {
      default:
      case T.TIDENT: {
        //Note that we change the fontstyle to italic for strings that
        //are italic and longer than a single character.
        const bIsItalic = IsItalic(pTemp.GetFont());
        if (pTemp.GetText().length > 1 && bIsItalic) this.AddAttribute('mathvariant', 'italic');
        else if (pTemp.GetText().length === 1 && !bIsItalic) this.AddAttribute('mathvariant', 'normal');
        pText = 'mi';
        break;
      }
      case T.TNUMBER:
        pText = 'mn';
        break;
      case T.TTEXT:
        pText = 'mtext';
        break;
    }
    this.StartElement(pText);
    this.characters(pTemp.GetText());
    this.EndElement(pText);
  }

  ExportBlank(pNode: SmNode): void {
    const pTemp = pNode as SmBlankNode;
    //!! exports an <mspace> element. Note that for example "~_~" is allowed in
    //!! Math (so it has no sense at all) but must not result in an empty
    //!! <msub> tag in MathML !!

    if (pTemp.GetBlankNum() !== 0) {
      // Attach a width attribute. We choose the (somewhat arbitrary) values
      // ".5em" for a small gap '`' and "2em" for a large gap '~'.
      // (see SmBlankNode::IncreaseBy for how pTemp->mnNum is set).
      let sStrBuf = convertDouble(pTemp.GetBlankNum() * 0.5);
      sStrBuf += 'em';
      this.AddAttribute('width', sStrBuf);
    }

    this.StartElement('mspace'); // aTextExport

    this.characters('');
    this.EndElement('mspace');
  }

  ExportSubSupScript(pNode: SmNode, nLevel: number): void {
    let pSub: SmNode | null = null;
    let pSup: SmNode | null = null;
    let pCSub: SmNode | null = null;
    let pCSup: SmNode | null = null;
    let pThing2: string | null = null;

    //if we have prescripts at all then we must use the tensor notation

    //This is one of those excellent locations where scope is vital to
    //arrange the construction and destruction of the element helper
    //classes correctly
    const pLSub = pNode.GetSubNode(LSUB + 1);
    const pLSup = pNode.GetSubNode(LSUP + 1);
    if (pLSub || pLSup) {
      this.StartElement('mmultiscripts'); // aMultiScripts

      if ((pCSub = pNode.GetSubNode(CSUB + 1)) !== null && (pCSup = pNode.GetSubNode(CSUP + 1)) !== null) {
        this.StartElement((pThing2 = 'munderover'));
      } else if ((pCSub = pNode.GetSubNode(CSUB + 1)) !== null) {
        this.StartElement((pThing2 = 'munder'));
      } else if ((pCSup = pNode.GetSubNode(CSUP + 1)) !== null) {
        this.StartElement((pThing2 = 'mover'));
      }

      this.ExportNodes(pNode.GetSubNode(0), nLevel + 1); //Main Term

      if (pCSub) this.ExportNodes(pCSub, nLevel + 1);
      if (pCSup) this.ExportNodes(pCSup, nLevel + 1);
      if (pThing2) this.EndElement(pThing2);
      pThing2 = null;

      pSub = pNode.GetSubNode(RSUB + 1);
      pSup = pNode.GetSubNode(RSUP + 1);
      if (pSub || pSup) {
        if (pSub) this.ExportNodes(pSub, nLevel + 1);
        else {
          this.StartElement('none'); // aNone
          this.EndElement('none');
        }
        if (pSup) this.ExportNodes(pSup, nLevel + 1);
        else {
          this.StartElement('none'); // aNone
          this.EndElement('none');
        }
      }

      //Separator element between suffix and prefix sub/sup pairs
      {
        this.StartElement('mprescripts'); // aPrescripts
        this.EndElement('mprescripts');
      }

      if (pLSub) this.ExportNodes(pLSub, nLevel + 1);
      else {
        this.StartElement('none'); // aNone
        this.EndElement('none');
      }
      if (pLSup) this.ExportNodes(pLSup, nLevel + 1);
      else {
        this.StartElement('none'); // aNone
        this.EndElement('none');
      }
      this.EndElement('mmultiscripts');
    } else {
      let pThing: string | null = null;
      if ((pSub = pNode.GetSubNode(RSUB + 1)) !== null && (pSup = pNode.GetSubNode(RSUP + 1)) !== null) {
        this.StartElement((pThing = 'msubsup'));
      } else if ((pSub = pNode.GetSubNode(RSUB + 1)) !== null) {
        this.StartElement((pThing = 'msub'));
      } else if ((pSup = pNode.GetSubNode(RSUP + 1)) !== null) {
        this.StartElement((pThing = 'msup'));
      }

      if ((pCSub = pNode.GetSubNode(CSUB + 1)) !== null && (pCSup = pNode.GetSubNode(CSUP + 1)) !== null) {
        this.StartElement((pThing2 = 'munderover'));
      } else if ((pCSub = pNode.GetSubNode(CSUB + 1)) !== null) {
        this.StartElement((pThing2 = 'munder'));
      } else if ((pCSup = pNode.GetSubNode(CSUP + 1)) !== null) {
        this.StartElement((pThing2 = 'mover'));
      }
      this.ExportNodes(pNode.GetSubNode(0), nLevel + 1); //Main Term

      if (pCSub) this.ExportNodes(pCSub, nLevel + 1);
      if (pCSup) this.ExportNodes(pCSup, nLevel + 1);
      if (pThing2) this.EndElement(pThing2);
      pThing2 = null;

      if (pSub) this.ExportNodes(pSub, nLevel + 1);
      if (pSup) this.ExportNodes(pSup, nLevel + 1);
      if (pThing) this.EndElement(pThing);
      pThing = null;
    }
  }

  ExportBrace(pNode: SmNode, nLevel: number): void {
    let pTemp: SmNode | null;
    const pLeft = pNode.GetSubNode(0);
    const pRight = pNode.GetSubNode(2);

    // This used to generate <mfenced> or <mrow>+<mo> elements according to
    // the stretchiness of fences. The MathML recommendation defines an
    // <mrow>+<mo> construction that is equivalent to the <mfenced> element:
    // http://www.w3.org/TR/MathML3/chapter3.html#presm.mfenced
    // To simplify our code and avoid issues with mfenced implementations in
    // MathML rendering engines, we now always generate <mrow>+<mo> elements.
    // See #fdo 66282.

    // <mrow>
    this.StartElement('mrow'); // aRow

    //   <mo fence="true"> opening-fence </mo>
    if (pLeft && pLeft.GetToken().eType !== T.TNONE) {
      this.AddAttribute('fence', 'true');
      this.AddAttribute('form', 'prefix');
      if (pNode.GetScaleMode() === SmScaleMode.Height) this.AddAttribute('stretchy', 'true');
      else this.AddAttribute('stretchy', 'false');
      this.ExportNodes(pLeft, nLevel + 1);
    }

    if ((pTemp = pNode.GetSubNode(1)) !== null) {
      // <mrow>
      this.StartElement('mrow'); // aRowExport
      this.ExportNodes(pTemp, nLevel + 1);
      this.EndElement('mrow');
      // </mrow>
    }

    //   <mo fence="true"> closing-fence </mo>
    if (pRight && pRight.GetToken().eType !== T.TNONE) {
      this.AddAttribute('fence', 'true');
      this.AddAttribute('form', 'postfix');
      if (pNode.GetScaleMode() === SmScaleMode.Height) this.AddAttribute('stretchy', 'true');
      else this.AddAttribute('stretchy', 'false');
      this.ExportNodes(pRight, nLevel + 1);
    }

    // </mrow>
    this.EndElement('mrow');
  }

  ExportRoot(pNode: SmNode, nLevel: number): void {
    if (pNode.GetSubNode(0)) {
      this.StartElement('mroot'); // aRoot
      this.ExportNodes(pNode.GetSubNode(2), nLevel + 1);
      this.ExportNodes(pNode.GetSubNode(0), nLevel + 1);
      this.EndElement('mroot');
    } else {
      this.StartElement('msqrt'); // aSqrt
      this.ExportNodes(pNode.GetSubNode(2), nLevel + 1);
      this.EndElement('msqrt');
    }
  }

  ExportOperator(pNode: SmNode, nLevel: number): void {
    /*we need to either use content or font and size attributes
     *here*/
    this.StartElement('mrow'); // aRow
    this.ExportNodes(pNode.GetSubNode(0), nLevel + 1);
    this.ExportNodes(pNode.GetSubNode(1), nLevel + 1);
    this.EndElement('mrow');
  }

  ExportAttributes(pNode: SmNode, nLevel: number): void {
    let pElement: string;

    if (pNode.GetToken().eType === T.TUNDERLINE) {
      this.AddAttribute('accentunder', 'true');
      pElement = 'munder';
    } else if (pNode.GetToken().eType === T.TOVERSTRIKE) {
      // export as <menclose notation="horizontalstrike">
      this.AddAttribute('notation', 'horizontalstrike');
      pElement = 'menclose';
    } else {
      this.AddAttribute('accent', 'true');
      pElement = 'mover';
    }
    this.StartElement(pElement);

    this.ExportNodes(pNode.GetSubNode(1), nLevel + 1);
    switch (pNode.GetToken().eType) {
      case T.TOVERLINE: {
        //proper entity support required
        this.StartElement('mo'); // aMath
        const nArse = '¯';
        this.characters(nArse);
        this.EndElement('mo');
        break;
      }
      case T.TUNDERLINE: {
        //proper entity support required
        this.StartElement('mo'); // aMath
        const nArse = '̲';
        this.characters(nArse);
        this.EndElement('mo');
        break;
      }
      case T.TOVERSTRIKE:
        break;
      case T.TWIDETILDE:
      case T.TWIDEHAT:
      case T.TWIDEVEC:
      case T.TWIDEHARPOON: {
        // make these wide accents stretchy
        this.AddAttribute('stretchy', 'true');
        this.ExportNodes(pNode.GetSubNode(0), nLevel + 1);
        break;
      }
      default:
        this.ExportNodes(pNode.GetSubNode(0), nLevel + 1);
        break;
    }
    this.EndElement(pElement);
  }

  ExportFont(pNode: SmNode, nLevel: number): void {
    // gather the mathvariant attribute relevant data from all
    // successively following SmFontNodes...

    let nBold = -1; // for the following variables: -1 = yet undefined; 0 = false; 1 = true;
    let nItalic = -1; // for the following variables: -1 = yet undefined; 0 = false; 1 = true;
    let nSansSerifFixed = -1;
    let eNodeType: SmTokenType = T.TUNKNOWN;

    for (;;) {
      eNodeType = pNode.GetToken().eType;
      if (!lcl_HasEffectOnMathvariant(eNodeType)) break;
      switch (eNodeType) {
        case T.TBOLD: nBold = 1; break;
        case T.TNBOLD: nBold = 0; break;
        case T.TITALIC: nItalic = 1; break;
        case T.TNITALIC: nItalic = 0; break;
        case T.TSANS: nSansSerifFixed = 0; break;
        case T.TSERIF: nSansSerifFixed = 1; break;
        case T.TFIXED: nSansSerifFixed = 2; break;
        default:
          // SAL_WARN("starmath", "unexpected case");
      }
      // According to the parser every node that is to be evaluated here
      // has a single non-zero subnode at index 1!! Thus we only need to check
      // that single node for follow-up nodes that have an effect on the attribute.
      if (pNode.GetNumSubNodes() > 1 && pNode.GetSubNode(1) &&
        lcl_HasEffectOnMathvariant(pNode.GetSubNode(1)!.GetToken().eType)) {
        pNode = pNode.GetSubNode(1)!;
      } else break;
    }

    let nc: number;
    switch (pNode.GetToken().eType) {
      case T.TPHANTOM:
        // No attribute needed. An <mphantom> element will be used below.
        break;
      case T.TMATHMLCOL: {
        nc = parseInt(pNode.GetToken().cMathChar, 16) >>> 0;
        const sssStr = Identify_Color_MATHML(nc).aIdent;
        this.AddAttribute('mathcolor', sssStr);
        break;
      }
      case T.TRGB:
      case T.TRGBA:
      case T.THEX:
      case T.THTMLCOL:
      case T.TDVIPSNAMESCOL:
      case T.TICONICCOL: {
        nc = (parseInt(pNode.GetToken().cMathChar, 16) || 0) >>> 0;
        const ssStr = '#' + AsRGBHEXString(nc);
        this.AddAttribute('mathcolor', ssStr);
        break;
      }
      case T.TSIZE: {
        const pFontNode = pNode as SmFontNode;
        const aFrac = pFontNode.GetSizeParameter();

        let sStrBuf: string;
        switch (pFontNode.GetSizeType()) {
          case FontSizeType.MULTIPLY:
            sStrBuf = convertDouble(aFrac * 100);
            sStrBuf += '%';
            break;
          case FontSizeType.DIVIDE:
            sStrBuf = convertDouble(100 / aFrac);
            sStrBuf += '%';
            break;
          case FontSizeType.ABSOLUT:
            sStrBuf = convertDouble(aFrac);
            sStrBuf += 'pt';
            break;
          default: {
            //The problem here is that the wheels fall off because
            //font size is stored in 100th's of a mm not pts, and
            //rounding errors take their toll on the original
            //value specified in points.

            //Must fix StarMath to retain the original pt values
            // (the font size is in twips here)
            let mytest = pFontNode.GetFont().GetFontSize().height / 20;

            if (pFontNode.GetSizeType() === FontSizeType.MINUS) mytest -= aFrac;
            else mytest += aFrac;

            mytest = Math.round(mytest * 10) / 10;
            sStrBuf = convertDouble(mytest);
            sStrBuf += 'pt';
            break;
          }
        }

        const sStr = sStrBuf;
        this.AddAttribute('mathsize', sStr);
        break;
      }
      case T.TBOLD:
      case T.TITALIC:
      case T.TNBOLD:
      case T.TNITALIC:
      case T.TFIXED:
      case T.TSANS:
      case T.TSERIF: {
        // nBold:   -1 = yet undefined; 0 = false; 1 = true;
        // nItalic: -1 = yet undefined; 0 = false; 1 = true;
        // nSansSerifFixed: -1 = undefined; 0 = sans; 1 = serif; 2 = fixed;
        let pText = 'normal';
        if (nSansSerifFixed === -1 || nSansSerifFixed === 1) {
          pText = 'normal';
          if (nBold === 1 && nItalic !== 1) pText = 'bold';
          else if (nBold !== 1 && nItalic === 1) pText = 'italic';
          else if (nBold === 1 && nItalic === 1) pText = 'bold-italic';
        } else if (nSansSerifFixed === 0) {
          pText = 'sans-serif';
          if (nBold === 1 && nItalic !== 1) pText = 'bold-sans-serif';
          else if (nBold !== 1 && nItalic === 1) pText = 'sans-serif-italic';
          else if (nBold === 1 && nItalic === 1) pText = 'sans-serif-bold-italic';
        } else if (nSansSerifFixed === 2) pText = 'monospace'; // no modifiers allowed for monospace ...
        else {
          // SAL_WARN("starmath", "unexpected case");
        }
        this.AddAttribute('mathvariant', pText);
        break;
      }
      default:
        break;
    }
    {
      // Wrap everything in an <mphantom> or <mstyle> element. These elements
      // are mrow-like, so ExportExpression doesn't need to add an explicit
      // <mrow> element. See #fdo 66283.
      const aElement = pNode.GetToken().eType === T.TPHANTOM ? 'mphantom' : 'mstyle';
      this.StartElement(aElement);
      this.ExportExpression(pNode, nLevel, true);
      this.EndElement(aElement);
    }
  }

  ExportVerticalBrace(pNode: SmVerticalBraceNode, nLevel: number): void {
    // "[body] overbrace [script]"

    // Position body, overbrace and script vertically. First place the overbrace
    // OVER the body and then the script OVER this expression.

    //      [script]
    //   --[overbrace]--
    // XXXXXX[body]XXXXXXX

    // Similarly for the underbrace construction.

    let which: string;

    switch (pNode.GetToken().eType) {
      case T.TOVERBRACE:
      default:
        which = 'mover';
        break;
      case T.TUNDERBRACE:
        which = 'munder';
        break;
    }

    this.StartElement(which); // aOver1
    { //Scoping
      // using accents will draw the over-/underbraces too close to the base
      // see http://www.w3.org/TR/MathML2/chapter3.html#id.3.4.5.2
      // also XML_ACCENT is illegal with XML_MUNDER. Thus no XML_ACCENT attribute here!
      this.StartElement(which); // aOver2
      this.ExportNodes(pNode.Body(), nLevel);
      this.AddAttribute('stretchy', 'true');
      this.ExportNodes(pNode.Brace(), nLevel);
      this.EndElement(which);
    }
    this.ExportNodes(pNode.Script(), nLevel);
    this.EndElement(which);
  }

  ExportMatrix(pNode: SmNode, nLevel: number): void {
    this.StartElement('mtable'); // aTable
    const pMatrix = pNode as SmMatrixNode;
    let i = 0;
    for (let y = 0; y < pMatrix.GetNumRows(); y++) {
      this.StartElement('mtr'); // aRow
      for (let x = 0; x < pMatrix.GetNumCols(); x++) {
        const pTemp = pNode.GetSubNode(i++);
        if (pTemp) {
          if (pTemp.GetType() === SmNodeType.Align && pTemp.GetToken().eType !== T.TALIGNC) {
            // A left or right alignment is specified on this cell,
            // attach the corresponding columnalign attribute.
            this.AddAttribute('columnalign', pTemp.GetToken().eType === T.TALIGNL ? 'left' : 'right');
          }
          this.StartElement('mtd'); // aCell
          this.ExportNodes(pTemp, nLevel + 1);
          this.EndElement('mtd');
        }
      }
      this.EndElement('mtr');
    }
    this.EndElement('mtable');
  }

  ExportNodes(pNode: SmNode | null, nLevel: number): void {
    if (!pNode) return;
    switch (pNode.GetType()) {
      case SmNodeType.Table:
        this.ExportTable(pNode, nLevel);
        break;
      case SmNodeType.Align:
      case SmNodeType.Bracebody:
      case SmNodeType.Expression:
        this.ExportExpression(pNode, nLevel);
        break;
      case SmNodeType.Line:
        this.ExportLine(pNode, nLevel);
        break;
      case SmNodeType.Text:
        this.ExportText(pNode);
        break;
      case SmNodeType.GlyphSpecial:
      case SmNodeType.Math: {
        const pTemp = pNode as SmTextNode;
        if (!pTemp.GetText().length) {
          // no conversion to MathML implemented -> export it as text
          // thus at least it will not vanish into nothing
          this.ExportText(pNode);
        } else {
          switch (pNode.GetToken().eType) {
            case T.TINTD:
              this.AddAttribute('stretchy', 'true');
              break;
            default:
              break;
          }
          //To fully handle generic MathML we need to implement the full
          //operator dictionary, we will generate MathML with explicit
          //stretchiness for now.
          const nLength = this.maAttrList.length;
          let bAddStretch = true;
          for (let i = 0; i < nLength; i++) {
            const sLocalName = this.maAttrList[i]![0];

            if (sLocalName === 'stretchy') {
              bAddStretch = false;
              break;
            }
          }
          if (bAddStretch) {
            this.AddAttribute('stretchy', 'false');
          }
          this.ExportMath(pNode);
        }
        break;
      }
      case SmNodeType.Special: //SmNodeType::Special requires some sort of Entity preservation in the XML engine.
      case SmNodeType.MathIdent:
      case SmNodeType.Place:
        this.ExportMath(pNode);
        break;
      case SmNodeType.BinHor:
        this.ExportBinaryHorizontal(pNode, nLevel);
        break;
      case SmNodeType.UnHor:
        this.ExportUnaryHorizontal(pNode, nLevel);
        break;
      case SmNodeType.Brace:
        this.ExportBrace(pNode, nLevel);
        break;
      case SmNodeType.BinVer:
        this.ExportBinaryVertical(pNode, nLevel);
        break;
      case SmNodeType.BinDiagonal:
        this.ExportBinaryDiagonal(pNode, nLevel);
        break;
      case SmNodeType.SubSup:
        this.ExportSubSupScript(pNode, nLevel);
        break;
      case SmNodeType.Root:
        this.ExportRoot(pNode, nLevel);
        break;
      case SmNodeType.Oper:
        this.ExportOperator(pNode, nLevel);
        break;
      case SmNodeType.Attribute:
        this.ExportAttributes(pNode, nLevel);
        break;
      case SmNodeType.Font:
        this.ExportFont(pNode, nLevel);
        break;
      case SmNodeType.VerticalBrace:
        this.ExportVerticalBrace(pNode as SmVerticalBraceNode, nLevel);
        break;
      case SmNodeType.Matrix:
        this.ExportMatrix(pNode, nLevel);
        break;
      case SmNodeType.Blank:
        this.ExportBlank(pNode);
        break;
      default:
        // SAL_WARN("starmath", "Warning: failed to export a node?");
        break;
    }
  }
}

/**
 * The format of a new formula: SmModule's configuration's standard format, which differs from
 * SmFormat's defaults in the Greek character style (officecfg Math.xcs GreekCharStyle, 2: upper
 * case Greek upright, lower case italic).
 */
function GetStandardFormat(): SmFormat {
  const aFormat = new SmFormat();
  aFormat.nGreekCharStyle = 2;
  return aFormat;
}

/**
 * The content.xml of a formula object for its StarMath text, as SmXMLExportWrapper writes it:
 * the formula is parsed and arranged as SmDocShell does, then exported. Without a format, that
 * of a new formula is used.
 */
export function ExportMathML(rText: string, rFormat: SmFormat = GetStandardFormat()): string {
  const pTree = new SmParser5().Parse(rText);
  pTree.Prepare(rFormat, 0);
  pTree.Arrange(new SmDevice(aFixedMeasurer), rFormat);
  const aExport = new SmXMLExport(rFormat);
  aExport.exportDoc(pTree, rText);
  return aExport.GetOutput();
}
