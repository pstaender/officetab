// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/edit/autofmt.cxx reduced
// SwAutoFormat: Tools > AutoCorrect > Apply, and the formatting while typing that runs when Enter
// ends a paragraph. The state machine, the recognition of numbering, bullets, headings, borders
// and indents, and the per-paragraph AutoCorrect follow upstream. Left out or reduced:
//  - tables drawn with +---+ (DoTable) get columns of equal width, not at the positions of the
//    + and | characters, and the table's alignment is not taken from the paragraph;
//  - GetBigIndent is 0, so "contraposition" paragraphs (RES_POOLCOLL_CONFRONTATION) are not made;
//  - the progress display, the redline comments of each action (SetRedlineText) and the redline
//    sequence;
//  - numbering levels set by indentation keep the label alignment of the list (the position and
//    space mode's absolute indents are not ported), and the bullet font and character styles of
//    the new list are not set;
//  - the pool styles AutoFormat applies (indents, lists, numbering) are created with their
//    indents but without the rest of their pool attributes;
//  - border lines are single lines of the width of the upstream line style.
import { ACFlags, SvxAutoCorrect } from '../../../../editeng/source/misc/svxacorr.ts';
import { SvxAutoCorrCfg } from '../../../../editeng/source/misc/acorrcfg.ts';
import { SvxSwAutoFormatFlags } from '../../../../editeng/source/misc/swafopt.ts';
import { SwAutoCorrDoc, SwEditShell_AutoCorrect } from './acorrect.ts';
import { SwTextFrameInfo } from '../text/frminf.ts';
import { SwPaM } from '../../../inc/pam.ts';
import { SwDoc, SwPosition } from '../../../inc/doc.ts';
import { MAXLEVEL, SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import type { SwAttrSet } from '../../../inc/hintids.ts';
import type { SwTextFormatColl } from '../../../inc/format.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwNode, SwSectionNode, SwStartNode } from '../../../inc/node.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';

const USHRT_MAX = 0xFFFF;
const pBulletChar = ['+', '*', '-', '–', '—'];
const cnPosEnDash = 2, cnPosEmDash = 4;

const cStarSymbolEnDash = '–';
const cStarSymbolEmDash = '—';

const cnNumBullColls = 4;
const CHAR_HARDBLANK = ' ';

/** The pool paragraph styles AutoFormat applies (RES_POOLCOLL_*), by name. */
const RES_POOLCOLL_STANDARD = 'Standard';
const RES_POOLCOLL_TEXT = 'Text Body';
const RES_POOLCOLL_TEXT_IDENT = 'First Line Indent';
const RES_POOLCOLL_TEXT_NEGIDENT = 'Hanging Indent';
const RES_POOLCOLL_TEXT_MOVE = 'Text Body Indent';
const RES_POOLCOLL_HEADLINE = (n: number) => `Heading ${n + 1}`;
const RES_POOLCOLL_BULLET_LEVEL = (n: number) => `List ${n + 1}`;
const RES_POOLCOLL_NUM_LEVEL = (n: number) => `Numbering ${n + 1}`;
/** The pool styles AutoFormat may create (DocumentStylePoolManager::GetTextCollFromPool), as indents in twips. */
const POOL_INDENTS: Record<string, { left: number; firstLine: number }> = {
  [RES_POOLCOLL_TEXT_IDENT]: { left: 0, firstLine: 283 },
  [RES_POOLCOLL_TEXT_NEGIDENT]: { left: 567, firstLine: -283 },
  [RES_POOLCOLL_TEXT_MOVE]: { left: 283, firstLine: 0 },
};
// lcl_SetNumBul with SwNumRule::GetNumIndent / GetBullIndent and their first line offsets.
for (let n = 0; n <= cnNumBullColls; n++) {
  POOL_INDENTS[RES_POOLCOLL_BULLET_LEVEL(n)] = { left: 283 * (n + 1), firstLine: -283 };
  POOL_INDENTS[RES_POOLCOLL_NUM_LEVEL(n)] = { left: 357 * (n + 1), firstLine: -357 };
}
/** Pool style names the user may have given their own meaning (IsPoolUserFormat is false for these). */
const POOL_NAMES = new Set([RES_POOLCOLL_STANDARD, RES_POOLCOLL_TEXT, ...Object.keys(POOL_INDENTS), 'Heading', 'Title', 'Subtitle', 'Quotations', 'Preformatted Text',
  'Header', 'Footer', 'Header and Footer', 'Footnote', 'Endnote', 'Frame Contents', 'Table Contents', 'Table Heading', 'Caption', 'Horizontal Line',
  ...Array.from({ length: 10 }, (_, i) => RES_POOLCOLL_HEADLINE(i))]);
const IsPoolUserFormat = (name: string) => !POOL_NAMES.has(name);

/** SvxBorderLineWidth: Hairline, Thin, Medium and Thick, in twips. */
const SvxBorderLineWidth = { Hairline: 1, Thin: 15, Medium: 30, Thick: 45 } as const;

/** The leading part of the string that getToken returns, and the index after the separator (-1 at the end). */
function getToken(s: string, sep: string, idx: Ref): string {
  if (idx.value < 0) return '';
  const at = s.indexOf(sep, idx.value);
  const t = at < 0 ? s.slice(idx.value) : s.slice(idx.value, at);
  idx.value = at < 0 ? -1 : at + 1;
  return t;
}
interface Ref { value: number }

export class SwAutoFormat {
  m_aFlags: SvxSwAutoFormatFlags;
  m_aDelPam: SwPaM;            // a Pam that can be used
  m_aNdIdx: number;       // the index on the current TextNode
  m_aEndNdIdx: number;    // index on the end of the area
  m_pEditShell: SwWrtShell;
  m_pDoc: SwDoc;
  m_pCurTextNd: SwTextNode | null = null;     // the current TextNode
  /** The current TextNode's frame: the paragraph itself (frames are not merged). */
  m_pCurTextFrame: SwTextNode | null = null;
  m_bIsRightToLeft = false;      // text direction of the current frame
  m_bEnd = false;
  m_bMoreLines = false;
  m_pACorr: SvxAutoCorrect;

  // the scan flags of GetDigitLevel
  static readonly NONE = 0; static readonly DELIM = 1; static readonly DIGIT = 2; static readonly CHG = 4;
  static readonly LOWER_ALPHA = 8; static readonly UPPER_ALPHA = 16; static readonly LOWER_ROMAN = 32; static readonly UPPER_ROMAN = 64;
  static readonly NO_DELIM = 2 | 8 | 16 | 32 | 64;

  static IsSpace(c: string | undefined): boolean
  { return (' ' === c || '\t' === c || '\n' === c || '　' === c /* Jap. space */); }

  private nodes() { return this.m_pDoc.GetNodes(); }
  private Info(pFrame: SwTextNode | null): SwTextFrameInfo { return new SwTextFrameInfo(this.m_pEditShell.m_pRoot, pFrame); }
  private GetCharClass_isLetterNumeric(s: string, i: number): boolean { return /[\p{L}\p{N}]/u.test(s[i] ?? ''); }

  /** sw::GotoNextLayoutTextFrame / GotoPrevLayoutTextFrame: the next or previous node index. */
  private static next(i: number): number { return i + 1; }
  private static prev(i: number): number { return i - 1; }

  GoNextPara(): void {
    let pNewNd: SwNode;
    do {
      // has to be checked twice before and after incrementation
      if (this.m_aNdIdx >= this.m_aEndNdIdx) {
        this.m_bEnd = true;
        return;
      }

      this.m_aNdIdx = SwAutoFormat.next(this.m_aNdIdx);
      if (this.m_aNdIdx >= this.m_aEndNdIdx) {
        this.m_bEnd = true;
        return;
      } else
        pNewNd = this.nodes().node(this.m_aNdIdx);

      // not a TextNode ->
      //      TableNode   : skip table
      //      NoTextNode   : skip nodes
      //      EndNode     : at the end, terminate
      if (pNewNd.IsEndNode()) {
        this.m_bEnd = true;
        return;
      } else if (pNewNd.IsTableNode())
        this.m_aNdIdx = (pNewNd as SwStartNode).EndOfSectionNode().GetIndex();
      else if (pNewNd.IsSectionNode()) {
        const rSect = (pNewNd as SwSectionNode).GetSection();
        if (rSect.m_bHidden || rSect.m_bProtectFlag)
          this.m_aNdIdx = (pNewNd as SwStartNode).EndOfSectionNode().GetIndex();
      }
    } while (!pNewNd.IsTextNode());

    this.m_pCurTextNd = pNewNd;
    this.m_pCurTextFrame = this.m_pCurTextNd;
    this.m_bIsRightToLeft = this.m_pCurTextNd.GetAttr('RES_FRAMEDIR') === 'rl-tb';
  }

  static HasObjects(rFrame: SwTextNode): boolean {
    // Is there something bound to the paragraph in the paragraph
    // like Frames, DrawObjects, ...
    return rFrame.m_aAnchoredFlys.length > 0;
  }

  GetNextNode(isCheckEnd = true): SwTextNode | null {
    const tmp = SwAutoFormat.next(this.m_aNdIdx);
    if ((isCheckEnd && this.m_aEndNdIdx <= tmp) || tmp >= this.nodes().Count()) return null;
    const n = this.nodes().node(tmp);
    return n.IsTextNode() ? n : null;
  }

  IsOneLine(rFrame: SwTextNode): boolean {
    return this.Info(rFrame).IsOneLine();
  }

  IsFastFullLine(rFrame: SwTextNode): boolean {
    let bRet = this.m_aFlags.bRightMargin;
    if (bRet) {
      bRet = this.Info(rFrame).IsFilled(this.m_aFlags.nRightMargin);
    }
    return bRet;
  }

  IsEnumericChar(rFrame: SwTextNode): boolean {
    const rText = rFrame.GetText();
    const bIsShortBullet = rText === '* ' || rText === '- ';
    const nMinLen = bIsShortBullet ? 1 : 2;
    const nBlanks = SwAutoFormat.GetLeadingBlanks(rText);
    const nLen = rText.length - nBlanks;
    if (!nLen)
      return false;

    // -, +, * separated by blank ??
    if (nMinLen < nLen && SwAutoFormat.IsSpace(rText[nBlanks + 1])) {
      if (pBulletChar.includes(rText[nBlanks]!))
        return true;
      // Should there be a symbol font at the position?
      if (this.Info(rFrame).IsBullet(nBlanks))
        return true;
    }

    // 1.) / 1. / 1.1.1 / (1). / (1) / ...
    return USHRT_MAX !== this.GetDigitLevel(rFrame, { value: nBlanks });
  }

  static IsBlanksInString(rFrame: SwTextNode): boolean {
    // Search more than 5 consecutive blanks/tabs in the string.
    const sTmp = SwAutoFormat.DelLeadingBlanks(rFrame.GetText());
    const nLen = sTmp.length;
    let nIdx = 0;
    while (nIdx < nLen) {
      // Skip non-blanks
      while (nIdx < nLen && !SwAutoFormat.IsSpace(sTmp[nIdx])) ++nIdx;
      if (nIdx === nLen)
        return false;
      // Then count consecutive blanks
      const nFirst = nIdx;
      while (nIdx < nLen && SwAutoFormat.IsSpace(sTmp[nIdx])) ++nIdx;
      // And exit if enough consecutive blanks were found
      if (nIdx - nFirst > 5)
        return true;
    }
    return false;
  }

  CalcLevel(rFrame: SwTextNode, pDigitLvl?: Ref): number {
    let nLvl = 0, nBlnk = 0;
    const rText = rFrame.GetText();
    if (pDigitLvl)
      pDigitLvl.value = USHRT_MAX;

    if (RES_POOLCOLL_TEXT_MOVE === rFrame.GetTextColl().GetName()) {
      if (this.m_aFlags.bAFormatByInput) {
        // on the *second* invocation of AutoFormat, CalcLevel() retrieves the number of tabs that
        // BuildTextIndent() stored in the node, and BuildHeadLine() uses it.
        nLvl = rFrame.m_nAutoFormatLvl ?? 0;
        rFrame.m_nAutoFormatLvl = 0;
        if (nLvl)
          return nLvl;
      }
      ++nLvl;
    }

    for (let n = 0, nEnd = rText.length; n < nEnd; ++n) {
      switch (rText[n]) {
        case ' ': if (3 === ++nBlnk) {
          ++nLvl;
          nBlnk = 0;
        }
          break;
        case '\t': ++nLvl;
          nBlnk = 0;
          break;
        default:
          if (pDigitLvl)
            // test 1.) / 1. / 1.1.1 / (1). / (1) / ...
            pDigitLvl.value = this.GetDigitLevel(rFrame, { value: n });
          return nLvl;
      }
    }
    return nLvl;
  }

  IsNoAlphaLine(rFrame: SwTextNode): boolean {
    const rStr = rFrame.GetText();
    if (!rStr)
      return false;
    // or better: determine via number of AlphaNum and !AlphaNum characters
    let nANChar = 0, nBlnk = 0;

    for (let n = 0, nEnd = rStr.length; n < nEnd; ++n)
      if (SwAutoFormat.IsSpace(rStr[n]))
        ++nBlnk;
      else if (this.GetCharClass_isLetterNumeric(rStr, n))
        ++nANChar;

    // If there are 75% of non-alphanumeric characters, then true
    let nLen = rStr.length - nBlnk;
    nLen = Math.trunc((nLen * 3) / 4);
    return nLen < (rStr.length - nANChar - nBlnk);
  }

  DoUnderline(): boolean {
    if (!this.m_aFlags.bSetBorder)
      return false;

    const rText = this.m_pCurTextFrame!.GetText();
    let eState = 0;
    let nCnt = 0;
    while (nCnt < rText.length) {
      let eTmp = 0;
      switch (rText[nCnt]) {
        case '-': eTmp = 1; break;
        case '_': eTmp = 2; break;
        case '=': eTmp = 3; break;
        case '*': eTmp = 4; break;
        case '~': eTmp = 5; break;
        case '#': eTmp = 6; break;
        default:
          return false;
      }
      if (0 === eState)
        eState = eTmp;
      else if (eState !== eTmp)
        return false;
      ++nCnt;
    }

    if (2 < nCnt) {
      // then underline the previous paragraph if one exists
      this.DelEmptyLine(false); // -> point will be on end of current paragraph
      // WARNING: rText may be deleted now, m_pCurTextFrame may be nullptr
      // apply to last node & rely on InsertItemSet to apply it to props-node

      let nWidth = 0;
      switch (eState) {
        case 1: nWidth = SvxBorderLineWidth.Hairline; break;   // single, hairline
        case 2: nWidth = SvxBorderLineWidth.Thin; break;       // single, thin
        case 3: nWidth = SvxBorderLineWidth.Thin; break;       // double, thin
        case 4: nWidth = SvxBorderLineWidth.Thick; break;      // double, thick/thin
        case 5: nWidth = SvxBorderLineWidth.Thick; break;      // double, thin/thick
        case 6: nWidth = SvxBorderLineWidth.Medium; break;     // double, medium
      }
      const aSet: SwAttrSet = {
        RES_PARATR_CONNECT_BORDER: false,
        RES_BOX: { top: null, left: null, right: null, bottom: { color: '#000000', width: nWidth }, padding: 42 }, // ~0,75 mm
      };
      this.m_pDoc.SetParaAttr(this.m_aDelPam, aSet);

      this.m_aDelPam.DeleteMark();
    }
    return 2 < nCnt;
  }

  DoTable(): boolean {
    if (!this.m_aFlags.bCreateTable || !this.m_aFlags.bAFormatByInput ||
      this.m_pCurTextNd!.FindTableBoxStartNode())
      return false;

    const rTmp = this.m_pCurTextFrame!.GetText();
    const nSttPlus = SwAutoFormat.GetLeadingBlanks(rTmp);
    const nEndPlus = SwAutoFormat.GetTrailingBlanks(rTmp);
    let cChar: string;

    if (2 > nEndPlus - nSttPlus
      || ('+' !== (cChar = rTmp[nSttPlus]!) && '|' !== cChar)
      || ('+' !== (cChar = rTmp[nEndPlus - 1]!) && '|' !== cChar))
      return false;

    let n = nSttPlus;
    const aPosArr: number[] = [];

    while (n < rTmp.length) {
      switch (rTmp[n]) {
        case '-':
        case '_':
        case '=':
        case ' ':
        case '\t':
          break;

        case '+':
        case '|':
          aPosArr.push(n);
          break;

        default:
          return false;
      }
      if (++n === nEndPlus)
        break;
    }

    if (1 < aPosArr.length) {
      const nColCnt = aPosArr.length - 1;

      // then create a table that matches the character
      this.DelEmptyLine();
      // WARNING: rTmp may be deleted now, m_pCurTextFrame may be nullptr
      const pNext = this.nodes().node(this.m_aDelPam.GetPoint().GetNodeIndex() + 1);
      if (pNext.IsTextNode()) {
        const aPam = new SwPaM(new SwPosition(pNext, 0));
        this.m_pDoc.InsertTable(aPam, 1, nColCnt, { heading: false, repeatHeading: false, borders: true });
        aPam.Release();
      }
    }
    return 1 < aPosArr.length;
  }

  static DelLeadingBlanks(rStr: string): string {
    let n: number;
    const nL = rStr.length;
    for (n = 0; n < nL && SwAutoFormat.IsSpace(rStr[n]); ++n)
      ;
    if (n) // no Spaces
      return rStr.slice(n);
    return rStr;
  }

  static DelTrailingBlanks(rStr: string): string {
    const nL = rStr.length;
    let n = nL;
    if (!nL)
      return rStr;

    while (--n && SwAutoFormat.IsSpace(rStr[n]))
      ;
    if (n + 1 !== nL) // no Spaces
      return rStr.slice(0, n + 1);
    return rStr;
  }

  static GetLeadingBlanks(aStr: string): number {
    let n: number;
    const nL = aStr.length;
    for (n = 0; n < nL && SwAutoFormat.IsSpace(aStr[n]); ++n)
      ;
    return n;
  }

  static GetTrailingBlanks(aStr: string): number {
    const nL = aStr.length;
    let n = nL;
    if (!nL)
      return 0;

    while (--n && SwAutoFormat.IsSpace(aStr[n]))
      ;
    return ++n;
  }

  IsFirstCharCapital(rFrame: SwTextNode): boolean {
    const rText = rFrame.GetText();
    for (let n = 0, nEnd = rText.length; n < nEnd; ++n)
      if (!SwAutoFormat.IsSpace(rText[n])) {
        return /\p{Lu}|\p{Lt}/u.test(rText[n]!);
      }
    return false;
  }

  GetDigitLevel(rFrame: SwTextNode, rPos: Ref, pPrefix?: Ref_s, pPostfix?: Ref_s, pNumTypes?: Ref_s): number {
    const { DELIM, DIGIT, CHG, LOWER_ALPHA, UPPER_ALPHA, LOWER_ROMAN, UPPER_ROMAN, NO_DELIM, NONE } = SwAutoFormat;
    // check for 1.) / 1. / 1.1.1 / (1). / (1) / ...
    const rText = rFrame.GetText();
    let nPos = rPos.value;
    let eScan: number = NONE;

    let nStart = 0;
    let nDigitLvl = 0, nDigitCnt = 0;
    // count number of parenthesis to assure a sensible order is found
    let nOpeningParentheses = 0;
    let nClosingParentheses = 0;
    const num = (t: number) => String.fromCharCode('0'.charCodeAt(0) + t);

    while (nPos < rText.length && nDigitLvl < MAXLEVEL - 1) {
      const cCurrentChar = rText[nPos]!;
      const c = cCurrentChar.charCodeAt(0);
      if (('0' <= cCurrentChar && '9' >= cCurrentChar) ||
        (0xff10 <= c && 0xff19 >= c)) {
        if (eScan & DELIM) {
          if (eScan & CHG) {   // not if it starts with a number
            ++nDigitLvl;
            if (pPostfix)
              pPostfix.value += '\x01';
          }

          if (pNumTypes)
            pNumTypes.value += num(NumberingType.ARABIC);

          eScan = eScan | CHG;
        } else if (pNumTypes && !(eScan & DIGIT))
          pNumTypes.value += num(NumberingType.ARABIC);

        eScan &= ~DELIM;        // remove Delim
        if (0 !== (eScan & ~CHG) && DIGIT !== (eScan & ~CHG))
          return USHRT_MAX;

        eScan |= DIGIT;         // add Digit
        if (3 === ++nDigitCnt)  // more than 2 numbers are not an enum anymore
          return USHRT_MAX;

        nStart *= 10;
        nStart += cCurrentChar <= '9' ? c - 48 : c - 0xff10;
      } else if (/\p{L}/u.test(cCurrentChar)) {
        const bIsUpper = /\p{Lu}/u.test(cCurrentChar);
        const cLow = cCurrentChar.toLowerCase()[0]!;
        let cNumTyp: string;
        let eTmpScan: number;

        // Roman numbers are "mdclxvi". Since we want to start numbering with c or d more often,
        // convert first to characters and later to roman numbers if needed.
        if (cLow.charCodeAt(0) < 256 && 'mdclxvi'.includes(cLow)) {
          if (bIsUpper) {
            cNumTyp = num(NumberingType.ROMAN_UPPER);
            eTmpScan = UPPER_ROMAN;
          } else {
            cNumTyp = num(NumberingType.ROMAN_LOWER);
            eTmpScan = LOWER_ROMAN;
          }
        } else if (bIsUpper) {
          cNumTyp = num(NumberingType.CHARS_UPPER_LETTER);
          eTmpScan = UPPER_ALPHA;
        } else {
          cNumTyp = num(NumberingType.CHARS_LOWER_LETTER);
          eTmpScan = LOWER_ALPHA;
        }

        // Switch to roman numbers (only for c/d!)
        if (1 === nDigitCnt && (eScan & (UPPER_ALPHA | LOWER_ALPHA)) &&
          (3 === nStart || 4 === nStart) && cLow.charCodeAt(0) < 256 &&
          'mdclxvi'.includes(cLow) &&
          ((eScan & UPPER_ALPHA) ? (eTmpScan & (UPPER_ALPHA | UPPER_ROMAN))
            : (eTmpScan & (LOWER_ALPHA | LOWER_ROMAN)))) {
          let cc: string;
          nStart = 3 === nStart ? 100 : 500;
          if (UPPER_ALPHA === eTmpScan) {
            eTmpScan = UPPER_ROMAN;
            cc = num(NumberingType.ROMAN_UPPER);
          } else {
            eTmpScan = LOWER_ROMAN;
            cc = num(NumberingType.ROMAN_LOWER);
          }

          eScan = (eScan & ~(UPPER_ALPHA | LOWER_ALPHA)) | eTmpScan;
          if (pNumTypes)
            pNumTypes.value = pNumTypes.value.slice(0, -1) + cc;
        }

        if (eScan & DELIM) {
          if (eScan & CHG) {   // not if it starts with a number
            ++nDigitLvl;
            if (pPostfix)
              pPostfix.value += '\x01';
          }

          if (pNumTypes)
            pNumTypes.value += cNumTyp;
          eScan = eScan | CHG;
        } else if (pNumTypes && !(eScan & eTmpScan))
          pNumTypes.value += cNumTyp;

        eScan &= ~DELIM;        // remove Delim

        // if another type is set, stop here
        if (0 !== (eScan & ~CHG) && eTmpScan !== (eScan & ~CHG))
          return USHRT_MAX;

        if (eTmpScan & (UPPER_ALPHA | LOWER_ALPHA)) {
          // allow characters only if they appear once
          return USHRT_MAX;
        } else {
          // roman numbers, check if valid characters
          let bError = false;
          const CHECK_ROMAN_1 = (nVal: number) => {
            const nMod5 = nStart % (nVal * 5);
            const nLast = nStart % nVal;
            const n10 = nVal / 10;

            if (nMod5 === ((3 * nVal) + n10) ||
              nMod5 === ((4 * nVal) + n10) ||
              nLast === n10)
              nStart = nStart + (n10 * 8);
            else if (nMod5 === 0 ||
              nMod5 === (1 * nVal) ||
              nMod5 === (2 * nVal))
              nStart = nStart + nVal;
            else
              bError = true;
          };
          const CHECK_ROMAN_5 = (nVal: number) => {
            if (Math.trunc(nStart / nVal) & 1)
              bError = true;
            else {
              const nMod = nStart % nVal;
              const n10 = nVal / 5;
              if (n10 === nMod)
                nStart = nStart + (3 * n10);
              else if (0 === nMod)
                nStart = nStart + nVal;
              else
                bError = true;
            }
          };
          switch (cLow) {
            case 'm': CHECK_ROMAN_1(1000); break;
            case 'd': CHECK_ROMAN_5(500); break;
            case 'c': CHECK_ROMAN_1(100); break;
            case 'l': CHECK_ROMAN_5(50); break;
            case 'x': CHECK_ROMAN_1(10); break;
            case 'v': CHECK_ROMAN_5(5); break;
            case 'i':
              if (nStart % 5 >= 3)
                bError = true;
              else
                nStart += 1;
              break;
            default:
              bError = true;
          }

          if (bError)
            return USHRT_MAX;
        }
        eScan |= eTmpScan;          // add Digit
        ++nDigitCnt;
      } else if ((c < 256 &&
        '.)('.includes(cCurrentChar)) ||
        0x3002 === c /* Chinese trad. dot */ ||
        0xff0e === c /* Japanese dot */ ||
        0xFF08 === c /* opening bracket Chin./Jap.*/ ||
        0xFF09 === c) { /* closing bracket Chin./Jap. */
        if (cCurrentChar === '(' || c === 0xFF09)
          nOpeningParentheses++;
        else if (cCurrentChar === ')' || c === 0xFF08)
          nClosingParentheses++;
        // only if no numbers were read until here
        if (pPrefix && !(eScan & (NO_DELIM | CHG)))
          pPrefix.value += rText[nPos];
        else if (pPostfix)
          pPostfix.value += rText[nPos];

        if (NO_DELIM & eScan) {
          eScan |= CHG;
          if (pPrefix)
            pPrefix.value += '\x01' + String(nStart);
        }
        eScan &= ~NO_DELIM;     // remove Delim
        eScan |= DELIM;         // add Digit
        nDigitCnt = 0;
        nStart = 0;
      } else
        break;
      ++nPos;
    }
    if (!(CHG & eScan) || rPos.value === nPos ||
      nPos === rText.length || !SwAutoFormat.IsSpace(rText[nPos]) ||
      (nOpeningParentheses > nClosingParentheses))
      return USHRT_MAX;

    if ((NO_DELIM & eScan) && pPrefix)     // do not forget the last one
      pPrefix.value += '\x01' + String(nStart);

    rPos.value = nPos;
    return nDigitLvl;       // 0 .. 9 (MAXLEVEL - 1)
  }

  /** DocumentStylePoolManager::GetTextCollFromPool, reduced: the style, made with its indent if missing. */
  private GetTextCollFromPool(sName: string): SwTextFormatColl {
    let pColl = this.m_pDoc.FindTextFormatCollByName(sName);
    if (!pColl) {
      const lr = POOL_INDENTS[sName];
      const parent = this.m_pDoc.FindTextFormatCollByName(sName.startsWith('List') || sName.startsWith('Numbering') ? RES_POOLCOLL_STANDARD : RES_POOLCOLL_TEXT)
        ?? this.m_pDoc.FindTextFormatCollByName(RES_POOLCOLL_STANDARD)!;
      pColl = this.m_pDoc.MakeColl(sName, parent, lr ? { RES_LR_SPACE: { left: lr.left, right: 0, firstLine: lr.firstLine } } : {});
    }
    return pColl;
  }

  SetColl(nId: string, bHdLineOrText = false): void {
    this.m_aDelPam.DeleteMark();
    const pNd = this.m_pCurTextFrame!;
    this.m_aDelPam.GetPoint().Assign(pNd, 0);
    this.m_aDelPam.GetMark().Assign(pNd, 0);

    // keep hard tabs, alignment, language, hyphenation, DropCaps and nearly all frame attributes
    const aSet: SwAttrSet = {};
    const keep = ['RES_PARATR_ADJUST', 'RES_PARATR_TABSTOP', 'RES_PARATR_HYPHENZONE', 'RES_PARATR_DROP', 'RES_BACKGROUND', 'RES_BOX', 'RES_SHADOW',
      'RES_PARATR_NUMRULE', 'RES_PARATR_LIST_ID', 'RES_PARATR_LIST_LEVEL', 'RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE', 'RES_PARATR_LIST_ISCOUNTED'];
    const own = pNd.m_aSet as Record<string, unknown>;
    for (const k of keep) if (k in own) (aSet as Record<string, unknown>)[k] = own[k];
    // take HeaderLine/TextBody only if centered or right aligned, otherwise only justification
    const eAdj = aSet.RES_PARATR_ADJUST;
    if (eAdj !== undefined) {
      if (bHdLineOrText ? ('right' !== eAdj && 'center' !== eAdj) : 'block' !== eAdj)
        delete aSet.RES_PARATR_ADJUST;
    }

    // SwDoc::SetTextFormatCollByAutoFormat
    this.m_pDoc.SetTextFormatColl(this.m_aDelPam, this.GetTextCollFromPool(nId));
    if (Object.keys(aSet).length) this.m_pDoc.SetParaAttr(this.m_aDelPam, aSet);
  }

  static HasSelBlanks(pStartFrame: SwTextNode, rStartIndex: Ref, pEndFrame: SwTextNode, rEndIndex: Ref): boolean {
    if (0 < rEndIndex.value
      && rEndIndex.value < pEndFrame.GetText().length
      && ' ' === pEndFrame.GetText()[rEndIndex.value - 1]) {
      --rEndIndex.value;
      return true;
    }
    if (rStartIndex.value < pStartFrame.GetText().length
      && ' ' === pStartFrame.GetText()[rStartIndex.value]) {
      ++rStartIndex.value;
      return true;
    }
    return false;
  }

  static HasBreakAttr(rTextFrame: SwTextNode): boolean {
    const pSet = rTextFrame.m_aSet;
    if (pSet.RES_BREAK) return true;
    if (pSet.RES_PAGEDESC) return true;
    return false;
  }

  /// Is there a dot at the end?
  static IsSentenceAtEnd(rTextFrame: SwTextNode): boolean {
    const rStr = rTextFrame.GetText();
    let n = rStr.length;
    if (!n)
      return true;

    while (--n && SwAutoFormat.IsSpace(rStr[n]))
      ;
    return '.' === rStr[n];
  }

  private setPam(nStt: number, nEnd: number, pStt = this.m_pCurTextFrame!, pEnd = pStt): void {
    this.m_aDelPam.GetMark().Assign(pStt, nStt);
    this.m_aDelPam.GetPoint().Assign(pEnd, nEnd);
  }

  DeleteTrailingBlanksNoConfig(): void {
    const nPos = SwAutoFormat.GetTrailingBlanks(this.m_pCurTextFrame!.GetText());

    if (this.m_pCurTextFrame!.GetText().length !== nPos) {
      this.setPam(this.m_pCurTextFrame!.GetText().length, nPos);
      this.DeleteSel(this.m_aDelPam);
      this.m_aDelPam.DeleteMark();
    }
  }

  /// Delete beginning and/or end in a node
  DeleteLeadingTrailingBlanks(bStart = true, bEnd = true): void {
    if (!(this.m_aFlags.bAFormatByInput
      ? this.m_aFlags.bAFormatByInpDelSpacesAtSttEnd
      : this.m_aFlags.bAFormatDelSpacesAtSttEnd))
      return;

    // delete blanks at the end of the current and at the beginning of the next one
    this.m_aDelPam.DeleteMark();
    const nPos = SwAutoFormat.GetLeadingBlanks(this.m_pCurTextFrame!.GetText());
    if (bStart && 0 !== nPos) {
      this.setPam(0, nPos);
      this.DeleteSel(this.m_aDelPam);
      this.m_aDelPam.DeleteMark();
    }
    if (bEnd)
      this.DeleteTrailingBlanksNoConfig();
  }

  DeleteSel(rDelPam: SwPaM): void {
    // SwEditShell::DeleteSel; with redlining, the deletion is recorded as a change.
    const idx = this.m_pCurTextNd ? new SwPosition(this.m_pCurTextNd, 0) : null;
    this.m_pDoc.DeleteAndJoin(rDelPam);
    if (idx) {
      this.m_aNdIdx = idx.GetNodeIndex();
      this.m_pCurTextNd = idx.GetNode();
      this.m_pCurTextFrame = this.m_pCurTextNd; // keep it up to date
      idx.Release();
    }
  }

  DeleteJoinCurNextPara(pNextFrame: SwTextNode | null, bIgnoreLeadingBlanks = false): boolean {
    // delete blanks at the end of the current and at the beginning of the next one
    this.m_aDelPam.DeleteMark();
    const nTrailingPos = { value: SwAutoFormat.GetTrailingBlanks(this.m_pCurTextFrame!.GetText()) };

    const pEndFrame = pNextFrame ?? this.m_pCurTextFrame!;
    const nLeadingPos = { value: 0 };
    if (pNextFrame) {
      nLeadingPos.value = bIgnoreLeadingBlanks ? 0 : SwAutoFormat.GetLeadingBlanks(pNextFrame.GetText());
    } else {
      nLeadingPos.value = this.m_pCurTextFrame!.GetText().length;
    }

    // Is there a Blank at the beginning or end?
    // Do not delete it, it will be inserted again.
    const bHasBlnks = SwAutoFormat.HasSelBlanks(this.m_pCurTextFrame!, nTrailingPos, pEndFrame, nLeadingPos);

    this.setPam(nTrailingPos.value, nLeadingPos.value, this.m_pCurTextFrame!, pEndFrame);

    if (this.m_aDelPam.HasMark())
      this.DeleteSel(this.m_aDelPam);
    this.m_aDelPam.DeleteMark();
    // note: keep m_aDelPam point at insert pos. for clients

    return !bHasBlnks;
  }

  DelEmptyLine(bTstNextPara = true): void {
    // delete blanks in empty paragraph
    this.m_aDelPam.DeleteMark();
    const cur = this.m_pCurTextFrame!;
    this.m_aDelPam.GetPoint().Assign(cur, 0);

    const prev = this.nodes().node(cur.GetIndex() - 1);
    let pTNd: SwTextNode | null = prev.IsTextNode() ? prev : null;
    if (pTNd)
      // first use the previous text node
      this.m_aDelPam.GetMark().Assign(pTNd, pTNd.GetText().length);
    else if (bTstNextPara) {
      // then try the next (at the beginning of a Doc, table cells, frames, ...)
      const next = this.nodes().node(cur.GetIndex() + 1);
      pTNd = next.IsTextNode() ? next : null;
      if (pTNd) {
        this.m_aDelPam.GetMark().Assign(pTNd, 0);
        this.m_aDelPam.GetPoint().Assign(cur, cur.GetText().length);
      }
    }
    if (pTNd) {   // join with previous or next paragraph
      this.DeleteSel(this.m_aDelPam);
    }
    // mark remains at join position
    const pJoined = this.m_aDelPam.GetPoint().GetNode();
    const nJoin = this.m_aDelPam.GetPoint().GetContentIndex();
    this.m_pCurTextFrame = pJoined;
    // replace until the end of the merged paragraph
    if (nJoin !== pJoined.GetText().length) {
      // tdf#137245 replace (not delete) to preserve any flys
      this.setPam(nJoin, pJoined.GetText().length, pJoined);
      this.m_pDoc.DeleteAndJoin(this.m_aDelPam);
    }
    this.m_aDelPam.GetPoint().Assign(pJoined, nJoin);
    this.m_aDelPam.DeleteMark();
    // note: this likely has deleted m_pCurTextFrame - update it...
    this.m_pCurTextNd = pJoined;
    this.m_aNdIdx = pJoined.GetIndex();
    this.m_pCurTextFrame = this.m_pCurTextNd;
  }

  DelMoreLinesBlanks(bWithLineBreaks = false): void {
    if (!(this.m_aFlags.bAFormatByInput
      ? this.m_aFlags.bAFormatByInpDelSpacesBetweenLines
      : this.m_aFlags.bAFormatDelSpacesBetweenLines))
      return;

    // delete all blanks on the left and right of the indentation
    this.m_aDelPam.DeleteMark();

    const spaces: [number, number][] = [];
    this.Info(this.m_pCurTextFrame).GetSpaces(spaces, !this.m_aFlags.bAFormatByInput || bWithLineBreaks);

    // tdf#123285 iterate backwards - delete invalidates following indexes
    for (const rSpaceRange of spaces.reverse()) {
      const a = { value: rSpaceRange[0] }, b = { value: rSpaceRange[1] };
      const bHasBlanks = SwAutoFormat.HasSelBlanks(this.m_pCurTextFrame!, a, this.m_pCurTextFrame!, b);
      if (a.value !== b.value) {
        this.setPam(b.value, a.value);
        this.DeleteSel(this.m_aDelPam);
        if (!bHasBlanks) {
          this.m_pDoc.InsertString(this.m_aDelPam, ' ');
        }
        this.m_aDelPam.DeleteMark();
      }
    }
  }

  JoinPrevPara(): void {
    this.m_aDelPam.DeleteMark();
    const cur = this.m_pCurTextFrame!;
    const prev = this.nodes().node(cur.GetIndex() - 1);
    if (prev.IsTextNode()) {
      // use the previous text node first
      this.setPam(0, prev.GetText().length, cur, prev);
      this.DeleteSel(this.m_aDelPam);
    }
    this.m_aDelPam.DeleteMark();
  }

  private CanJoin(pNextFrame: SwTextNode | null): pNextFrame is SwTextNode {
    return !this.m_bEnd && !!pNextFrame
      && !SwAutoFormat.IsEmptyLine(pNextFrame)
      && !this.IsNoAlphaLine(pNextFrame)
      && !this.IsEnumericChar(pNextFrame)
      && !SwAutoFormat.HasBreakAttr(pNextFrame);
  }

  static IsEmptyLine(rFrame: SwTextNode): boolean {
    return !rFrame.GetText()
      || rFrame.GetText().length === SwAutoFormat.GetLeadingBlanks(rFrame.GetText());
  }

  /** Joins the following paragraphs that belong to the current one (BuildText, BuildIndent, ...). */
  private joinFollowing(cond: (pNextFrame: SwTextNode) => boolean): void {
    let pNextFrame = this.GetNextNode();
    while (this.CanJoin(pNextFrame) && cond(pNextFrame)) {
      const bBreak = !this.IsFastFullLine(pNextFrame)
        || SwAutoFormat.IsBlanksInString(pNextFrame)
        || SwAutoFormat.IsSentenceAtEnd(pNextFrame);
      if (this.DeleteJoinCurNextPara(pNextFrame)) {
        this.m_pDoc.InsertString(this.m_aDelPam, ' ');
      }
      if (bBreak)
        break;
      const pCurrNode = pNextFrame;
      pNextFrame = this.GetNextNode();
      if (!pNextFrame || pCurrNode === pNextFrame)
        break;
    }
  }

  BuildIndent(): void {
    // read all succeeding paragraphs that belong to this indentation
    let bBreak = true;
    if (this.m_bMoreLines)
      this.DelMoreLinesBlanks(true);
    else
      bBreak = !this.IsFastFullLine(this.m_pCurTextFrame!)
        || SwAutoFormat.IsBlanksInString(this.m_pCurTextFrame!)
        || SwAutoFormat.IsSentenceAtEnd(this.m_pCurTextFrame!);
    this.SetColl(RES_POOLCOLL_TEXT_IDENT);
    if (!bBreak)
      this.joinFollowing((n) => !this.CalcLevel(n));
    this.DeleteLeadingTrailingBlanks();
    this.AutoCorrect();
  }

  BuildTextIndent(): void {
    // read all succeeding paragraphs that belong to this indentation
    let bBreak = true;
    if (this.m_bMoreLines)
      this.DelMoreLinesBlanks(true);
    else
      bBreak = !this.IsFastFullLine(this.m_pCurTextFrame!)
        || SwAutoFormat.IsBlanksInString(this.m_pCurTextFrame!)
        || SwAutoFormat.IsSentenceAtEnd(this.m_pCurTextFrame!);

    if (this.m_aFlags.bAFormatByInput) {
      this.m_pCurTextFrame!.m_nAutoFormatLvl = this.CalcLevel(this.m_pCurTextFrame!);
    }

    this.SetColl(RES_POOLCOLL_TEXT_MOVE);
    if (!bBreak)
      this.joinFollowing((n) => !!this.CalcLevel(n));
    this.DeleteLeadingTrailingBlanks();
    this.AutoCorrect();
  }

  BuildText(): void {
    // read all succeeding paragraphs that belong to this text without indentation
    let bBreak = true;
    if (this.m_bMoreLines)
      this.DelMoreLinesBlanks();
    else
      bBreak = !this.IsFastFullLine(this.m_pCurTextFrame!)
        || SwAutoFormat.IsBlanksInString(this.m_pCurTextFrame!)
        || SwAutoFormat.IsSentenceAtEnd(this.m_pCurTextFrame!);
    if (!bBreak)
      this.joinFollowing((n) => !this.CalcLevel(n));
    this.DeleteLeadingTrailingBlanks();
    this.AutoCorrect();
  }

  BuildEnum(nLvl: number, nDigitLevel: number): void {
    let bBreak = true;
    const cur = this.m_pCurTextFrame!;

    // first, determine current indentation and frame width
    let nLeftTextPos: number;
    {
      let nPos = 0;
      while (nPos < cur.GetText().length
        && SwAutoFormat.IsSpace(cur.GetText()[nPos])) {
        ++nPos;
      }

      nLeftTextPos = this.Info(cur).GetCharPos(nPos);
      nLeftTextPos -= cur.GetAttr('RES_LR_SPACE')?.left ?? 0;
    }

    if (this.m_bMoreLines)
      this.DelMoreLinesBlanks();
    else
      bBreak = !this.IsFastFullLine(cur)
        || SwAutoFormat.IsBlanksInString(cur)
        || SwAutoFormat.IsSentenceAtEnd(cur);
    const bRTL = this.m_bIsRightToLeft;

    const sStrWithTrailingBlanks = SwAutoFormat.DelLeadingBlanks(cur.GetText());
    const bIsShortBullet = sStrWithTrailingBlanks === '* ' || sStrWithTrailingBlanks === '- ';
    const nMinLen = bIsShortBullet ? 1 : 2;

    // only delete blanks if something else (numbering or style) is going to be changed
    if (this.m_aFlags.bSetNumRule || !this.m_aFlags.bAFormatByInput || this.m_aFlags.bReplaceStyles)
      this.DeleteTrailingBlanksNoConfig();

    let bChgBullet = false, bChgEnum = false;
    let nAutoCorrPos = 0;

    // if numbering is set, get the current one
    let aRule = new SwNumRule(this.m_pDoc.GetUniqueNumRuleName());

    let pCur: SwNumRule | undefined;
    if (this.m_aFlags.bSetNumRule) {
      pCur = this.m_pDoc.FindNumRulePtr(cur.GetAttr('RES_PARATR_NUMRULE'));
      if (pCur) {
        aRule = pCur.Clone();
      }
    }

    // replace bullet character with defined one
    const rStr = bIsShortBullet ? sStrWithTrailingBlanks : cur.GetText();
    const nTextStt = { value: 0 };
    let pFndBulletChr = -1;
    if (this.m_aFlags.bChgEnumNum && nMinLen < rStr.length)
      pFndBulletChr = pBulletChar.indexOf(rStr[nTextStt.value]!);
    if (-1 !== pFndBulletChr && SwAutoFormat.IsSpace(rStr[nTextStt.value + 1])) {
      if (this.m_aFlags.bAFormatByInput) {
        if (this.m_aFlags.bSetNumRule) {
          bChgBullet = true;
          // Was the format already somewhere adjusted?
          if (!pCur) {
            const nBulletPos = pFndBulletChr;
            let cBullChar: string;
            if (nBulletPos < cnPosEnDash) {
              cBullChar = this.m_aFlags.cBullet;
            } else {
              cBullChar = nBulletPos < cnPosEmDash
                ? cStarSymbolEnDash
                : cStarSymbolEmDash;
            }

            for (let n = 0; n < MAXLEVEL; ++n) {
              const aFormat = aRule.Get(n).Clone();
              aFormat.SetBulletChar(cBullChar);
              aFormat.SetNumberingType(NumberingType.CHAR_SPECIAL);
              // #i93908# clear suffix for bullet lists
              aFormat.SetListFormat('', '', n);
              if (bRTL)
                aFormat.SetNumAdjust('right');

              aRule.Set(n, aFormat);
            }
          }
        }
      } else {
        bChgBullet = true;
        this.SetColl(RES_POOLCOLL_BULLET_LEVEL(Math.min(nLvl, cnNumBullColls)));
      }
    } else {
      // Then it is a numbering

      //JP 21.11.97: The NumLevel is either the DigitLevel or, if the latter is not existent or 0,
      //             it is determined by the indentation level.

      const aPostfix = { value: '' }, aPrefix = { value: '' }, aNumTypes = { value: '' };
      nDigitLevel = this.GetDigitLevel(cur, nTextStt, aPrefix, aPostfix, aNumTypes);
      if (USHRT_MAX !== nDigitLevel) {
        bChgEnum = true;

        // Level 0 and Indentation, determine level by left indentation and default NumIndent
        if (!nDigitLevel && nLeftTextPos > 0)
          nLvl = Math.min(Math.trunc(nLeftTextPos / 357), MAXLEVEL - 1);
        else
          nLvl = nDigitLevel;
      }

      if (bChgEnum && this.m_aFlags.bSetNumRule) {
        if (!pCur) {         // adjust NumRule if it is new
          const nPrefixIdx = { value: 0 };
          if (!nDigitLevel) {
            const aFormat = aRule.Get(nLvl).Clone();
            const sPrefix = getToken(aPrefix.value, '\x01', nPrefixIdx);
            aFormat.SetStart(parseInt(getToken(aPrefix.value, '\x01', nPrefixIdx), 10) || 0);
            aFormat.SetListFormat(sPrefix, getToken(aPostfix.value, '\x01', { value: 0 }), nLvl);
            aFormat.SetIncludeUpperLevels(0);

            if (aNumTypes.value)
              aFormat.SetNumberingType((aNumTypes.value.charCodeAt(0) - 48) as NumberingType);

            if (bRTL)
              aFormat.SetNumAdjust('right');
            aRule.Set(nLvl, aFormat);
          } else {
            let n: number;
            const nPostfixIdx = { value: 0 };
            for (n = 0; n <= nLvl; ++n) {
              const aFormat = aRule.Get(n).Clone();

              const sPrefix = n ? '' : getToken(aPrefix.value, '\x01', nPrefixIdx);
              aFormat.SetStart(parseInt(getToken(aPrefix.value, '\x01', nPrefixIdx), 10) || 0);
              aFormat.SetListFormat(sPrefix, getToken(aPostfix.value, '\x01', nPostfixIdx), n);
              aFormat.SetIncludeUpperLevels(MAXLEVEL);
              if (n < aNumTypes.value.length)
                aFormat.SetNumberingType((aNumTypes.value.charCodeAt(n) - 48) as NumberingType);

              if (bRTL)
                aFormat.SetNumAdjust('right');

              aRule.Set(n, aFormat);
            }

            for (; n < MAXLEVEL; ++n) {
              const aFormat = aRule.Get(n).Clone();
              aFormat.SetIncludeUpperLevels(MAXLEVEL);
              aRule.Set(n, aFormat);
            }
          }
        }
      } else if (!this.m_aFlags.bAFormatByInput)
        this.SetColl(RES_POOLCOLL_NUM_LEVEL(Math.min(nLvl, cnNumBullColls)));
      else
        bChgEnum = false;
    }

    if (bChgEnum || bChgBullet) {
      this.m_aDelPam.DeleteMark();
      this.m_aDelPam.GetPoint().Assign(cur, 0);
      this.m_aDelPam.GetMark().Assign(cur, 0);

      if (this.m_aFlags.bSetNumRule) {
        if (this.m_aFlags.bAFormatByInput) {
          const pNextFrame = this.GetNextNode(false);
          if (pNextFrame) {
            this.m_aDelPam.GetMark().Assign(pNextFrame, 0);
          }
        }

        // the list level of this paragraph and, while typing, of the next one
        this.m_pDoc.SetParaAttr(this.m_aDelPam, { RES_PARATR_LIST_LEVEL: nLvl });

        // start new list
        this.m_pDoc.SetNumRule(this.m_aDelPam, aRule, true);
        this.m_aDelPam.DeleteMark();

        this.m_aDelPam.GetPoint().Assign(cur, 0);
      } else {
        this.m_aDelPam.GetPoint().Assign(cur, bChgEnum ? nTextStt.value : 0);
      }
      this.m_aDelPam.GetMark().Assign(this.m_aDelPam.GetPoint().GetNode(), this.m_aDelPam.GetPoint().GetContentIndex());

      if (bChgBullet)
        nTextStt.value += bIsShortBullet ? 1 : 2;

      while (!bIsShortBullet && nTextStt.value < rStr.length && SwAutoFormat.IsSpace(rStr[nTextStt.value]))
        nTextStt.value++;

      this.m_aDelPam.GetPoint().Assign(cur, Math.min(nTextStt.value, cur.Len()));
      this.DeleteSel(this.m_aDelPam);

      if (!this.m_aFlags.bSetNumRule) {
        let sChgStr = '\t';
        if (bChgBullet)
          sChgStr = this.m_aFlags.cBullet + sChgStr;
        this.m_pDoc.InsertString(this.m_aDelPam, sChgStr);

        if (bChgBullet) {
          this.setPam(0, 1, cur);
          this.m_pDoc.InsertAttr(this.m_aDelPam, { RES_CHRATR_FONT: this.m_aFlags.aBulletFont });
          this.m_aDelPam.DeleteMark();
          nAutoCorrPos = 2;
        }
        this.m_aDelPam.GetPoint().Assign(cur, 0);
        this.m_aDelPam.DeleteMark();
        this.m_pDoc.SetParaAttr(this.m_aDelPam, { RES_PARATR_TABSTOP: [{ pos: 0, adjust: 'left', fill: ' ', decimal: '.' }] });
      }
    }

    if (bBreak) {
      this.AutoCorrect(nAutoCorrPos);       /* Offset due to Bullet + Tab */
      return;
    }

    this.joinFollowing((n) => nLvl === this.CalcLevel(n));
    this.DeleteLeadingTrailingBlanks(false);
    this.AutoCorrect(nAutoCorrPos);
  }

  BuildNegIndent(nSpaces: number): void {
    // Test of contraposition (n words, divided by spaces/tabs, with same indentation in 2nd line)

    // read all succeeding paragraphs that belong to this enumeration
    let bBreak = true;
    const nTextPos = 0; // GetBigIndent is not ported
    if (this.m_bMoreLines)
      this.DelMoreLinesBlanks(true);
    else
      bBreak = !this.IsFastFullLine(this.m_pCurTextFrame!)
        || (!nTextPos && SwAutoFormat.IsBlanksInString(this.m_pCurTextFrame!))
        || SwAutoFormat.IsSentenceAtEnd(this.m_pCurTextFrame!);

    this.SetColl(RES_POOLCOLL_TEXT_NEGIDENT);

    if (!bBreak)
      this.joinFollowing((n) => 20 < Math.abs(nSpaces - this.Info(n).GetLineStart()));
    this.DeleteLeadingTrailingBlanks();
    this.AutoCorrect();
  }

  BuildHeadLine(nLvl: number): void {
    this.SetColl(RES_POOLCOLL_HEADLINE(nLvl), true);
    if (this.m_aFlags.bAFormatByInput) {
      const rNxtColl = this.m_pCurTextFrame!.GetTextColl().GetNextTextFormatColl();

      this.JoinPrevPara();

      this.DeleteLeadingTrailingBlanks(true, false);
      let pNextFrame = this.GetNextNode(false);
      if (pNextFrame && this.nodes().node(pNextFrame.GetIndex() + 1).IsTextNode()) {
        this.DeleteJoinCurNextPara(pNextFrame, true);
        pNextFrame = this.GetNextNode(false);
      }
      if (pNextFrame) {
        this.m_aDelPam.DeleteMark();
        this.m_aDelPam.GetPoint().Assign(pNextFrame, 0);
        this.m_aDelPam.GetMark().Assign(pNextFrame, 0);
        this.m_pDoc.SetTextFormatColl(this.m_aDelPam, rNxtColl);
      }
    } else {
      this.DeleteLeadingTrailingBlanks();
      this.AutoCorrect();
    }
  }

  /// Start autocorrection for the current TextNode
  AutoCorrect(nPos = 0): void {
    const pATst = this.m_pACorr;
    const aSvxFlags = pATst.GetFlags();
    const bReplaceQuote = !!(aSvxFlags & ACFlags.ChgQuotes);
    const bReplaceSglQuote = !!(aSvxFlags & ACFlags.ChgSglQuotes);
    const f = this.m_aFlags;

    if (f.bAFormatByInput ||
      (!f.bAutoCorrect && !bReplaceQuote && !bReplaceSglQuote &&
        !f.bCapitalStartSentence && !f.bCapitalStartWord &&
        !f.bChgOrdinalNumber && !f.bTransliterateRTL &&
        !f.bChgToEnEmDash && !f.bSetINetAttr &&
        !f.bChgWeightUnderl && !f.bAddNonBrkSpace))
      return;

    const cur = this.m_pCurTextFrame!;
    const pText = () => cur.GetText();
    if (pText().length <= nPos)
      return;

    const bGetLanguage = f.bChgOrdinalNumber || f.bTransliterateRTL ||
      f.bChgToEnEmDash || f.bSetINetAttr ||
      f.bCapitalStartWord || f.bCapitalStartSentence ||
      f.bAddNonBrkSpace;

    this.m_aDelPam.DeleteMark();
    this.m_aDelPam.GetPoint().Assign(cur, 0);
    this.m_aDelPam.GetMark().Assign(cur, 0);

    const aACorrDoc = new SwAutoCorrDoc(this.m_pEditShell, this.m_aDelPam);

    const aFInfo = this.Info(cur);

    let nSttPos: number, nLastBlank = nPos;
    let bFirst = f.bCapitalStartSentence, bFirstSent = bFirst;
    let cChar = '';
    const bNbspRunNext = { value: false };
    const lang = (i: number) => (bGetLanguage ? cur.GetCharAttrAt('RES_CHRATR_LANGUAGE', Math.max(0, Math.min(i, cur.Len() - 1))) : '');
    const setPt = (i: number) => { this.m_aDelPam.GetPoint().Assign(cur, Math.min(i, cur.Len())); this.m_aDelPam.DeleteMark(); };

    do {
      while (nPos < pText().length
        && SwAutoFormat.IsSpace(cChar = pText()[nPos]!))
        ++nPos;
      if (nPos === pText().length)
        break;      // that's it

      if (((bReplaceQuote && '"' === cChar) ||
        (bReplaceSglQuote && '\'' === cChar)) &&
        (!nPos || ' ' === pText()[nPos - 1])) {
        // note: special case symbol fonts !!!
        if (!aFInfo.IsBullet(nPos)) {
          let bSetHardBlank = false;

          let sReplace = pATst.GetQuoteAt(aACorrDoc, nPos, cChar, true);

          this.setPam(nPos, nPos + 1, cur);
          if (2 === sReplace.length && ' ' === sReplace[1]) {
            sReplace = sReplace.slice(0, 1);
            bSetHardBlank = true;
          }
          this.m_pDoc.ReplaceRange(this.m_aDelPam, sReplace);

          nPos += sReplace.length - 1;
          this.m_aDelPam.DeleteMark();
          if (bSetHardBlank) {
            setPt(nPos + 1);
            this.m_pDoc.InsertString(this.m_aDelPam, CHAR_HARDBLANK);
            ++nPos;
          }
        }
      }

      let bCallACorr = false;
      let bBreak = 0;
      if (nPos && SwAutoFormat.IsSpace(pText()[nPos - 1]))
        nLastBlank = nPos;
      for (nSttPos = nPos; !bBreak && nPos < pText().length; ++nPos) {
        cChar = pText()[nPos]!;
        switch (cChar) {
          case '"':
          case '\'':
            if ((cChar === '"' && bReplaceQuote) || (cChar === '\'' && bReplaceSglQuote)) {
              // consider Symbolfonts!
              if (!aFInfo.IsBullet(nPos)) {
                let bSetHardBlank = false;
                let sReplace = pATst.GetQuoteAt(aACorrDoc, nPos, cChar, false);

                if (2 === sReplace.length && ' ' === sReplace[0]) {
                  sReplace = sReplace.slice(1);
                  bSetHardBlank = true;
                }

                this.setPam(nPos, nPos + 1, cur);
                this.m_pDoc.ReplaceRange(this.m_aDelPam, sReplace);

                nPos += sReplace.length - 1;
                this.m_aDelPam.DeleteMark();

                if (bSetHardBlank) {
                  setPt(nPos);
                  this.m_pDoc.InsertString(this.m_aDelPam, CHAR_HARDBLANK);
                  ++nPos;
                  setPt(nPos);
                }
              }
            }
            break;
          case '*':
          case '_':
            if (f.bChgWeightUnderl) {
              // consider Symbolfonts!
              if (!aFInfo.IsBullet(nPos)) {
                const cBlank = nSttPos ? pText()[nSttPos - 1] : '';
                setPt(nPos);

                if (pATst.FnChgWeightUnderl(aACorrDoc, pText(), nPos)) {
                  // Was a character deleted before starting?
                  if (cBlank && cBlank !== pText()[nSttPos - 1])
                    --nSttPos;
                }
              }
            }
            break;
          case '/':
          case '-': {
            if (cChar === '/' && f.bAddNonBrkSpace) {
              const eLang = lang(nSttPos);
              const nUpdatedPos = pATst.FnAddNonBrkSpace(aACorrDoc, pText(), nPos, eLang, bNbspRunNext);
              if (nUpdatedPos >= 0) {
                nPos = nUpdatedPos;
                break;
              }
            }
            if (f.bChgWeightUnderl) {
              // consider Symbolfonts!
              if (!aFInfo.IsBullet(nPos)) {
                const cBlank = nSttPos ? pText()[nSttPos - 1] : '';
                setPt(nPos);

                if (pATst.FnChgWeightUnderl(aACorrDoc, pText(), nPos)) {
                  // Was a character deleted before starting?
                  if (cBlank && cBlank !== pText()[nSttPos - 1])
                    --nSttPos;
                }
              }
            }
            break;
          }
          default:
            // case '.', '!' and '?' fall through to here
            if (('.' === cChar || '!' === cChar || '?' === cChar) && f.bCapitalStartSentence)
              bFirstSent = true;
            if (!(/[\p{L}\p{N}\p{M}]/u.test(pText()[nPos]!)
              || '/' === cChar)) { //  '/' should not be a word separator (e.g. '1/2' needs to be handled as one word for replacement)
              --nPos;     // revert ++nPos which was decremented in for loop
              ++bBreak;
            }
            break;
        }
      }

      if (nPos === nSttPos) {
        if (++nPos === pText().length)
          bCallACorr = true;
      } else
        bCallACorr = true;

      if (bCallACorr) {
        setPt(nPos);

        const eLang = lang(nSttPos);

        if (f.bAutoCorrect) {
          const rStt = { value: nSttPos };
          if (aACorrDoc.ChgAutoCorrWord(rStt, nPos, pATst, null)) {
            nSttPos = rStt.value;
            nPos = this.m_aDelPam.GetPoint().GetContentIndex();
            continue;       // do not check further
          }
        }

        if (f.bAddNonBrkSpace && nPos < pText().length) {
          const nUpdatedPos = pATst.FnAddNonBrkSpace(aACorrDoc, pText(), nPos, eLang, bNbspRunNext);
          if (nUpdatedPos >= 0)
            nPos = nUpdatedPos;
        }

        if ((f.bChgOrdinalNumber &&
          pATst.FnChgOrdinalNumber(aACorrDoc, pText(), nSttPos, nPos, eLang)) ||
          (f.bChgToEnEmDash &&
            pATst.FnChgToEnEmDash(aACorrDoc, pText(), nSttPos, nPos, eLang)) ||
          (f.bSetINetAttr &&
            (nPos === pText().length || SwAutoFormat.IsSpace(pText()[nPos])) &&
            pATst.FnSetINetAttr(aACorrDoc, pText(), nLastBlank, nPos, eLang)) ||
          (f.bSetDOIAttr &&
            (nPos === pText().length || SwAutoFormat.IsSpace(pText()[nPos])) &&
            pATst.FnSetDOIAttr(aACorrDoc, pText(), nLastBlank, nPos, eLang))) {
          nPos = Math.min(nPos, pText().length);
        } else {
          // two capital letters at the beginning of a word?
          if (f.bCapitalStartWord) {
            pATst.FnCapitalStartWord(aACorrDoc, pText(), nSttPos, nPos, eLang);
          }
          // capital letter at the beginning of a sentence?
          if (f.bCapitalStartSentence && bFirst) {
            pATst.FnCapitalStartSentence(aACorrDoc, pText(), true, nSttPos, nPos, eLang);
          }

          bFirst = bFirstSent;
          bFirstSent = false;
        }
      }
    }
    while (nPos < pText().length);
    aACorrDoc.Dispose();
  }

  constructor(pEdShell: SwWrtShell, aFlags: SvxSwAutoFormatFlags, pSttNd?: SwTextNode, pEndNd?: SwTextNode) {
    this.m_aFlags = aFlags.Clone();
    this.m_pEditShell = pEdShell;
    this.m_pDoc = pEdShell.m_pDoc;
    const nodes = this.m_pDoc.GetNodes();
    this.m_aNdIdx = nodes.BodyStart() - 1;
    this.m_aEndNdIdx = nodes.GetEndOfContent().GetIndex();
    this.m_aDelPam = new SwPaM(new SwPosition(nodes.FirstTextNode(), 0));
    this.m_pACorr = SvxAutoCorrCfg.Get().GetAutoCorrect();
    try { this.run(pSttNd, pEndNd); } finally { this.m_aDelPam.Release(); }
  }

  private run(pSttNd?: SwTextNode, pEndNd?: SwTextNode): void {
    if (this.m_aFlags.bSetNumRule && !this.m_aFlags.bAFormatByInput)
      this.m_aFlags.bSetNumRule = false;

    const pACorr = this.m_pACorr;
    const bReplaceStyles = this.m_aFlags.bAFormatByInput ? this.m_aFlags.bReplaceStylesByInput : this.m_aFlags.bReplaceStyles;

    let pNextFrame: SwTextNode | null = null;
    let bNxtEmpty = false;
    let bNxtAlpha = false;
    let nNxtLevel = 0;
    let bEmptyLine: boolean;

    // set area for autoformatting
    if (pSttNd) {
      this.m_aNdIdx = pSttNd.GetIndex();
      // for GoNextPara, one paragraph prior to that
      this.m_aNdIdx = SwAutoFormat.prev(this.m_aNdIdx);
      this.m_aEndNdIdx = SwAutoFormat.next(pEndNd!.GetIndex());

      // check the previous TextNode
      const prev = this.nodes().node(this.m_aNdIdx);
      const pPrevFrame = prev.IsTextNode() ? prev : null;
      bEmptyLine = !pPrevFrame
        || SwAutoFormat.IsEmptyLine(pPrevFrame)
        || this.IsNoAlphaLine(pPrevFrame);
    } else
      bEmptyLine = true;      // at document beginning

    this.m_bEnd = false;

    const rdl = this.m_pDoc.m_pDocumentRedlineManager;
    const bOldRedline = rdl.m_bRecord;
    rdl.m_bRecord = this.m_aFlags.bWithRedlining;

    // If multiple lines, then do not merge with next paragraph
    this.m_bMoreLines = false;

    let nLastCalcHeadLvl = 0;
    let nLastHeadLvl = USHRT_MAX;
    let nLevel = 0;
    const nDigitLvl = { value: 0 };

    // set defaults
    const aFInfo = this.Info(null);

    const READ_NEXT_PARA = 0, TST_EMPTY_LINE = 1, TST_ALPHA_LINE = 2, GET_ALL_INFO = 3, IS_ONE_LINE = 4, TST_ENUMERIC = 5,
      TST_IDENT = 6, TST_NEG_IDENT = 7, TST_TXT_BODY = 8, HAS_FMTCOLL = 9, IS_END = 10;

    // This is the automat for autoformatting
    let eStat = READ_NEXT_PARA;
    try {
      while (!this.m_bEnd) {
        switch (eStat) {
          case READ_NEXT_PARA: {
            this.GoNextPara();
            eStat = this.m_bEnd ? IS_END : TST_EMPTY_LINE;
            break;
          }

          case TST_EMPTY_LINE:
            if (SwAutoFormat.IsEmptyLine(this.m_pCurTextFrame!)) {
              if (this.m_aFlags.bDelEmptyNode && !SwAutoFormat.HasObjects(this.m_pCurTextFrame!)) {
                bEmptyLine = true;
                const nOldCnt = this.nodes().Count();
                this.DelEmptyLine();
                // Was there really a deletion of a node?
                if (nOldCnt !== this.nodes().Count()) {
                  // do not skip the next paragraph
                  this.m_aNdIdx = SwAutoFormat.prev(this.m_aNdIdx);
                  this.m_aEndNdIdx--;
                }
              }
              eStat = READ_NEXT_PARA;
            } else
              eStat = TST_ALPHA_LINE;
            break;

          case TST_ALPHA_LINE:
            if (this.IsNoAlphaLine(this.m_pCurTextFrame!)) {
              // recognize a table definition +---+---+
              if (this.m_aFlags.bAFormatByInput && this.m_aFlags.bCreateTable && this.DoTable()) {
                eStat = IS_END;
                break;
              }

              const rStr = this.m_pCurTextFrame!.GetText();
              const rFlags = pACorr.GetSwFlags();
              if (rFlags.bChgEnumNum && (rStr === '- ' || rStr === '* ')) {
                eStat = TST_ENUMERIC;
                break;
              }

              // Check for 3 "---" or "===". In this case, the previous paragraph should be
              // underlined and the current be deleted!
              const nOldCnt = this.nodes().Count();
              if (!this.DoUnderline() && bReplaceStyles) {
                this.SetColl(RES_POOLCOLL_STANDARD, true);
                bEmptyLine = true;
              }
              this.m_aEndNdIdx -= nOldCnt - this.nodes().Count();
              eStat = READ_NEXT_PARA;
            } else
              eStat = GET_ALL_INFO;
            break;

          case GET_ALL_INFO: {
            const cur = this.m_pCurTextFrame!;
            if (cur.GetAttr('RES_PARATR_NUMRULE')) {
              // do nothing in numbering, go to next
              bEmptyLine = false;
              eStat = READ_NEXT_PARA;
              // delete all blanks at beginning/end and in between
              //JP 29.04.98: first only "all in between"
              this.DelMoreLinesBlanks();
              // auto correct paragraphs that fail to enter state HAS_FMTCOLL
              this.AutoCorrect();
              break;
            }

            aFInfo.SetFrame(cur);

            // so far: if there were templates assigned, keep these and go to next node
            const nPoolId = cur.GetTextColl().GetName();
            if (IsPoolUserFormat(nPoolId)
              ? !this.m_aFlags.bChgUserColl
              : (RES_POOLCOLL_STANDARD !== nPoolId &&
                (!this.m_aFlags.bAFormatByInput ||
                  (RES_POOLCOLL_TEXT_MOVE !== nPoolId &&
                    RES_POOLCOLL_TEXT !== nPoolId)))) {
              eStat = HAS_FMTCOLL;
              break;
            }

            // replace custom styles with text body
            if (IsPoolUserFormat(nPoolId) && this.m_aFlags.bChgUserColl) {
              this.SetColl(RES_POOLCOLL_TEXT, true);
            }

            // check for left margin set by the style
            if (IsPoolUserFormat(nPoolId) ||
              RES_POOLCOLL_STANDARD === nPoolId) {
              const lr = cur.GetAttr('RES_LR_SPACE');
              // Unit conversion is not needed here: check the sign only
              const dIndentValue = lr?.firstLine ?? 0;

              if (0 !== dIndentValue || (lr && 0 !== lr.left)) {
                // exception: numbering/enumeration can have an indentation
                if (this.IsEnumericChar(cur)) {
                  nLevel = this.CalcLevel(cur, nDigitLvl);
                  if (nLevel >= MAXLEVEL)
                    nLevel = MAXLEVEL - 1;
                  this.BuildEnum(nLevel, nDigitLvl.value);
                  eStat = READ_NEXT_PARA;
                  break;
                }

                // never merge (maybe only indent as exception)
                this.m_bMoreLines = true;

                if (bReplaceStyles) {
                  // then use one of our templates
                  if (0 < dIndentValue) // positive 1st line indentation
                    this.BuildIndent();
                  else if (0 > dIndentValue) // negative 1st line indentation
                    this.BuildNegIndent(aFInfo.GetLineStart());
                  else if (lr && lr.left !== 0) // is indentation
                    this.BuildTextIndent();
                }
                eStat = READ_NEXT_PARA;
                break;
              }
            }

            nLevel = this.CalcLevel(cur, nDigitLvl);
            this.m_bMoreLines = !this.IsOneLine(cur);
            // note: every use of pNextFrame in following states, until the
            // next READ_NEXT_PARA, relies on this update
            pNextFrame = this.GetNextNode();
            if (pNextFrame) {
              bNxtEmpty = SwAutoFormat.IsEmptyLine(pNextFrame);
              bNxtAlpha = this.IsNoAlphaLine(pNextFrame);
              nNxtLevel = this.CalcLevel(pNextFrame);

              if (!bEmptyLine && SwAutoFormat.HasBreakAttr(cur))
                bEmptyLine = true;
              if (!bNxtEmpty && SwAutoFormat.HasBreakAttr(pNextFrame))
                bNxtEmpty = true;
            } else {
              bNxtEmpty = false;
              bNxtAlpha = false;
              nNxtLevel = 0;
            }
            eStat = !this.m_bMoreLines ? IS_ONE_LINE : TST_ENUMERIC;
            break;
          }

          case IS_ONE_LINE: {
            eStat = TST_ENUMERIC;
            if (!bReplaceStyles)
              break;

            const sClrStr = SwAutoFormat.DelLeadingBlanks(this.m_pCurTextFrame!.GetText());

            if (!sClrStr) {
              bEmptyLine = true;
              eStat = READ_NEXT_PARA;
              break;      // read next paragraph
            }

            // check if headline
            if (!bEmptyLine || !this.IsFirstCharCapital(this.m_pCurTextFrame!)
              || SwAutoFormat.IsBlanksInString(this.m_pCurTextFrame!))
              break;

            bEmptyLine = false;
            const sEndClrStr = SwAutoFormat.DelTrailingBlanks(sClrStr);
            const cLast = sEndClrStr[sEndClrStr.length - 1]!;

            // not, then check if headline
            if (':' === cLast) {
              this.BuildHeadLine(2);
              eStat = READ_NEXT_PARA;
              break;
            } else if (cLast.charCodeAt(0) >= 256 || !',.;'.includes(cLast)) {
              if (bNxtEmpty || bNxtAlpha
                || (pNextFrame && this.IsEnumericChar(pNextFrame))) {
                // one level below?
                if (nLevel >= MAXLEVEL)
                  nLevel = MAXLEVEL - 1;

                if (USHRT_MAX === nLastHeadLvl)
                  nLastHeadLvl = 0;
                else if (nLastCalcHeadLvl < nLevel) {
                  if (nLastHeadLvl + 1 < MAXLEVEL)
                    ++nLastHeadLvl;
                }
                // one level above?
                else if (nLastCalcHeadLvl > nLevel) {
                  if (nLastHeadLvl)
                    --nLastHeadLvl;
                }
                nLastCalcHeadLvl = nLevel;

                if (this.m_aFlags.bAFormatByInput)
                  this.BuildHeadLine(nLevel);
                else
                  this.BuildHeadLine(nLastHeadLvl);
                eStat = READ_NEXT_PARA;
                break;
              }
            }
            break;
          }

          case TST_ENUMERIC: {
            bEmptyLine = false;
            if (this.IsEnumericChar(this.m_pCurTextFrame!)) {
              if (nLevel >= MAXLEVEL)
                nLevel = MAXLEVEL - 1;
              this.BuildEnum(nLevel, nDigitLvl.value);
              eStat = READ_NEXT_PARA;
            } else if (bReplaceStyles)
              eStat = nLevel ? TST_IDENT : TST_NEG_IDENT;
            else {
              eStat = READ_NEXT_PARA;
              this.BuildText();
            }
            break;
          }

          case TST_IDENT:
            // Spaces at the beginning, check again for indentation
            if (this.m_bMoreLines && nLevel) {
              const nSz = aFInfo.GetFirstIndent();
              if (0 < nSz)           // positive 1st line indentation
                this.BuildIndent();
              else if (0 > nSz)      // negative 1st line indentation
                this.BuildNegIndent(aFInfo.GetLineStart());
              else                    // is indentation
                this.BuildTextIndent();
              eStat = READ_NEXT_PARA;
            } else if (nLevel && pNextFrame &&
              !bNxtEmpty && !bNxtAlpha && !nNxtLevel &&
              !this.IsEnumericChar(pNextFrame)) {
              // is an indentation
              this.BuildIndent();
              eStat = READ_NEXT_PARA;
            } else
              eStat = TST_TXT_BODY;
            break;

          case TST_NEG_IDENT:
            // no spaces at the beginning, check again for negative indentation
            if (this.m_bMoreLines && !nLevel) {
              const nSz = aFInfo.GetFirstIndent();
              if (0 < nSz)           // positive 1st line indentation
                this.BuildIndent();
              else if (0 > nSz)      // negative 1st line indentation
                this.BuildNegIndent(aFInfo.GetLineStart());
              else                    // is _no_ indentation
                this.BuildText();
              eStat = READ_NEXT_PARA;
            } else if (!nLevel && pNextFrame &&
              !bNxtEmpty && !bNxtAlpha && nNxtLevel &&
              !this.IsEnumericChar(pNextFrame)) {
              // is a negative indentation
              this.BuildNegIndent(aFInfo.GetLineStart());
              eStat = READ_NEXT_PARA;
            } else
              eStat = TST_TXT_BODY;
            break;

          case TST_TXT_BODY: {
            if (this.m_bMoreLines) {
              const nSz = aFInfo.GetFirstIndent();
              if (0 < nSz)           // positive 1st line indentation
                this.BuildIndent();
              else if (0 > nSz)      // negative 1st line indentation
                this.BuildNegIndent(aFInfo.GetLineStart());
              else if (nLevel)       // is indentation
                this.BuildTextIndent();
              else
                this.BuildText();
            } else if (nLevel)
              this.BuildTextIndent();
            else
              this.BuildText();
            eStat = READ_NEXT_PARA;
            break;
          }

          case HAS_FMTCOLL: {
            // so far: if there were templates assigned, keep these and go to next node
            bEmptyLine = false;
            eStat = READ_NEXT_PARA;
            // delete all blanks at beginning/end and in between
            //JP 29.04.98: first only "all in between"
            this.DelMoreLinesBlanks();

            // handle hard attributes
            const lr = this.m_pCurTextFrame!.m_aSet.RES_LR_SPACE;
            if (lr) {
              // Unit conversion is not needed here: check the sign only
              const dIndentValue = lr.firstLine;

              if (bReplaceStyles
                && (0 !== dIndentValue || 0 !== lr.left)) {
                // then use one of our templates
                if (0 < dIndentValue) // positive 1st line indentation
                  this.BuildIndent();
                else if (0 > dIndentValue) // negative 1st line indentation
                  this.BuildNegIndent(aFInfo.GetLineStart());
                else if (0 !== lr.left) // is indentation
                  this.BuildTextIndent();
                else
                  this.BuildText();
              }
            }
            // force auto correct
            this.AutoCorrect();
            break;
          }

          case IS_END:
            this.m_bEnd = true;
            break;
        }
      }
    } finally {
      rdl.m_bRecord = bOldRedline;
    }
  }
}
type Ref_s = { value: string };

/**
 * SwEditShell::AutoFormat: Tools > AutoCorrect > Apply, on the selection or on the whole document;
 * or on the paragraph at the cursor (bCurrentParagraphOnly).
 */
export function SwEditShell_AutoFormat(sh: SwWrtShell, pAFlags: SvxSwAutoFormatFlags | null, bCurrentParagraphOnly = false): void {
  const nUndo = sh.StartUndo();

  const aAFFlags = pAFlags ? pAFlags.Clone() : SwEditShell_GetAutoFormatFlags().Clone();     // use default values or add params?

  const pCursor = sh.m_pCursor;
  // There are more than one or a selection is open
  if (pCursor.HasMark()) {
    new SwAutoFormat(sh, aAFFlags, pCursor.Start().GetNode(), pCursor.End().GetNode());
  } else if (bCurrentParagraphOnly) {
    const n = pCursor.GetPoint().GetNode();
    new SwAutoFormat(sh, aAFFlags, n, n);
  } else {
    new SwAutoFormat(sh, aAFFlags);
  }

  sh.EndUndo(nUndo);
}

/** SwEditShell::AutoFormatBySplitNode: formats the paragraph Enter just ended. */
export function SwEditShell_AutoFormatBySplitNode(sh: SwWrtShell): void {
  const pCursor = sh.m_pCursor;
  const pt = pCursor.GetPoint();
  const nodes = sh.m_pDoc.GetNodes();
  // pCursor->Move( fnMoveBackward, GoInNode ): the end of the previous paragraph.
  const pPrev = nodes.node(pt.GetNodeIndex() - 1);
  if (pCursor.HasMark() || !pPrev.IsTextNode())
    return;

  const nUndo = sh.StartUndo();

  let bRange = false;
  let pMark: SwTextNode = pPrev;
  if (pPrev.GetText().length) {
    bRange = true;
  } else {
    // then go one node backwards
    const pTextNd = nodes.node(pPrev.GetIndex() - 1);
    if (pTextNd.IsTextNode() && pTextNd.GetText()) {
      pMark = pTextNd;
      bRange = true;
    }
  }

  if (bRange) {
    // save cursor (Push): where it is, at the start of the new paragraph
    const aSaved = new SwPosition(pt.GetNode(), pt.GetContentIndex());

    const aAFFlags = SwEditShell_GetAutoFormatFlags().Clone(); // use default values so far

    new SwAutoFormat(sh, aAFFlags, pMark, pPrev);
    let pACorr: SvxAutoCorrect | null = SvxAutoCorrCfg.Get().GetAutoCorrect();
    if (pACorr && !pACorr.IsAutoCorrFlag(ACFlags.CapitalStartSentence | ACFlags.CapitalStartWord |
      ACFlags.AddNonBrkSpace | ACFlags.ChgOrdinalNumber | ACFlags.TransliterateRTL |
      ACFlags.ChgToEnEmDash | ACFlags.SetINetAttr | ACFlags.Autocorrect |
      ACFlags.SetDOIAttr))
      pACorr = null;

    if (pACorr) {
      // the end of the paragraph before the cursor
      const pEnd = nodes.node(aSaved.GetNodeIndex() - 1);
      if (pEnd.IsTextNode()) {
        pt.Assign(pEnd, pEnd.Len());
        pCursor.DeleteMark();
        SwEditShell_AutoCorrect(sh, pACorr, false, '');
      }
    }

    //JP 30.09.96: DoTable() builds on PopCursor and MoveCursor!
    pt.Assign(aSaved.GetNode(), aSaved.GetContentIndex());
    aSaved.Release();
  }
  pCursor.DeleteMark();

  sh.EndUndo(nUndo);
}

let s_pAutoFormatFlags: SvxSwAutoFormatFlags | null = null;

/** SwEditShell::GetAutoFormatFlags: the flags of formatting while typing. */
export function SwEditShell_GetAutoFormatFlags(): SvxSwAutoFormatFlags {
  if (!s_pAutoFormatFlags)
    s_pAutoFormatFlags = new SvxSwAutoFormatFlags();

  return s_pAutoFormatFlags;
}

/** SwEditShell::SetAutoFormatFlags */
export function SwEditShell_SetAutoFormatFlags(pFlags: SvxSwAutoFormatFlags): void {
  const pEditFlags = SwEditShell_GetAutoFormatFlags();

  pEditFlags.bSetNumRule = pFlags.bSetNumRule;
  pEditFlags.bChgEnumNum = pFlags.bChgEnumNum;
  pEditFlags.bSetBorder = pFlags.bSetBorder;
  pEditFlags.bCreateTable = pFlags.bCreateTable;
  pEditFlags.bReplaceStyles = pFlags.bReplaceStyles;
  pEditFlags.bReplaceStylesByInput = pFlags.bReplaceStylesByInput;
  pEditFlags.bAFormatByInpDelSpacesAtSttEnd =
    pFlags.bAFormatByInpDelSpacesAtSttEnd;
  pEditFlags.bAFormatByInpDelSpacesBetweenLines =
    pFlags.bAFormatByInpDelSpacesBetweenLines;

  //JP 15.12.98: copy BulletChar and Font into "normal" ones
  //             because AutoFormat can only work with the latter!
  pEditFlags.cBullet = pFlags.cByInputBullet;
  pEditFlags.aBulletFont = pFlags.aByInputBulletFont;
  pEditFlags.cByInputBullet = pFlags.cByInputBullet;
  pEditFlags.aByInputBulletFont = pFlags.aByInputBulletFont;
}
