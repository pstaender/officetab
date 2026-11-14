// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/index/toxmgr.cxx partial
// @upstream sw/source/uibase/inc/toxmgr.hxx partial
// SwTOXMgr's index marks: inserting, updating, deleting and travelling between the marks at the
// cursor. Marks are immutable (tox.ts): UpdateTOXMark replaces the current mark by a changed copy
// where upstream changes it in place. The bibliography marks (TOX_BIBLIOGRAPHY) are not ported.
import type { SwWrtShell } from '../wrtsh/wrtsh.ts';
import { SwTOXMark, type SwTOXType } from '../../../inc/tox.ts';
import { SwTOXSearch, TOXTypes } from '../../../inc/toxe.ts';
import { DeleteTOXMark, FindTextTOXMark, GetTOXType, GetUserTOXType, GotoTOXMark, InsertTOXMark, ReplaceTOXMark } from '../../core/doc/doctxm.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';

/** SwTOXMarkDescription: what the Index Entry dialog asks for. */
export interface SwTOXMarkDescription {
  meTOXType: TOXTypes;
  mnLevel: number;
  mbMainEntry: boolean;
  maPrimKey?: string;
  maSecKey?: string;
  maAltStr?: string;
  maTOUName?: string;
  maPhoneticReadingOfAltStr?: string;
  maPhoneticReadingOfPrimKey?: string;
  maPhoneticReadingOfSecKey?: string;
}

export class SwTOXMgr {
  m_pSh: SwWrtShell;
  m_pCurTOXMark: SwTOXMark | null = null;
  m_aCurMarks: SwTOXMark[] = [];

  constructor(pShell: SwWrtShell) {
    this.m_pSh = pShell;
    this.m_aCurMarks = this.m_pSh.GetCurTOXMarks();
    this.SetCurTOXMark(0);
  }

  GetTOXMarkCount(): number { return this.m_aCurMarks.length; }
  GetTOXMark(nId: number): SwTOXMark | null { return this.m_aCurMarks[nId] ?? null; }
  GetCurTOXMark(): SwTOXMark | null { return this.m_pCurTOXMark; }
  SetCurTOXMark(nId: number): void { this.m_pCurTOXMark = this.m_aCurMarks[nId] ?? null; }

  DeleteTOXMark(): void {
    let pNext: SwTOXMark | null = null;
    if (this.m_pCurTOXMark) {
      pNext = GotoTOXMark(this.m_pSh.m_pDoc, this.m_pCurTOXMark, SwTOXSearch.TOX_NXT);
      if (pNext === this.m_pCurTOXMark) pNext = null;
      DeleteTOXMark(this.m_pSh.m_pDoc, this.m_pSh.m_pCursor, this.m_pCurTOXMark);
    }
    // go to next one
    this.m_pCurTOXMark = pNext;
    if (pNext) this.m_pSh.GotoTOXMark(pNext);
  }

  /**
   * Inserts the mark the description makes at the selection, or with `aRanges` (Apply to all other
   * occurrences: lcl_SelectSameStrings) at each of them.
   */
  InsertTOXMark(rDesc: SwTOXMarkDescription, aRanges?: { node: SwTextNode; nStart: number; nEnd: number }[]): void {
    let pMark: SwTOXMark | null = null;
    switch (rDesc.meTOXType) {
      case TOXTypes.TOX_CONTENT: {
        pMark = new SwTOXMark(this.GetTOXType(TOXTypes.TOX_CONTENT)!);
        pMark.SetLevel(rDesc.mnLevel);
        if (rDesc.maAltStr !== undefined) pMark.SetAlternativeText(rDesc.maAltStr);
        break;
      }
      case TOXTypes.TOX_INDEX: {
        pMark = new SwTOXMark(this.GetTOXType(TOXTypes.TOX_INDEX)!);
        if (rDesc.maPrimKey) {
          pMark.SetPrimaryKey(rDesc.maPrimKey);
          if (rDesc.maPhoneticReadingOfPrimKey !== undefined) pMark.SetPrimaryKeyReading(rDesc.maPhoneticReadingOfPrimKey);
          if (rDesc.maSecKey) {
            pMark.SetSecondaryKey(rDesc.maSecKey);
            if (rDesc.maPhoneticReadingOfSecKey !== undefined) pMark.SetSecondaryKeyReading(rDesc.maPhoneticReadingOfSecKey);
          }
        }
        if (rDesc.maAltStr !== undefined) pMark.SetAlternativeText(rDesc.maAltStr);
        if (rDesc.maPhoneticReadingOfAltStr !== undefined) pMark.SetTextReading(rDesc.maPhoneticReadingOfAltStr);
        pMark.SetMainEntry(rDesc.mbMainEntry);
        break;
      }
      case TOXTypes.TOX_USER: {
        pMark = new SwTOXMark(rDesc.maTOUName ? GetUserTOXType(this.m_pSh.m_pDoc, rDesc.maTOUName) : this.GetTOXType(TOXTypes.TOX_USER)!);
        pMark.SetLevel(rDesc.mnLevel);
        if (rDesc.maAltStr !== undefined) pMark.SetAlternativeText(rDesc.maAltStr);
        break;
      }
      default:
    }
    if (!pMark) return;
    InsertTOXMark(this.m_pSh.m_pDoc, this.m_pSh.m_pCursor, pMark, aRanges);
  }

