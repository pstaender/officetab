// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/ooxmlexport.hxx faithful
// @upstream starmath/source/ooxmlexport.cxx faithful
// @upstream starmath/source/document.cxx partial
// sax's FastSerializer is a string builder here (FSHelper below): element tokens XML_m/XML_x are
// written as "m:x", text and attribute values are escaped as FastSaxSerializer::write escapes
// them. The SAL_INFO/SAL_WARN logging and the disabled (#if 0) MathType code are left out.
// ExportOMML is SmDocShell::writeFormulaOoxml for a formula text; the export only reads the
// nodes' texts, so the tree is prepared (SmNode::Prepare) rather than arranged.
import { T } from '../inc/token.ts';
import { SmDocShell } from './document.ts';
import {
  SmNodeType, SmSubSup, SmTextNode, type SmAttributeNode, type SmBraceNode, type SmBracebodyNode,
  type SmMatrixNode, type SmNode, type SmOperNode, type SmRootNode, type SmSubSupNode,
  type SmVerticalBraceNode,
} from './node.ts';
import { SmWordExportBase } from './wordexportbase.ts';

const { CSUB, CSUP, RSUB, RSUP, LSUB, LSUP } = SmSubSup;

/** oox::core::OoxmlVersion */
export const OoxmlVersion = { ECMA_376_1ST_EDITION: 0, ISOIEC_29500_2008: 1 } as const;
export type OoxmlVersion = (typeof OoxmlVersion)[keyof typeof OoxmlVersion];

/** oox::drawingml::DocumentType */
export const DocumentType = { DOCUMENT_DOCX: 0, DOCUMENT_PPTX: 1, DOCUMENT_XLSX: 2 } as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

/** oox::FormulaImExportBase::eFormulaAlign */
export const eFormulaAlign = { INLINE: 0, CENTER: 1, LEFT: 2, RIGHT: 3 } as const;
export type eFormulaAlign = (typeof eFormulaAlign)[keyof typeof eFormulaAlign];

/** FastSaxSerializer::write( ..., bEscape = true ) */
function escape(s: string): string {
  return s.replace(/[<>&'"\t\n\r]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      case '\t': return '&#9;';
      case '\n': return '&#10;';
      default: return '&#13;';
    }
  });
}

/** sax_fastparser::FastSerializerHelper, writing to a string. Attributes are name, value pairs. */
export class FSHelper {
  private maOut: string[] = [];

  private static attrs(aAttrs: string[]): string {
    let s = '';
    for (let i = 0; i + 1 < aAttrs.length; i += 2) s += ` ${aAttrs[i]}="${escape(aAttrs[i + 1])}"`;
    return s;
  }

  startElementNS(ns: string, name: string, ...aAttrs: string[]): void {
    this.maOut.push(`<${ns}:${name}${FSHelper.attrs(aAttrs)}>`);
  }

  singleElementNS(ns: string, name: string, ...aAttrs: string[]): void {
    this.maOut.push(`<${ns}:${name}${FSHelper.attrs(aAttrs)}/>`);
  }

  endElementNS(ns: string, name: string): void {
    this.maOut.push(`</${ns}:${name}>`);
  }

  write(s: string): void { this.maOut.push(s); }
  writeEscaped(s: string): void { this.maOut.push(escape(s)); }
  toString(): string { return this.maOut.join(''); }
}

/**
 Class implementing writing of formulas to OOXML.
 */
export class SmOoxmlExport extends SmWordExportBase {
  private m_pSerializer!: FSHelper;
  private version: OoxmlVersion;
  /// needed to determine markup for nested run properties
  private readonly m_DocumentType: DocumentType;

  constructor(pIn: SmNode | null, v: OoxmlVersion, documentType: DocumentType) {
    super(pIn);
    this.version = v;
    this.m_DocumentType = documentType;
  }

