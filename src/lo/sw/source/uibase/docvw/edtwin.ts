// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/docvw/edtwin.cxx partial
// QuickHelpData: the word completion's candidates for the word before the cursor (calendar
// names, today's date and the collected words) and which one is shown. Showing them (a tip, or
// the rest of the word as inline input) is the edit window's. The calendar's month and day names
// come from Intl.DateTimeFormat.
import type { SwAutoCompleteWord } from '../../core/doc/acmplwrd.ts';

const nNoPos = -1;

function calendarNames(lang: string): string[] {
  const out: string[] = [];
  try {
    const months = new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' });
    const days = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' });
    for (let m = 0; m < 12; m++) out.push(months.format(Date.UTC(2021, m, 1)));
    // 2021-01-03 was a Sunday.
    for (let d = 0; d < 7; d++) out.push(days.format(Date.UTC(2021, 0, 3 + d)));
  } catch { /* unknown language */ }
  return out;
}

/** compareToIgnoreAsciiCase */
const cmpAscii = (a: string, b: string) => {
  const la = a.replace(/[A-Z]/g, (c) => c.toLowerCase()), lb = b.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return la < lb ? -1 : la > lb ? 1 : 0;
};

export class QuickHelpData {
  /// Strings that at least partially match an input word, and match length.
  m_aHelpStrings: [string, number][] = [];
  /// Index of the current help string.
  nCurArrPos = nNoPos;
  /// Help data stores AutoText names rather than AutoComplete words.
  m_bIsAutoText = true;
  /// Display help string as a tip rather than inline.
  m_bIsTip = true;
  /// Help string is currently displayed.
  m_bIsDisplayed = false;
  /// Append a space character to the displayed string.
  m_bAppendSpace = false;

  ClearContent(): void {
    this.nCurArrPos = nNoPos;
    this.m_bIsDisplayed = this.m_bAppendSpace = false;
    this.m_aHelpStrings = [];
    this.m_bIsTip = true;
    this.m_bIsAutoText = true;
  }

  /** Start: shown from the first candidate (the edit window draws it). */
  Start(bRestart: boolean): void {
    if (bRestart) this.nCurArrPos = 0;
    this.m_bIsDisplayed = true;
  }

  /** Stop: the edit window takes the tip or the inline text away. */
  Stop(): void { this.ClearContent(); }

  HasContent(): boolean { return this.m_aHelpStrings.length > 0; }
  CurStr(): string { return this.m_aHelpStrings[this.nCurArrPos]?.[0] ?? ''; }
  CurLen(): number { return this.m_aHelpStrings[this.nCurArrPos]?.[1] ?? 0; }

  Next(bEndLess: boolean): void {
    if (++this.nCurArrPos >= this.m_aHelpStrings.length)
      this.nCurArrPos = (bEndLess && !this.m_bIsAutoText) ? 0 : this.nCurArrPos - 1;
  }

  Previous(bEndLess: boolean): void {
    if (0 === this.nCurArrPos--)
      this.nCurArrPos = (bEndLess && !this.m_bIsAutoText) ? this.m_aHelpStrings.length - 1 : 0;
  }