  /** Update of TOXMarks */
  UpdateTOXMark(rDesc: SwTOXMarkDescription): void {
    const pOld = this.m_pCurTOXMark;
    if (!pOld) return;
    const pCur = pOld.Clone();
    if (pCur.GetTOXType().GetType() === TOXTypes.TOX_INDEX) {
      if (rDesc.maPrimKey) {
        pCur.SetPrimaryKey(rDesc.maPrimKey);
        pCur.SetPrimaryKeyReading(rDesc.maPhoneticReadingOfPrimKey ?? '');
        if (rDesc.maSecKey) {
          pCur.SetSecondaryKey(rDesc.maSecKey);
          pCur.SetSecondaryKeyReading(rDesc.maPhoneticReadingOfSecKey ?? '');
        } else {
          pCur.SetSecondaryKey('');
          pCur.SetSecondaryKeyReading('');
        }
      } else {
        pCur.SetPrimaryKey('');
        pCur.SetPrimaryKeyReading('');
        pCur.SetSecondaryKey('');
        pCur.SetSecondaryKeyReading('');
      }
      pCur.SetTextReading(rDesc.maPhoneticReadingOfAltStr ?? '');
      pCur.SetMainEntry(rDesc.mbMainEntry);
    } else pCur.SetLevel(rDesc.mnLevel);
    const rDoc = this.m_pSh.m_pDoc;
    if (rDesc.maAltStr !== undefined) {
      // JP 26.08.96: Bug 30344 - either the text of a Doc or an alternative test,
      //                          not both!
      const bReplace = pCur.IsAlternativeText();
      if (bReplace) pCur.SetAlternativeText(rDesc.maAltStr);
      else {
        // The mark over the text goes; a mark with the alternative text takes its place at its start.
        const t = FindTextTOXMark(rDoc, pOld);
        DeleteTOXMark(rDoc, this.m_pSh.m_pCursor, pOld);
        pCur.SetAlternativeText(rDesc.maAltStr);
        if (t) InsertTOXMark(rDoc, this.m_pSh.m_pCursor, pCur, [{ node: t.pTextNd, nStart: t.nStart, nEnd: t.nStart }]);
        this.m_aCurMarks = [];
        this.m_pCurTOXMark = pCur;
        return;
      }
    }
    ReplaceTOXMark(rDoc, this.m_pSh.m_pCursor, pOld, pCur);
    this.m_aCurMarks = this.m_aCurMarks.map((m) => (m === pOld ? pCur : m));
    this.m_pCurTOXMark = pCur;
  }

  // traveling between TOXMarks
  NextTOXMark(bSame = false): void {
    if (this.m_pCurTOXMark) {
      const eDir = bSame ? SwTOXSearch.TOX_SAME_NXT : SwTOXSearch.TOX_NXT;
      this.m_pCurTOXMark = GotoTOXMark(this.m_pSh.m_pDoc, this.m_pCurTOXMark, eDir);
      this.m_pSh.GotoTOXMark(this.m_pCurTOXMark);
    }
  }

  PrevTOXMark(bSame = false): void {
    if (this.m_pCurTOXMark) {
      const eDir = bSame ? SwTOXSearch.TOX_SAME_PRV : SwTOXSearch.TOX_PRV;
      this.m_pCurTOXMark = GotoTOXMark(this.m_pSh.m_pDoc, this.m_pCurTOXMark, eDir);
      this.m_pSh.GotoTOXMark(this.m_pCurTOXMark);
    }
  }

  GetTOXType(eTyp: TOXTypes): SwTOXType | null { return GetTOXType(this.m_pSh.m_pDoc, eTyp, 0); }
}