  ConvertFromStarMath(serializer: FSHelper, nAlign: number): void {
    if (this.GetTree() === null) return;
    this.m_pSerializer = serializer;

    //Formula alignment situations:
    //
    //  1)Inline(as before):
    //
    //      <m:oMath>
    //          <m:r>  ... </m:r>
    //      </m:oMath>
    //
    //  2)Aligned:
    //
    //      <m:oMathPara>
    //          <m:oMathParaPr>
    //              <m:jc m:val="left|right|center">
    //          </m:oMathParaPr>
    //          <m:oMath>
    //              <m:r>  ... </m:r>
    //          </m:oMath>
    //      </m:oMathPara>

    if (nAlign !== eFormulaAlign.INLINE) {
      this.m_pSerializer.startElementNS('m', 'oMathPara',
        'xmlns:m', 'http://schemas.openxmlformats.org/officeDocument/2006/math');
      this.m_pSerializer.startElementNS('m', 'oMathParaPr');
      if (nAlign === eFormulaAlign.CENTER) this.m_pSerializer.singleElementNS('m', 'jc', 'm:val', 'center');
      if (nAlign === eFormulaAlign.LEFT) this.m_pSerializer.singleElementNS('m', 'jc', 'm:val', 'left');
      if (nAlign === eFormulaAlign.RIGHT) this.m_pSerializer.singleElementNS('m', 'jc', 'm:val', 'right');
      this.m_pSerializer.endElementNS('m', 'oMathParaPr');
      this.m_pSerializer.startElementNS('m', 'oMath');
      this.HandleNode(this.GetTree()!, 0);
      this.m_pSerializer.endElementNS('m', 'oMath');
      this.m_pSerializer.endElementNS('m', 'oMathPara');
    } else { //else, inline as was before
      this.m_pSerializer.startElementNS('m', 'oMath',
        'xmlns:m', 'http://schemas.openxmlformats.org/officeDocument/2006/math');
      this.HandleNode(this.GetTree()!, 0);
      this.m_pSerializer.endElementNS('m', 'oMath');
    }
  }

  // NOTE: This is still work in progress and unfinished, but it already covers a good
  // part of the ooxml math stuff.

  protected HandleVerticalStack(pNode: SmNode, nLevel: number): void {
    this.m_pSerializer.startElementNS('m', 'eqArr');
    const size = pNode.GetNumSubNodes();
    for (let i = 0; i < size; ++i) {
      this.m_pSerializer.startElementNS('m', 'e');
      this.HandleNode(pNode.GetSubNode(i)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'e');
    }
    this.m_pSerializer.endElementNS('m', 'eqArr');
  }

  protected HandleText(pNode: SmNode, _nLevel: number): void {
    this.m_pSerializer.startElementNS('m', 'r');

    if (pNode.GetToken().eType === T.TTEXT) { // literal text (in quotes)
      this.m_pSerializer.startElementNS('m', 'rPr');
      this.m_pSerializer.singleElementNS('m', 'lit');
      this.m_pSerializer.singleElementNS('m', 'nor');
      this.m_pSerializer.endElementNS('m', 'rPr');
    }
    if (DocumentType.DOCUMENT_DOCX === this.m_DocumentType && OoxmlVersion.ECMA_376_1ST_EDITION === this.version) {
      // HACK: MSOffice2007 does not import characters properly unless this font is explicitly given
      this.m_pSerializer.startElementNS('w', 'rPr');
      this.m_pSerializer.singleElementNS('w', 'rFonts', 'w:ascii', 'Cambria Math',
        'w:hAnsi', 'Cambria Math');
      this.m_pSerializer.endElementNS('w', 'rPr');
    }
    this.m_pSerializer.startElementNS('m', 't', 'xml:space', 'preserve');
    const pTemp = pNode as SmTextNode;
    const aText = pTemp.GetText();
    let buf = '';
    for (let i = 0; i < aText.length; i++) {
      buf += String.fromCharCode(SmTextNode.ConvertSymbolToUnicode(aText.charCodeAt(i)));
    }
    this.m_pSerializer.writeEscaped(buf);
    this.m_pSerializer.endElementNS('m', 't');
    this.m_pSerializer.endElementNS('m', 'r');
  }

