// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/wordexportbase.hxx faithful
// @upstream starmath/source/wordexportbase.cxx faithful
// The SAL_INFO/SAL_WARN logging is left out.
import { T } from '../inc/token.ts';
import {
  SmNodeType, SmSubSup, type SmAttributeNode, type SmBinHorNode, type SmBraceNode, type SmMatrixNode,
  type SmNode, type SmOperNode, type SmRootNode, type SmSubSupNode, type SmTextNode, type SmUnHorNode,
  type SmVerticalBraceNode,
} from './node.ts';

const { CSUB, CSUP, RSUB, RSUP, LSUB, LSUP } = SmSubSup;

/**
 Base class implementing writing of formulas to Word.
 */
export abstract class SmWordExportBase {
  private readonly m_pTree: SmNode | null;

  constructor(pIn: SmNode | null) {
    this.m_pTree = pIn;
  }

  protected HandleNode(pNode: SmNode, nLevel: number): void {
    switch (pNode.GetType()) {
      case SmNodeType.Attribute:
        this.HandleAttribute(pNode as SmAttributeNode, nLevel);
        break;
      case SmNodeType.Text:
        this.HandleText(pNode, nLevel);
        break;
      case SmNodeType.VerticalBrace:
        this.HandleVerticalBrace(pNode as SmVerticalBraceNode, nLevel);
        break;
      case SmNodeType.Brace:
        this.HandleBrace(pNode as SmBraceNode, nLevel);
        break;
      case SmNodeType.Oper:
        this.HandleOperator(pNode as SmOperNode, nLevel);
        break;
      case SmNodeType.UnHor:
        this.HandleUnaryOperation(pNode as SmUnHorNode, nLevel);
        break;
      case SmNodeType.BinHor:
        this.HandleBinaryOperation(pNode as SmBinHorNode, nLevel);
        break;
      case SmNodeType.BinVer:
        this.HandleFractions(pNode, nLevel, null);
        break;
      case SmNodeType.Root:
        this.HandleRoot(pNode as SmRootNode, nLevel);
        break;
      case SmNodeType.Special: {
        const pText = pNode as SmTextNode;
        //if the token str and the result text are the same then this
        //is to be seen as text, else assume it's a mathchar
        if (pText.GetText() === pText.GetToken().aText) this.HandleText(pText, nLevel);
        else this.HandleMath(pText, nLevel);
        break;
      }
      case SmNodeType.Math:
      case SmNodeType.MathIdent:
        this.HandleMath(pNode, nLevel);
        break;
      case SmNodeType.SubSup:
        this.HandleSubSupScript(pNode as SmSubSupNode, nLevel);
        break;
      case SmNodeType.Expression:
        this.HandleAllSubNodes(pNode, nLevel);
        break;
      case SmNodeType.Table:
        //Root Node, PILE equivalent, i.e. vertical stack
        this.HandleTable(pNode, nLevel);
        break;
      case SmNodeType.Matrix:
        this.HandleMatrix(pNode as SmMatrixNode, nLevel);
        break;
      case SmNodeType.Line: {
        // TODO
        this.HandleAllSubNodes(pNode, nLevel);
        break;
      }
      case SmNodeType.Place:
        // explicitly do nothing, MSOffice treats that as a placeholder if item is missing
        break;
      case SmNodeType.Blank:
        this.HandleBlank();
        break;
      default:
        this.HandleAllSubNodes(pNode, nLevel);
        break;
    }
  }

  //Root Node, PILE equivalent, i.e. vertical stack
  protected HandleTable(pNode: SmNode, nLevel: number): void {
    //The root of the starmath is a table, if
    //we convert this them each iteration of
    //conversion from starmath to Word will
    //add an extra unnecessary level to the
    //Word output stack which would grow
    //without bound in a multi step conversion
    if (nLevel || pNode.GetNumSubNodes() > 1) this.HandleVerticalStack(pNode, nLevel);
    else this.HandleAllSubNodes(pNode, nLevel);
  }

  protected HandleAllSubNodes(pNode: SmNode, nLevel: number): void {
    const size = pNode.GetNumSubNodes();
    for (let i = 0; i < size; ++i) {
      // TODO remove when all types of nodes are handled properly
      const pSubNode = pNode.GetSubNode(i);
      if (pSubNode === null) continue; // Subnode is NULL, parent node not handled properly
      this.HandleNode(pSubNode, nLevel + 1);
    }
  }

  protected abstract HandleVerticalStack(pNode: SmNode, nLevel: number): void;
  protected abstract HandleText(pNode: SmNode, nLevel: number): void;

  protected HandleMath(pNode: SmNode, nLevel: number): void {
    switch (pNode.GetToken().eType) {
      case T.TDIVIDEBY:
      case T.TACUTE:
      // the above are handled elsewhere, e.g. when handling BINHOR
      // falls through
      default:
        this.HandleText(pNode, nLevel);
        break;
    }
  }

  protected abstract HandleFractions(pNode: SmNode, nLevel: number, type: string | null): void;

  protected HandleUnaryOperation(pNode: SmUnHorNode, nLevel: number): void {
    // update HandleMath() when adding new items
    this.HandleAllSubNodes(pNode, nLevel);
  }

  protected HandleBinaryOperation(pNode: SmBinHorNode, nLevel: number): void {
    // update HandleMath() when adding new items
    switch (pNode.Symbol().GetToken().eType) {
      case T.TDIVIDEBY:
        return this.HandleFractions(pNode, nLevel, 'lin');
      default:
        this.HandleAllSubNodes(pNode, nLevel);
        break;
    }
  }

  protected abstract HandleRoot(pNode: SmRootNode, nLevel: number): void;
  protected abstract HandleAttribute(pNode: SmAttributeNode, nLevel: number): void;
  protected abstract HandleOperator(pNode: SmOperNode, nLevel: number): void;

  protected HandleSubSupScript(pNode: SmSubSupNode, nLevel: number): void {
    // set flags to a bitfield of which sub/sup items exists
    const flags = (pNode.GetSubSup(CSUB) !== null ? (1 << CSUB) : 0)
      | (pNode.GetSubSup(CSUP) !== null ? (1 << CSUP) : 0)
      | (pNode.GetSubSup(RSUB) !== null ? (1 << RSUB) : 0)
      | (pNode.GetSubSup(RSUP) !== null ? (1 << RSUP) : 0)
      | (pNode.GetSubSup(LSUB) !== null ? (1 << LSUB) : 0)
      | (pNode.GetSubSup(LSUP) !== null ? (1 << LSUP) : 0);
    this.HandleSubSupScriptInternal(pNode, nLevel, flags);
  }

  protected abstract HandleSubSupScriptInternal(pNode: SmSubSupNode, nLevel: number, flags: number): void;
  protected abstract HandleMatrix(pNode: SmMatrixNode, nLevel: number): void;
  protected abstract HandleBrace(pNode: SmBraceNode, nLevel: number): void;
  protected abstract HandleVerticalBrace(pNode: SmVerticalBraceNode, nLevel: number): void;
  protected abstract HandleBlank(): void;
  protected GetTree(): SmNode | null { return this.m_pTree; }
}
