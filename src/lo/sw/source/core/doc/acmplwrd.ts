// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/doc/acmplwrd.cxx reduced
// @upstream sw/inc/acmplwrd.hxx reduced
// SwAutoCompleteWord: the words collected for word completion, most recently used first. The
// lookup tree (editeng::Trie) is a scan of the sorted list; documents are told apart by a key the
// application gives (SwAutoCompleteClient's document), so that closing one can drop its words.

/** One collected word and the documents it was found in (SwAutoCompleteString). */
export class SwAutoCompleteString {
  m_String: string;
  m_aSourceDocs = new Set<string>();
  constructor(rStr: string, nLen: number) { this.m_String = rStr.slice(0, nLen); }
  GetAutoCompleteString(): string { return this.m_String; }
  AddDocument(rDoc: string): void { this.m_aSourceDocs.add(rDoc); }
  /** Returns whether no document is left. */
  RemoveDocument(rDoc: string): boolean { this.m_aSourceDocs.delete(rDoc); return !this.m_aSourceDocs.size; }
}

/** CompareAutoCompleteString: compareToIgnoreAsciiCase. */
const cmp = (a: string, b: string) => {
  const la = a.replace(/[A-Z]/g, (c) => c.toLowerCase()), lb = b.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return la < lb ? -1 : la > lb ? 1 : 0;
};

export class SwAutoCompleteWord {
  /// contains extended strings carrying source information
  m_WordList: SwAutoCompleteString[] = [];
  m_aLRUList: SwAutoCompleteString[] = [];
  m_nMaxCount: number;
  m_nMinWordLen: number;
  m_bLockWordList = false;

  constructor(nWords = 500, nMWrdLen = 10) {
    this.m_nMaxCount = nWords;
    this.m_nMinWordLen = nMWrdLen;
  }

  private lower_bound(s: string): number {
    let lo = 0, hi = this.m_WordList.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(this.m_WordList[mid]!.m_String, s) < 0) lo = mid + 1; else hi = mid; }
    return lo;
  }

  InsertWord(rWord: string, rDoc: string): boolean {
    const aNewWord = rWord.replace(/[\u0001￹]/g, '');

    let bRet = false;
    let nWrdLen = aNewWord.length;
    while (nWrdLen && '.' === aNewWord[nWrdLen - 1])
      --nWrdLen;

    if (!this.m_bLockWordList && nWrdLen >= this.m_nMinWordLen) {
      const sWord = aNewWord.slice(0, nWrdLen);
      const i = this.lower_bound(sWord);
      const pFound = i < this.m_WordList.length && cmp(this.m_WordList[i]!.m_String, sWord) === 0 ? this.m_WordList[i]! : null;
      if (!pFound) {
        const pNew = new SwAutoCompleteString(aNewWord, nWrdLen);
        pNew.AddDocument(rDoc);
        this.m_WordList.splice(i, 0, pNew);
        bRet = true;
        if (this.m_aLRUList.length >= this.m_nMaxCount) {
          // the last one needs to be removed
          // so that there is space for the first one
          const pDel = this.m_aLRUList.pop()!;
          this.m_WordList.splice(this.m_WordList.indexOf(pDel), 1);
        }
        this.m_aLRUList.unshift(pNew);
      } else {
        // add the document to the already inserted string
        pFound.AddDocument(rDoc);

        // move pNew to the front of the LRU list
        const it = this.m_aLRUList.indexOf(pFound);
        if (it > 0) {
          this.m_aLRUList.splice(it, 1);
          this.m_aLRUList.unshift(pFound);
        }
      }
    }
    return bRet;
  }

  SetMaxCount(nNewMax: number): void {
    if (nNewMax < this.m_nMaxCount && this.m_aLRUList.length > nNewMax) {
      // remove the trailing ones
      for (const pDel of this.m_aLRUList.splice(nNewMax)) this.m_WordList.splice(this.m_WordList.indexOf(pDel), 1);
    }
    this.m_nMaxCount = nNewMax;
  }

  SetMinWordLen(n: number): void {
    // Do you really want to remove all words that are less than the minWrdLen?
    if (n < this.m_nMinWordLen) {
      for (let nPos = 0; nPos < this.m_WordList.length; ++nPos)
        if (this.m_WordList[nPos]!.m_String.length < n) {
          const pDel = this.m_WordList.splice(nPos--, 1)[0]!;
          this.m_aLRUList.splice(this.m_aLRUList.indexOf(pDel), 1);
        }
    }
    this.m_nMinWordLen = n;
  }

  /** Return all words matching a given prefix (case insensitively, as the lookup tree does for the help). */
  GetWordsMatching(aMatch: string, rWords: string[]): boolean {
    const lower = aMatch.toLowerCase();
    for (const w of this.m_aLRUList) if (w.m_String.toLowerCase().startsWith(lower)) rWords.push(w.m_String);
    return rWords.length > 0;
  }

  /** CheckChangedList: the dialog's list with words deleted. */
  CheckChangedList(rNewLst: string[]): void {
    const keep = new Set(rNewLst);
    this.m_WordList = this.m_WordList.filter((w) => keep.has(w.m_String));
    this.m_aLRUList = this.m_aLRUList.filter((w) => keep.has(w.m_String));
  }

  /** SwAutoCompleteWord::DocumentDying: the words found only in that document go. */
  DocumentDying(rDoc: string): void {
    for (const w of [...this.m_WordList]) {
      if (w.RemoveDocument(rDoc)) {
        this.m_WordList.splice(this.m_WordList.indexOf(w), 1);
        this.m_aLRUList.splice(this.m_aLRUList.indexOf(w), 1);
      }
    }
  }

  IsLockWordLstLocked(): boolean { return this.m_bLockWordList; }
  SetLockWordLstLocked(bFlag: boolean): void { this.m_bLockWordList = bFlag; }
  GetMaxCount(): number { return this.m_nMaxCount; }
  GetMinWordLen(): number { return this.m_nMinWordLen; }
  GetWordList(): string[] { return this.m_WordList.map((w) => w.m_String); }
}