  protected HandleFractions(pNode: SmNode, nLevel: number, type: string | null): void {
    this.m_pSerializer.startElementNS('m', 'f');
    if (type !== null) {
      this.m_pSerializer.startElementNS('m', 'fPr');
      this.m_pSerializer.singleElementNS('m', 'type', 'm:val', type);
      this.m_pSerializer.endElementNS('m', 'fPr');
    }
    console.assert(pNode.GetNumSubNodes() === 3);
    this.m_pSerializer.startElementNS('m', 'num');
    this.HandleNode(pNode.GetSubNode(0)!, nLevel + 1);
    this.m_pSerializer.endElementNS('m', 'num');
    this.m_pSerializer.startElementNS('m', 'den');
    this.HandleNode(pNode.GetSubNode(2)!, nLevel + 1);
    this.m_pSerializer.endElementNS('m', 'den');
    this.m_pSerializer.endElementNS('m', 'f');
  }

  protected HandleAttribute(pNode: SmAttributeNode, nLevel: number): void {
    switch (pNode.Attribute().GetToken().eType) {
      case T.TCHECK:
      case T.TACUTE:
      case T.TGRAVE:
      case T.TBREVE:
      case T.TCIRCLE:
      case T.TVEC:
      case T.TTILDE:
      case T.THAT:
      case T.TDOT:
      case T.TDDOT:
      case T.TDDDOT:
      case T.TWIDETILDE:
      case T.TWIDEHAT:
      case T.TWIDEHARPOON:
      case T.TWIDEVEC:
      case T.TBAR: {
        this.m_pSerializer.startElementNS('m', 'acc');
        this.m_pSerializer.startElementNS('m', 'accPr');
        const value = pNode.Attribute().GetToken().cMathChar;
        this.m_pSerializer.singleElementNS('m', 'chr', 'm:val', value);
        this.m_pSerializer.endElementNS('m', 'accPr');
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(pNode.Body(), nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.endElementNS('m', 'acc');
        break;
      }
      case T.TOVERLINE:
      case T.TUNDERLINE:
        this.m_pSerializer.startElementNS('m', 'bar');
        this.m_pSerializer.startElementNS('m', 'barPr');
        this.m_pSerializer.singleElementNS('m', 'pos', 'm:val',
          (pNode.Attribute().GetToken().eType === T.TUNDERLINE) ? 'bot' : 'top');
        this.m_pSerializer.endElementNS('m', 'barPr');
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(pNode.Body(), nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.endElementNS('m', 'bar');
        break;
      case T.TOVERSTRIKE:
        this.m_pSerializer.startElementNS('m', 'borderBox');
        this.m_pSerializer.startElementNS('m', 'borderBoxPr');
        this.m_pSerializer.singleElementNS('m', 'hideTop', 'm:val', '1');
        this.m_pSerializer.singleElementNS('m', 'hideBot', 'm:val', '1');
        this.m_pSerializer.singleElementNS('m', 'hideLeft', 'm:val', '1');
        this.m_pSerializer.singleElementNS('m', 'hideRight', 'm:val', '1');
        this.m_pSerializer.singleElementNS('m', 'strikeH', 'm:val', '1');
        this.m_pSerializer.endElementNS('m', 'borderBoxPr');
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(pNode.Body(), nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.endElementNS('m', 'borderBox');
        break;
      default:
        this.HandleAllSubNodes(pNode, nLevel);
        break;
    }
  }

  protected HandleRoot(pNode: SmRootNode, nLevel: number): void {
    this.m_pSerializer.startElementNS('m', 'rad');
    const argument = pNode.Argument();
    if (argument) {
      this.m_pSerializer.startElementNS('m', 'deg');
      this.HandleNode(argument, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'deg');
    } else {
      this.m_pSerializer.startElementNS('m', 'radPr');
      this.m_pSerializer.singleElementNS('m', 'degHide', 'm:val', '1');
      this.m_pSerializer.endElementNS('m', 'radPr');
      this.m_pSerializer.singleElementNS('m', 'deg'); // empty but present
    }
    this.m_pSerializer.startElementNS('m', 'e');
    this.HandleNode(pNode.Body(), nLevel + 1);
    this.m_pSerializer.endElementNS('m', 'e');
    this.m_pSerializer.endElementNS('m', 'rad');
  }

  protected HandleOperator(pNode: SmOperNode, nLevel: number): void {
    switch (pNode.GetToken().eType) {
      case T.TINT:
      case T.TINTD:
      case T.TIINT:
      case T.TIIINT:
      case T.TLINT:
      case T.TLLINT:
      case T.TLLLINT:
      case T.TPROD:
      case T.TCOPROD:
      case T.TSUM: {
        const subsup = pNode.GetSubNode(0)!.GetType() === SmNodeType.SubSup
          ? pNode.GetSubNode(0) as SmSubSupNode : null;
        const operation = subsup !== null ? subsup.GetBody()! : pNode.GetSubNode(0)!;
        this.m_pSerializer.startElementNS('m', 'nary');
        this.m_pSerializer.startElementNS('m', 'naryPr');
        this.m_pSerializer.singleElementNS('m', 'chr',
          'm:val', mathSymbolToString(operation));
        if (subsup === null || subsup.GetSubSup(CSUB) === null)
          this.m_pSerializer.singleElementNS('m', 'subHide', 'm:val', '1');
        if (subsup === null || subsup.GetSubSup(CSUP) === null)
          this.m_pSerializer.singleElementNS('m', 'supHide', 'm:val', '1');
        this.m_pSerializer.endElementNS('m', 'naryPr');
        if (subsup === null || subsup.GetSubSup(CSUB) === null) this.m_pSerializer.singleElementNS('m', 'sub');
        else {
          this.m_pSerializer.startElementNS('m', 'sub');
          this.HandleNode(subsup.GetSubSup(CSUB)!, nLevel + 1);
          this.m_pSerializer.endElementNS('m', 'sub');
        }
        if (subsup === null || subsup.GetSubSup(CSUP) === null) this.m_pSerializer.singleElementNS('m', 'sup');
        else {
          this.m_pSerializer.startElementNS('m', 'sup');
          this.HandleNode(subsup.GetSubSup(CSUP)!, nLevel + 1);
          this.m_pSerializer.endElementNS('m', 'sup');
        }
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(pNode.GetSubNode(1)!, nLevel + 1); // body
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.endElementNS('m', 'nary');
        break;
      }
      case T.TLIM: {
        this.m_pSerializer.startElementNS('m', 'func');
        this.m_pSerializer.startElementNS('m', 'fName');
        this.m_pSerializer.startElementNS('m', 'limLow');
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(pNode.GetSymbol(), nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.startElementNS('m', 'lim');
        const subsup = pNode.GetSubNode(0)!.GetType() === SmNodeType.SubSup
          ? pNode.GetSubNode(0) as SmSubSupNode : null;
        if (subsup) {
          if (subsup.GetSubSup(CSUB) !== null) this.HandleNode(subsup.GetSubSup(CSUB)!, nLevel + 1);
        }
        this.m_pSerializer.endElementNS('m', 'lim');
        this.m_pSerializer.endElementNS('m', 'limLow');
        this.m_pSerializer.endElementNS('m', 'fName');
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(pNode.GetSubNode(1)!, nLevel + 1); // body
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.endElementNS('m', 'func');
        break;
      }
      default:
        // Unhandled operation
        this.HandleAllSubNodes(pNode, nLevel);
        break;
    }
  }

  protected HandleSubSupScriptInternal(pNode: SmSubSupNode, nLevel: number, flags: number): void {
    // docx supports only a certain combination of sub/super scripts, but LO can have any,
    // so try to merge it using several tags if necessary
    if (flags === 0) // none
      return;
    if ((flags & (1 << RSUP | 1 << RSUB)) === (1 << RSUP | 1 << RSUB)) { // m:sSubSup
      this.m_pSerializer.startElementNS('m', 'sSubSup');
      this.m_pSerializer.startElementNS('m', 'e');
      flags &= ~(1 << RSUP | 1 << RSUB);
      if (flags === 0) this.HandleNode(pNode.GetBody()!, nLevel + 1);
      else this.HandleSubSupScriptInternal(pNode, nLevel, flags);
      this.m_pSerializer.endElementNS('m', 'e');
      this.m_pSerializer.startElementNS('m', 'sub');
      this.HandleNode(pNode.GetSubSup(RSUB)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'sub');
      this.m_pSerializer.startElementNS('m', 'sup');
      this.HandleNode(pNode.GetSubSup(RSUP)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'sup');
      this.m_pSerializer.endElementNS('m', 'sSubSup');
    } else if ((flags & (1 << RSUB)) === 1 << RSUB) { // m:sSub
      this.m_pSerializer.startElementNS('m', 'sSub');
      this.m_pSerializer.startElementNS('m', 'e');
      flags &= ~(1 << RSUB);
      if (flags === 0) this.HandleNode(pNode.GetBody()!, nLevel + 1);
      else this.HandleSubSupScriptInternal(pNode, nLevel, flags);
      this.m_pSerializer.endElementNS('m', 'e');
      this.m_pSerializer.startElementNS('m', 'sub');
      this.HandleNode(pNode.GetSubSup(RSUB)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'sub');
      this.m_pSerializer.endElementNS('m', 'sSub');
    } else if ((flags & (1 << RSUP)) === 1 << RSUP) { // m:sSup
      this.m_pSerializer.startElementNS('m', 'sSup');
      this.m_pSerializer.startElementNS('m', 'e');
      flags &= ~(1 << RSUP);
      if (flags === 0) this.HandleNode(pNode.GetBody()!, nLevel + 1);
      else this.HandleSubSupScriptInternal(pNode, nLevel, flags);
      this.m_pSerializer.endElementNS('m', 'e');
      this.m_pSerializer.startElementNS('m', 'sup');
      this.HandleNode(pNode.GetSubSup(RSUP)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'sup');
      this.m_pSerializer.endElementNS('m', 'sSup');
    } else if ((flags & (1 << LSUP | 1 << LSUB)) === (1 << LSUP | 1 << LSUB)) { // m:sPre
      this.m_pSerializer.startElementNS('m', 'sPre');
      this.m_pSerializer.startElementNS('m', 'sub');
      this.HandleNode(pNode.GetSubSup(LSUB)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'sub');
      this.m_pSerializer.startElementNS('m', 'sup');
      this.HandleNode(pNode.GetSubSup(LSUP)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'sup');
      this.m_pSerializer.startElementNS('m', 'e');
      flags &= ~(1 << LSUP | 1 << LSUB);
      if (flags === 0) this.HandleNode(pNode.GetBody()!, nLevel + 1);
      else this.HandleSubSupScriptInternal(pNode, nLevel, flags);
      this.m_pSerializer.endElementNS('m', 'e');
      this.m_pSerializer.endElementNS('m', 'sPre');
    } else if ((flags & (1 << CSUB)) === (1 << CSUB)) { // m:limLow looks like a good element for central superscript
      this.m_pSerializer.startElementNS('m', 'limLow');
      this.m_pSerializer.startElementNS('m', 'e');
      flags &= ~(1 << CSUB);
      if (flags === 0) this.HandleNode(pNode.GetBody()!, nLevel + 1);
      else this.HandleSubSupScriptInternal(pNode, nLevel, flags);
      this.m_pSerializer.endElementNS('m', 'e');
      this.m_pSerializer.startElementNS('m', 'lim');
      this.HandleNode(pNode.GetSubSup(CSUB)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'lim');
      this.m_pSerializer.endElementNS('m', 'limLow');
    } else if ((flags & (1 << CSUP)) === (1 << CSUP)) { // m:limUpp looks like a good element for central superscript
      this.m_pSerializer.startElementNS('m', 'limUpp');
      this.m_pSerializer.startElementNS('m', 'e');
      flags &= ~(1 << CSUP);
      if (flags === 0) this.HandleNode(pNode.GetBody()!, nLevel + 1);
      else this.HandleSubSupScriptInternal(pNode, nLevel, flags);
      this.m_pSerializer.endElementNS('m', 'e');
      this.m_pSerializer.startElementNS('m', 'lim');
      this.HandleNode(pNode.GetSubSup(CSUP)!, nLevel + 1);
      this.m_pSerializer.endElementNS('m', 'lim');
      this.m_pSerializer.endElementNS('m', 'limUpp');
    } else {
      // Unhandled sub/sup combination
      // TODO do not do anything, this should be probably an assert()
      // HandleAllSubNodes( pNode, nLevel );
    }
  }

  protected HandleMatrix(pNode: SmMatrixNode, nLevel: number): void {
    this.m_pSerializer.startElementNS('m', 'm');
    for (let row = 0; row < pNode.GetNumRows(); ++row) {
      this.m_pSerializer.startElementNS('m', 'mr');
      for (let col = 0; col < pNode.GetNumCols(); ++col) {
        this.m_pSerializer.startElementNS('m', 'e');
        const node = pNode.GetSubNode(row * pNode.GetNumCols() + col);
        if (node) this.HandleNode(node, nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'e');
      }
      this.m_pSerializer.endElementNS('m', 'mr');
    }
    this.m_pSerializer.endElementNS('m', 'm');
  }

  protected HandleBrace(pNode: SmBraceNode, nLevel: number): void {
    this.m_pSerializer.startElementNS('m', 'd');
    this.m_pSerializer.startElementNS('m', 'dPr');

    //check if the node has an opening brace
    if (T.TNONE === pNode.OpeningBrace().GetToken().eType)
      this.m_pSerializer.singleElementNS('m', 'begChr', 'm:val', '');
    else
      this.m_pSerializer.singleElementNS('m', 'begChr',
        'm:val', mathSymbolToString(pNode.OpeningBrace()));

    const subnodes: SmNode[] = [];
    if (pNode.Body().GetType() === SmNodeType.Bracebody) {
      const body = pNode.Body() as SmBracebodyNode;
      let separatorWritten = false; // assume all separators are the same
      for (let i = 0; i < body.GetNumSubNodes(); ++i) {
        const subnode = body.GetSubNode(i)!;
        if (subnode.GetType() === SmNodeType.Math || subnode.GetType() === SmNodeType.MathIdent) {
          // do not write, but write what separator it is
          const math = subnode;
          if (!separatorWritten) {
            this.m_pSerializer.singleElementNS('m', 'sepChr',
              'm:val', mathSymbolToString(math));
            separatorWritten = true;
          }
        } else subnodes.push(subnode);
      }
    } else subnodes.push(pNode.Body());

    if (T.TNONE === pNode.ClosingBrace().GetToken().eType)
      this.m_pSerializer.singleElementNS('m', 'endChr', 'm:val', '');
    else
      this.m_pSerializer.singleElementNS('m', 'endChr',
        'm:val', mathSymbolToString(pNode.ClosingBrace()));

    this.m_pSerializer.endElementNS('m', 'dPr');
    if (subnodes.length === 0) {
      // e element is required
      this.m_pSerializer.singleElementNS('m', 'e');
    } else {
      for (const subnode of subnodes) {
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(subnode, nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'e');
      }
    }
    this.m_pSerializer.endElementNS('m', 'd');
  }

  protected HandleVerticalBrace(pNode: SmVerticalBraceNode, nLevel: number): void {
    switch (pNode.GetToken().eType) {
      case T.TOVERBRACE:
      case T.TUNDERBRACE: {
        const top = (pNode.GetToken().eType === T.TOVERBRACE);
        this.m_pSerializer.startElementNS('m', top ? 'limUpp' : 'limLow');
        this.m_pSerializer.startElementNS('m', 'e');
        this.m_pSerializer.startElementNS('m', 'groupChr');
        this.m_pSerializer.startElementNS('m', 'groupChrPr');
        this.m_pSerializer.singleElementNS('m', 'chr',
          'm:val', mathSymbolToString(pNode.Brace()));
        // TODO not sure if pos and vertJc are correct
        this.m_pSerializer.singleElementNS('m', 'pos',
          'm:val', top ? 'top' : 'bot');
        this.m_pSerializer.singleElementNS('m', 'vertJc', 'm:val',
          top ? 'bot' : 'top');
        this.m_pSerializer.endElementNS('m', 'groupChrPr');
        this.m_pSerializer.startElementNS('m', 'e');
        this.HandleNode(pNode.Body(), nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.endElementNS('m', 'groupChr');
        this.m_pSerializer.endElementNS('m', 'e');
        this.m_pSerializer.startElementNS('m', 'lim');
        this.HandleNode(pNode.Script(), nLevel + 1);
        this.m_pSerializer.endElementNS('m', 'lim');
        this.m_pSerializer.endElementNS('m', top ? 'limUpp' : 'limLow');
        break;
      }
      default:
        // Unhandled vertical brace
        this.HandleAllSubNodes(pNode, nLevel);
        break;
    }
  }

  protected HandleBlank(): void {
    this.m_pSerializer.startElementNS('m', 'r');
    this.m_pSerializer.startElementNS('m', 't', 'xml:space', 'preserve');
    this.m_pSerializer.write(' ');
    this.m_pSerializer.endElementNS('m', 't');
    this.m_pSerializer.endElementNS('m', 'r');
  }
}

function mathSymbolToString(node: SmNode): string {
  console.assert(node.GetType() === SmNodeType.Math || node.GetType() === SmNodeType.MathIdent);
  const txtnode = node as SmTextNode;
  console.assert(txtnode.GetText().length === 1);
  // upstream reads GetText()[0] (a NUL for an empty text); an empty text gives an empty value here
  if (txtnode.GetText().length === 0) return '';
  const chr = SmTextNode.ConvertSymbolToUnicode(txtnode.GetText().charCodeAt(0));
  return String.fromCharCode(chr);
}

/**
 * SmDocShell::writeFormulaOoxml for the formula text rText: parses it and returns the
 * m:oMath element (or m:oMathPara for an aligned formula) as DOCX export writes it.
 * The version defaults to ISO/IEC 29500:2008, the "Word 2010–365 Document" filter.
 */
export function ExportOMML(
  rText: string,
  nAlign: number = eFormulaAlign.INLINE,
  version: OoxmlVersion = OoxmlVersion.ISOIEC_29500_2008,
  documentType: DocumentType = DocumentType.DOCUMENT_DOCX,
): string {
  const aDoc = new SmDocShell(rText);
  if (!aDoc.mpTree) aDoc.Parse();
  if (aDoc.mpTree) aDoc.mpTree.Prepare(aDoc.GetFormat(), 0);
  const pSerializer = new FSHelper();
  const aEquation = new SmOoxmlExport(aDoc.mpTree, version, documentType);
  if (documentType === DocumentType.DOCUMENT_DOCX) aEquation.ConvertFromStarMath(pSerializer, nAlign);
  else aEquation.ConvertFromStarMath(pSerializer, eFormulaAlign.INLINE);
  return pSerializer.toString();
}