  FillStrArr(rWord: string, sLang: string, rACList: SwAutoCompleteWord, aToday = new Date()): void {
    // Determine word capitalization
    const CASE_LOWER = 0, CASE_UPPER = 1, CASE_SENTENCE = 2, CASE_OTHER = 3;
    const sWordLower = rWord.toLowerCase();
    let aWordCase = CASE_OTHER;
    if (rWord) {
      if (rWord[0] === sWordLower[0]) {
        if (rWord === sWordLower)
          aWordCase = CASE_LOWER;
      } else {
        // First character is not lower case i.e. assume upper or title case
        const sWordSentence = rWord[0] + sWordLower.slice(1);
        if (rWord === sWordSentence)
          aWordCase = CASE_SENTENCE;
        else {
          if (rWord === rWord.toUpperCase())
            aWordCase = CASE_UPPER;
        }
      }
    }

    // Add matching calendar month and day names
    for (const rStr of calendarNames(sLang)) {
      // Check string longer than word and case insensitive match
      if (rStr.length > rWord.length &&
        rStr.slice(0, rWord.length).toLowerCase() === sWordLower) {
        let sStr = '';

        //fdo#61251 if it's an exact match, ensure unchanged replacement
        //exists as a candidate
        if (rStr.startsWith(rWord))
          this.m_aHelpStrings.push([rStr, rWord.length]);
        else
          sStr = rStr; // to be added if no case conversion is performed below

        if (aWordCase === CASE_LOWER)
          sStr = rStr.toLowerCase();
        else if (aWordCase === CASE_SENTENCE)
          sStr = rStr[0] + rStr.toLowerCase().slice(1);
        else if (aWordCase === CASE_UPPER)
          sStr = rStr.toUpperCase();

        if (sStr)
          this.m_aHelpStrings.push([sStr, rWord.length]);
      }
    }

    // Add matching current date in ISO 8601 format, for example 2016-01-30
    let rStrToday = '';

    // do not suggest for single years, for example for "2016",
    // only for "201" or "2016-..." (to avoid unintentional text
    // insertion at line ending, for example typing "30 January 2016")
    if (rWord && rWord.length !== 4 && rWord[0] === '2') {
      const p = (n: number) => String(n).padStart(2, '0');
      rStrToday = `${aToday.getFullYear()}-${p(aToday.getMonth() + 1)}-${p(aToday.getDate())}`;
      if (rStrToday.startsWith(rWord))
        this.m_aHelpStrings.push([rStrToday, rWord.length]);
    }

    // Add matching words from AutoCompleteWord list
    const strings: string[] = [];

    if (!rACList.GetWordsMatching(rWord, strings))
      return;

    for (const aCompletedString of strings) {
      // when we have a matching current date, avoid to suggest
      // other words with the same matching starting characters,
      // for example 2016-01-3 instead of 2016-01-30
      if (rStrToday && aCompletedString.startsWith(rWord))
        continue;

      let sStr = '';

      //fdo#61251 if it's an exact match, ensure unchanged replacement
      //exists as a candidate
      if (aCompletedString.startsWith(rWord))
        this.m_aHelpStrings.push([aCompletedString, rWord.length]);
      else
        sStr = aCompletedString; // to be added if no case conversion is performed below

      if (aWordCase === CASE_LOWER)
        sStr = aCompletedString.toLowerCase();
      else if (aWordCase === CASE_SENTENCE)
        sStr = aCompletedString[0] + aCompletedString.toLowerCase().slice(1);
      else if (aWordCase === CASE_UPPER)
        sStr = aCompletedString.toUpperCase();

      if (sStr)
        this.m_aHelpStrings.push([aCompletedString, rWord.length]);
    }
  }

  // TODO Implement an i18n aware sort
  SortAndFilter(rOrigWord: string): void {
    this.m_aHelpStrings.sort((s1, s2) => {
      const nRet = cmpAscii(s1[0], s2[0]);
      if (nRet === 0) {
        //fdo#61251 sort stuff that starts with the exact rOrigWord before
        //another ignore-case candidate
        const n1StartsWithOrig = s1[0].startsWith(rOrigWord) ? 0 : 1;
        const n2StartsWithOrig = s2[0].startsWith(rOrigWord) ? 0 : 1;
        return n1StartsWithOrig - n2StartsWithOrig;
      }
      return nRet;
    });

    this.m_aHelpStrings = this.m_aHelpStrings.filter((s, i, a) => i === 0 || cmpAscii(a[i - 1]![0], s[0]) !== 0);

    this.nCurArrPos = 0;
  }
}

/** SwEditWin::ShowAutoCorrectQuickHelp: fills the help data for the word before the cursor. */
export function ShowAutoCorrectQuickHelp(rQuickHlpData: QuickHelpData, rWord: string, bAutoCompleteWords: boolean, bShowAsTip: boolean, sLang: string, rACList: SwAutoCompleteWord): void {
  if (!rWord)
    return;
  rQuickHlpData.ClearContent();

  if (!rQuickHlpData.m_aHelpStrings.length && bAutoCompleteWords) {
    rQuickHlpData.m_bIsAutoText = false;
    rQuickHlpData.m_bIsTip = bShowAsTip;

    // Get the necessary data to show help text.
    rQuickHlpData.FillStrArr(rWord, sLang, rACList);
  }

  if (rQuickHlpData.m_aHelpStrings.length) {
    rQuickHlpData.SortAndFilter(rWord);
    rQuickHlpData.Start(true);
  }
}
