// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/edit/acorrect.cxx reduced
// @upstream sw/source/core/inc/acorrect.hxx reduced
// @upstream sw/source/core/edit/edws.cxx partial
// SwAutoCorrDoc: SvxAutoCorrect's access to the paragraph being typed in. Positions are the
// paragraph's own (the frame text is the node text: hidden redlines are not merged into one
// frame). The text blocks with formatting (SwTextBlocks) and the transliteration to Old Hungarian
// (TransliterateRTLWord, which needs the NatNum12 number format and a hyphenator) are not ported.
// SwAutoCorrExceptWord remembers a correction until the next undo, which then adds the word to
// the exception list (the dialog's AutoInclude), as SwUndoReplace and SwUndoOverwrite do.
import { ACFlags, SvxAutoCorrect, type LanguageType, type Ref, type SvxAutoCorrAttr, type SvxAutoCorrDoc } from '../../../../editeng/source/misc/svxacorr.ts';
import { SwPaM } from '../../../inc/pam.ts';
import { SwPosition } from '../../../inc/doc.ts';
import { CH_TXTATR_BREAKWORD, type SwCharAttrSet } from '../../../inc/hintids.ts';
import { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';

const CH_TXTATR_INWORD = '￹';

/** The superscript of ordinal suffixes (SvxEscapementItem with DFLT_ESC_AUTO_SUPER: the app has no automatic escapement). */
const DFLT_ESC_SUPER = 33;

export class SwAutoCorrDoc implements SvxAutoCorrDoc {
  m_rEditSh: SwWrtShell;
  m_rCursor: SwPaM;
  /** The previous paragraph GetPrevPara went to (m_oIndex). */
  m_oIndex: number | null = null;
  m_bUndoIdInitialized: boolean;
  /** The undo depth when StartUndo(SwUndoId::AUTOCORRECT) was called, or -1. */
  m_nUndoStart = -1;

  constructor(rEditShell: SwWrtShell, rPam: SwPaM, cIns = '') {
    this.m_rEditSh = rEditShell;
    this.m_rCursor = rPam;
    this.m_bUndoIdInitialized = !cIns;
  }

  /** ~SwAutoCorrDoc: ends the undo group of the corrections. */
  Dispose(): void {
    if (this.m_nUndoStart >= 0) {
      const doc = this.m_rEditSh.m_pDoc;
      this.m_rEditSh.EndUndo(this.m_nUndoStart);
      // SwUndoId::AUTOCORRECT: typing after it starts a new step.
      if (doc.m_aUndo.length > this.m_nUndoStart) doc.m_aUndo[doc.m_aUndo.length - 1]!.kind = 'autocorrect';
      this.m_nUndoStart = -1;
    }
  }

  private doc(): SwDoc { return this.m_rEditSh.m_pDoc; }
  private node(): SwTextNode { return this.m_rCursor.GetPoint().GetNode(); }
  private pam(nStt: number, nEnd = nStt): SwPaM {
    const n = this.node();
    return new SwPaM(new SwPosition(n, Math.min(nEnd, n.Len())), new SwPosition(n, Math.min(nStt, n.Len())));
  }
  private startUndo(len: number): void {
    if (!this.m_bUndoIdInitialized) {
      this.m_bUndoIdInitialized = true;
      if (1 === len) this.m_nUndoStart = this.m_rEditSh.StartUndo();
    }
  }

  GetText(): string { return this.node().GetText(); }

  DeleteSel(rDelPam: SwPaM): void {
    // DeleteAndJoin records the deletion as a change when changes are recorded (IsAutoFormatRedline).
    this.doc().DeleteAndJoin(rDelPam);
  }

  Delete(nStt: number, nEnd: number): boolean {
    const aSel = this.pam(nStt, nEnd);
    this.DeleteSel(aSel);
    aSel.Release();
    if (!this.m_bUndoIdInitialized)
      this.m_bUndoIdInitialized = true;
    return true;
  }

  Insert(nPos: number, rText: string): boolean {
    const aPam = this.pam(nPos);
    // The typed character continues the attributes toggled before it (SwWrtShell's pending ones).
    const pending = this.m_rEditSh.m_aPending;
    this.doc().InsertString(aPam, rText, Object.keys(pending).length ? pending : undefined);
    aPam.Release();
    this.startUndo(rText.length);
    return true;
  }

  Replace(nPos: number, rText: string): boolean {
    return this.ReplaceRange(nPos, rText.length, rText);
  }

  ReplaceRange(nPos: number, nSourceLength: number, rText: string): boolean {
    const pNd = this.node();
    const sText = pNd.GetText();
    // text attributes with dummy characters must not be replaced!
    let bDoReplace = true;
    const nLen = rText.length;
    for (let n = 0; n < nLen && n + nPos < sText.length; ++n) {
      const Char = sText[n + nPos];
      if (CH_TXTATR_BREAKWORD === Char || CH_TXTATR_INWORD === Char) {
        bDoReplace = false;
        break;
      }
    }
    // tdf#83419 avoid bad autocorrect with visible redlines
    // e.g. replacing the first letter of the tracked deletion
    // with its capitalized (and not deleted) version.
    if (bDoReplace && pNd.GetCharAttrAt('RES_TXTATR_REDLINE', nPos)?.type === 'Delete')
      bDoReplace = false;

    if (bDoReplace) {
      const pPam = this.pam(nPos, Math.min(sText.length, nPos + nSourceLength));
      if (nPos === sText.length) // at the End do an Insert
        this.doc().InsertString(pPam, rText);
      else
        this.doc().ReplaceRange(pPam, rText);
      pPam.Release();
      this.startUndo(rText.length);
    }
    return true;
  }

  SetAttr(nStt: number, nEnd: number, eAttr: SvxAutoCorrAttr): void {
    const aPam = this.pam(nStt, nEnd);
    const set: SwCharAttrSet =
      eAttr === 'weight' ? { RES_CHRATR_WEIGHT: true }
      : eAttr === 'posture' ? { RES_CHRATR_POSTURE: true }
      : eAttr === 'crossedout' ? { RES_CHRATR_CROSSEDOUT: true }
      : eAttr === 'underline' ? { RES_CHRATR_UNDERLINE: 'single' }
      : { RES_CHRATR_ESCAPEMENT: DFLT_ESC_SUPER };
    // SwDoc::SetFormatItemByAutoFormat: DONTEXPAND, and the attributes at the end continue
    // there (fdo#62536: "insert the old attributes as an empty hint to stop expand"), which here
    // is what the shell's pending attributes do for the text typed at the cursor.
    const pNd = this.node();
    const nAt = Math.max(0, nEnd < pNd.Len() ? nEnd : nEnd - 1);
    const old: Record<string, unknown> = {};
    for (const k of Object.keys(set) as (keyof SwCharAttrSet)[]) old[k] = pNd.GetCharAttrAt(k, nAt);
    this.doc().InsertAttr(aPam, set);
    aPam.Release();
    const pt = this.m_rEditSh.m_pCursor.GetPoint();
    if (pt.GetNode() === pNd && pt.GetContentIndex() === nEnd)
      this.m_rEditSh.m_aPending = { ...this.m_rEditSh.m_aPending, ...(old as SwCharAttrSet) };
    if (!this.m_bUndoIdInitialized)
      this.m_bUndoIdInitialized = true;
  }

  SetINetAttr(nStt: number, nEnd: number, rURL: string): boolean {
    const aPam = this.pam(nStt, nEnd);
    this.doc().InsertAttr(aPam, { RES_TXTATR_INETFMT: rURL });
    aPam.Release();
    if (!this.m_bUndoIdInitialized)
      this.m_bUndoIdInitialized = true;
    return true;
  }

  /**
   * Return the text of a previous paragraph
   *
   * @param bAtNormalPos If <true> before the normal insert position; if <false> in which the
   *                     corrected word was inserted. (Doesn't need to be the same paragraph!)
   * @return text or 0, if previous paragraph does not exists or there are only blankness
   */
  GetPrevPara(bAtNormalPos: boolean): string | null {
    let pStr: string | null = null;
    const nodes = this.doc().GetNodes();
    if (bAtNormalPos || this.m_oIndex === null) {
      this.m_oIndex = this.m_rCursor.GetPoint().GetNodeIndex();
    }
    // sw::GotoPrevLayoutTextFrame: the previous node; a section or table boundary ends the search.
    let pTextNd: SwTextNode | null = null;
    for (let i = this.m_oIndex - 1; i > 0; --i) {
      this.m_oIndex = i;
      const n = nodes.node(i);
      if (!n.IsTextNode()) break;
      if (n.GetText()) { pTextNd = n; break; }
    }
    if (pTextNd && 0 === SwDoc.OutlineLevel(pTextNd)) {
      pStr = pTextNd.GetText();
    }
    if (!this.m_bUndoIdInitialized)
      this.m_bUndoIdInitialized = true;
    return pStr;
  }

  ChgAutoCorrWord(rSttPos: Ref<number>, nEndPos: number, rACorrect: SvxAutoCorrect, pPara: Ref<string> | null): boolean {
    if (!this.m_bUndoIdInitialized)
      this.m_bUndoIdInitialized = true;

    // Found a beginning of a paragraph or a Blank,
    // search for the word Kuerzel (Shortcut) in the Auto
    let pTextNd: SwTextNode | null = this.node();

    let bRet = false;
    if (nEndPos === rSttPos.value)
      return bRet;

    const eLang = this.GetLanguage(nEndPos);
    const aLanguageTag = { value: eLang };

    let sFrameText = pTextNd.GetText();
    const sttPos = { value: rSttPos.value };
    const pStatus = rACorrect.SearchWordsInList(sFrameText, sttPos, nEndPos, this, aLanguageTag);
    const pDoc = this.doc();
    if (pStatus) {
      let minSttPos = sttPos.value;
      do {
        const pFnd = pStatus.mFnd;
        // replace also last colon of keywords surrounded by colons
        // (for example, ":name:")
        const replaceLastChar = sFrameText.length > nEndPos
          && pFnd.GetShort()[0] === ':'
          && pFnd.GetShort().endsWith(':');

        const aPam = this.pam(sttPos.value, nEndPos + (replaceLastChar ? 1 : 0));
        // don't replace, if a redline starts or ends within the original text
        let bRedline = false;
        for (let i = sttPos.value; i < aPam.End().GetContentIndex(); i++) if (pTextNd.GetCharAttrAt('RES_TXTATR_REDLINE', i)) bRedline = true;
        if (bRedline) {
          aPam.Release();
          return bRet;
        }

        if (pFnd.IsTextOnly()) {
          //JP 22.04.99: Bug 63883 - Special treatment for dots.
          const bLastCharIsPoint = nEndPos < sFrameText.length && ('.' === sFrameText[nEndPos]);
          if (!bLastCharIsPoint || !pFnd.GetLong() ||
            '.' !== pFnd.GetLong()[pFnd.GetLong().length - 1]) {
            // replace the selection
            pDoc.ReplaceRange(aPam, pFnd.GetLong());
            nEndPos = sttPos.value + pFnd.GetLong().length;
            bRet = true;
            pTextNd = this.node();
          }
        }
        aPam.Release();

        if (sttPos.value < minSttPos) {
          minSttPos = sttPos.value;
        }
        sttPos.value = rSttPos.value;
        sFrameText = this.node().GetText();
      } while (SvxAutoCorrect.SearchWordsNext(sFrameText, sttPos, nEndPos, pStatus));
      rSttPos.value = minSttPos;
    }

    if (bRet && pPara && pTextNd) {
      pPara.value = pTextNd.GetText();
    }

    return bRet;
  }

  TransliterateRTLWord(_rSttPos: Ref<number>, _nEndPos: number, _bApply = false): boolean {
    if (!this.m_bUndoIdInitialized)
      this.m_bUndoIdInitialized = true;
    return false;
  }

  // Called by the functions:
  //  - FnCapitalStartWord
  //  - FnCapitalStartSentence
  // after the exchange of characters. Then the words, if necessary, can be inserted
  // into the exception list.
  SaveCpltSttWord(nFlag: ACFlags, nPos: number, rExceptWord: string, cChar: string): void {
    const nNode = this.m_oIndex ?? this.m_rCursor.GetPoint().GetNodeIndex();
    const eLang = this.GetLanguage(nPos);
    this.m_rEditSh.SetAutoCorrExceptWord(new SwAutoCorrExceptWord(nFlag, nNode, nPos, rExceptWord, cChar, eLang));
  }

  GetLanguage(nPos: number): LanguageType {
    const pNd = this.node();
    const l = pNd.GetCharAttrAt('RES_CHRATR_LANGUAGE', Math.max(0, Math.min(nPos, pNd.Len() - 1)));
    return l === 'zxx' ? 'zxx' : l;
  }
}

/**
 * SwAutoCorrExceptWord: a correction that an immediate undo turns into an exception (the
 * Exceptions page's AutoInclude).
 */
export class SwAutoCorrExceptWord {
  m_sWord: string;
  m_nFlags: ACFlags;
  m_nNode: number;
  m_nContent: number;
  m_cChar: string;
  m_eLanguage: LanguageType;
  m_bDeleted = false;
  /** The undo depth right after the correction: the undo that takes it back starts there. */
  m_nUndoDepth = -1;

  constructor(nAFlags: ACFlags, nNd: number, nContent: number, rWord: string, cChar: string, eLang: LanguageType) {
    this.m_sWord = rWord; this.m_nFlags = nAFlags; this.m_nNode = nNd; this.m_nContent = nContent; this.m_cChar = cChar; this.m_eLanguage = eLang;
  }

  /** SwAutoCorrExceptWord::CheckChar: after the undo, the original character is back. */
  CheckChar(rPos: SwPosition, cChr: string, rACorr: SvxAutoCorrect): boolean {
    // test only if this is an improvement.
    // If yes, then add the word to the list.
    if (this.m_cChar === cChr && rPos.GetNodeIndex() === this.m_nNode && rPos.GetContentIndex() === this.m_nContent) {
      // get the current autocorrection:
      // then add to the list:
      if (ACFlags.CapitalStartWord & this.m_nFlags)
        rACorr.AddWordStartException(this.m_sWord, this.m_eLanguage);
      else if (ACFlags.CapitalStartSentence & this.m_nFlags)
        rACorr.AddCplSttException(this.m_sWord, this.m_eLanguage);
    }
    return true;
  }
}

/**
 * SwEditShell::AutoCorrect: inserts cChar (if any) at the cursor and corrects what it ends. With
 * bCapsLock, the Caps Lock key is on (the window's indicator state).
 */
export function SwEditShell_AutoCorrect(sh: SwWrtShell, rACorr: SvxAutoCorrect, bInsert: boolean, cChar: string, bCapsLock = false): void {
  const pCursor = sh.m_pCursor;

  const aSwAutoCorrDoc = new SwAutoCorrDoc(sh, pCursor, cChar);
  const nPos = pCursor.GetPoint().GetContentIndex();
  rACorr.DoAutoCorrect(aSwAutoCorrDoc,
    pCursor.GetPoint().GetNode().GetText(), nPos,
    cChar, bInsert, sh.m_bNbspRunNext, bCapsLock);
  aSwAutoCorrDoc.Dispose();
  // A correction that the next undo takes back.
  const w = sh.m_pACEWord;
  if (w && w.m_nUndoDepth < 0) w.m_nUndoDepth = sh.m_pDoc.m_aUndo.length;
  if (cChar)
    sh.SaveTableBoxContent();
}

/** SwEditShell::GetPrevAutoCorrWord */
export function SwEditShell_GetPrevAutoCorrWord(sh: SwWrtShell, rACorr: SvxAutoCorrect): string {
  const pCursor = sh.m_pCursor;
  const aSwAutoCorrDoc = new SwAutoCorrDoc(sh, pCursor, '');
  return rACorr.GetPrevAutoCorrWord(aSwAutoCorrDoc, pCursor.GetPoint().GetNode().GetText(), pCursor.GetPoint().GetContentIndex());
}
